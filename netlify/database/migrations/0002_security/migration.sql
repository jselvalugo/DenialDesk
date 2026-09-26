-- Generated from drizzle/0002_security.sql by `pnpm netlify:migrations`. Do not edit.
-- Tenant isolation, least-privilege app role, and append-only audit log.
-- R-7.2.4 (row-level security), R-7.5.1 (immutable audit), CLAUDE.md non-negotiables 5 and 7.
--
-- The app runs tenant queries as the NOLOGIN role denialdesk_app via `SET LOCAL ROLE` inside a
-- transaction that also sets app.tenant_id (src/db/tenant.ts). FORCE ROW LEVEL SECURITY applies
-- the policies to the table owner too, so only superusers (never used by the app) bypass them.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'denialdesk_app') THEN
    CREATE ROLE denialdesk_app NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
GRANT denialdesk_app TO CURRENT_USER;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO denialdesk_app;--> statement-breakpoint

-- Helper: the tenant bound to the current transaction, or NULL when none is set.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_tenant() TO denialdesk_app;--> statement-breakpoint

-- Tenant-owned tables: full CRUD for the app role, limited to the current tenant.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['locations', 'providers', 'payers', 'patients', 'claims', 'claim_lines', 'denials', 'denial_notes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO denialdesk_app', t);
  END LOOP;
END
$$;--> statement-breakpoint

-- Identity tables: the app role may read users/memberships/tenants for display (names, roles).
-- Authentication writes run outside tenant context as the connection owner (src/auth).
GRANT SELECT ON tenants, memberships TO denialdesk_app;--> statement-breakpoint
GRANT SELECT (id, display_name, email) ON users TO denialdesk_app;--> statement-breakpoint

-- Audit log: insert and read only; readable per tenant; never updated or deleted.
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_read ON audit_events FOR SELECT USING (tenant_id = app_current_tenant());--> statement-breakpoint
CREATE POLICY audit_insert_tenant ON audit_events FOR INSERT
  WITH CHECK (tenant_id IS NULL OR tenant_id = app_current_tenant());--> statement-breakpoint
-- The owner writes pre-tenant events (e.g. failed logins) outside any tenant context.
CREATE POLICY audit_insert_system ON audit_events FOR INSERT TO CURRENT_USER WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT ON audit_events TO denialdesk_app;--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_events_id_seq TO denialdesk_app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION audit_events_immutable() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END
$$;--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_immutable();--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_immutable();
