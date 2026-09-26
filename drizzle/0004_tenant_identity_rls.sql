-- Review fixes (2026-09-26).
-- 1. Identity tables: the app role could read every practice's names, team lists, and staff emails.
--    RLS now limits it to the current tenant (R-7.2.4, CLAUDE.md #5). ENABLE without FORCE: the
--    connection owner (used only by authentication, before a tenant is known) is unaffected.
-- 2. No hard deletes of practice data until legal hold exists (R-9.2.1).

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_self ON tenants FOR SELECT TO denialdesk_app USING (id = app_current_tenant());--> statement-breakpoint

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON memberships FOR SELECT TO denialdesk_app
  USING (tenant_id = app_current_tenant());--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY team_members ON users FOR SELECT TO denialdesk_app
  USING (EXISTS (
    SELECT 1 FROM memberships m WHERE m.user_id = users.id AND m.tenant_id = app_current_tenant()
  ));--> statement-breakpoint

REVOKE DELETE ON locations, providers, payers, patients, claims, claim_lines, denials, denial_notes FROM denialdesk_app;
