-- Generated from drizzle/0044_patient_integrations_jobs.sql by `pnpm netlify:migrations`. Do not edit.
-- PI2b "Jobs" and PI3 "scheduled enqueue" (docs/specs/patient-integrations.md; ADR 0012; threat model
-- S5). Adds the background-job database surface and one verification of an earlier seed:
--   1. Verifies the integration service-principal row that 0043 seeded (security review L3).
--   2. A NOLOGIN role `denialdesk_jobs`, the only role that may call the two job functions.
--   3. SECURITY DEFINER `integration_claim_run(run_id)`: is this a queued run of an active connection?
--   4. SECURITY DEFINER `integration_enqueue_due_runs()`: queue a run for every due active connection.
--
-- R-15.9: THIS MIGRATION CHANGES PRIVILEGES (a role, two SECURITY DEFINER functions, GRANTs and REVOKEs)
-- AND NEEDS THE OWNER'S SIGN-OFF BEFORE IT RUNS ANYWHERE BUT A LOCAL OR TEST DATABASE. Every such
-- statement is in section 2 to 4 below and is listed verbatim in the PR, in docs/PROJECT_STATE.md and in
-- ADR 0012. No table, column, policy or trigger is added or changed, and `denialdesk_app` gains nothing.
--
-- Why the two functions walk the tenants: every integration table has FORCE ROW LEVEL SECURITY, so a
-- SECURITY DEFINER function running as the table owner still sees only the rows of the tenant named by
-- `app.tenant_id`, unless the owner is a superuser or has BYPASSRLS (local development and CI are; a
-- managed database's owner may not be). A job knows only a run ID, not its tenant, and the scheduler
-- knows no tenant at all. So each function sets `app.tenant_id` (transaction-local) to one practice at a
-- time, asks its question under that practice's own policy, and puts the setting back before it returns.
-- That keeps row-level security the enforcement in every environment and adds no policy, no BYPASSRLS
-- and no grant on a table. It costs one indexed lookup per practice: fine before the Azure cutover
-- (ADR 0012 records the alternative).

-- 1. Security review L3: 0043 seeded the service principal with `ON CONFLICT DO NOTHING`, which would
-- silently skip the row if the address (or the id) already existed as something else. Verify what the
-- engine assumes about this identity: it exists, cannot sign in, and belongs to no practice. Raises (the
-- migration fails, nothing below runs) if any of that is untrue. 0043 itself is not edited.
DO $$
DECLARE
  principal_id CONSTANT uuid := 'd3a7c0de-5a1c-4e11-8a0c-0000000d0d01';
  principal RECORD;
BEGIN
  SELECT id, disabled_at, password_hash INTO principal FROM public.users WHERE id = principal_id;
  IF principal.id IS NULL THEN
    RAISE EXCEPTION 'integration service principal % is missing', principal_id;
  END IF;
  IF principal.disabled_at IS NULL THEN
    RAISE EXCEPTION 'integration service principal % must be disabled', principal_id;
  END IF;
  IF principal.password_hash IS DISTINCT FROM '!' THEN
    RAISE EXCEPTION 'integration service principal % must have the non-hash password marker', principal_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = principal_id) THEN
    RAISE EXCEPTION 'integration service principal % must have no membership in any practice', principal_id;
  END IF;
END
$$;--> statement-breakpoint

-- 2. The jobs role. Like denialdesk_app (0002) it is NOLOGIN, reached by `SET LOCAL ROLE` from the
-- connection's own login role, which is made a member here exactly as 0002 does for denialdesk_app.
-- It owns nothing and is granted nothing on any table: only EXECUTE on the two functions below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'denialdesk_jobs') THEN
    CREATE ROLE denialdesk_jobs NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
GRANT denialdesk_jobs TO CURRENT_USER;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO denialdesk_jobs;--> statement-breakpoint

-- 3. Claim check for a signed job. Read-only: it answers "is this run a queued run of an active
-- connection, and whose?" and returns the tenant and connection, nothing else. The atomic
-- queued -> running move, with its audit event, stays in the sync engine (`claimRun` in
-- src/domain/integrations/sync.ts locks the run row and refuses anything not queued), so of two workers
-- holding the same job exactly one runs it, and a finished or running run is refused here already.
-- Same shape as the 0039 registry functions: SECURITY DEFINER, `search_path` fixed with pg_temp last,
-- REVOKE ALL FROM PUBLIC before the one grant.
CREATE FUNCTION integration_claim_run(p_run_id uuid) RETURNS TABLE (tenant_id uuid, connection_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  previous_tenant text := current_setting('app.tenant_id', true);
  candidate uuid;
  found_tenant uuid;
  found_connection uuid;
BEGIN
  FOR candidate IN SELECT t.id FROM public.tenants t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', candidate::text, true);
    SELECT r.tenant_id, r.connection_id INTO found_tenant, found_connection
      FROM public.integration_sync_runs r
      JOIN public.integration_connections c ON c.tenant_id = r.tenant_id AND c.id = r.connection_id
      WHERE r.id = p_run_id AND r.status = 'queued' AND c.status = 'active';
    IF found_tenant IS NOT NULL THEN
      EXIT;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
  IF found_tenant IS NOT NULL THEN
    tenant_id := found_tenant;
    connection_id := found_connection;
    RETURN NEXT;
  END IF;
  RETURN;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION integration_claim_run(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integration_claim_run(uuid) TO denialdesk_jobs;--> statement-breakpoint

-- 4. The 15-minute scheduler (OA-056). For every practice: first abandon a run that has gone quiet (the
-- 20-minute lease, the same rule as `abandonStaleRuns` in src/domain/integrations/sync-runs.ts, so a
-- killed run or a lost job cannot block a connection for good), then queue a `scheduled` run for each
-- active connection with no queued or running run and no run queued in the last 14 minutes (a minute of
-- slack, so a tick that fires a few seconds early still finds its connection due). Returns the new run
-- IDs and nothing else. The partial unique index `integration_sync_runs_one_active` (0039) is the
-- backstop against two ticks overlapping: a conflicting insert is skipped, not an error. Whether a
-- connection may actually run (the synthetic-only rule, the fail-closed real-connection refusal) is
-- decided by the engine when the run is claimed, not here.
CREATE FUNCTION integration_enqueue_due_runs() RETURNS SETOF uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  previous_tenant text := current_setting('app.tenant_id', true);
  practice uuid;
  due uuid;
  new_run uuid;
BEGIN
  FOR practice IN SELECT t.id FROM public.tenants t ORDER BY t.id LOOP
    PERFORM set_config('app.tenant_id', practice::text, true);

    UPDATE public.integration_sync_runs r
      SET status = 'abandoned', finished_at = now()
      WHERE r.tenant_id = practice
        AND (
          (r.status = 'running' AND coalesce(r.heartbeat_at, r.started_at) < now() - interval '20 minutes')
          OR (r.status = 'queued' AND r.queued_at < now() - interval '20 minutes')
        );

    FOR due IN
      SELECT c.id FROM public.integration_connections c
        WHERE c.tenant_id = practice
          AND c.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM public.integration_sync_runs r
              WHERE r.tenant_id = c.tenant_id AND r.connection_id = c.id
                AND (r.status IN ('queued', 'running') OR r.queued_at > now() - interval '14 minutes')
          )
        ORDER BY c.id
    LOOP
      new_run := NULL;
      INSERT INTO public.integration_sync_runs (tenant_id, connection_id, trigger, triggered_by)
        VALUES (practice, due, 'scheduled', NULL)
        ON CONFLICT DO NOTHING
        RETURNING id INTO new_run;
      IF new_run IS NOT NULL THEN
        RETURN NEXT new_run;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
  RETURN;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION integration_enqueue_due_runs() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integration_enqueue_due_runs() TO denialdesk_jobs;
