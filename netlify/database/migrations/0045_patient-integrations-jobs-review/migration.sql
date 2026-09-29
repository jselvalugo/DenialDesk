-- Generated from drizzle/0045_patient_integrations_jobs_review.sql by `pnpm netlify:migrations`. Do not edit.
-- PI2c review round (PR #100): replaces the scheduler function of 0044 and tightens the service-principal
-- check. 0044 has already run on a Netlify preview database branch, so it is not edited; every change is here.
--   1. Extends the check of the integration service-principal row (security review O8).
--   2. Replaces `integration_enqueue_due_runs()` with `integration_enqueue_due_runs(p_sandbox_only boolean)`,
--      which returns (tenant_id, run_id, outcome) so the caller can audit what the database did.
--
-- R-15.9: THIS MIGRATION CHANGES PRIVILEGES (it drops one SECURITY DEFINER function and creates its replacement,
-- with REVOKE and GRANT) AND NEEDS THE OWNER'S SIGN-OFF TOGETHER WITH 0044 (OA-085). The privilege statements are
-- the DROP FUNCTION, CREATE FUNCTION ... SECURITY DEFINER, REVOKE and GRANT in section 2; the final list across 0044
-- and 0045 is in docs/decisions/0012-background-execution.md. `denialdesk_jobs` still holds only EXECUTE on the two
-- functions; `denialdesk_app` and PUBLIC hold nothing on either. No table, column, policy or trigger changes.

-- 1. The service principal (0043 seed, 0044 check L3), now also without a second-factor secret and with the
-- reserved `.invalid` address 0043 gave it. Raises (the migration fails, nothing below runs) if any of that is untrue.
DO $$
DECLARE
  principal_id CONSTANT uuid := 'd3a7c0de-5a1c-4e11-8a0c-0000000d0d01';
  principal RECORD;
BEGIN
  SELECT id, email, disabled_at, password_hash, totp_secret_enc INTO principal FROM public.users WHERE id = principal_id;
  IF principal.id IS NULL THEN
    RAISE EXCEPTION 'integration service principal % is missing', principal_id;
  END IF;
  IF principal.disabled_at IS NULL THEN
    RAISE EXCEPTION 'integration service principal % must be disabled', principal_id;
  END IF;
  IF principal.password_hash IS DISTINCT FROM '!' THEN
    RAISE EXCEPTION 'integration service principal % must have the non-hash password marker', principal_id;
  END IF;
  IF principal.totp_secret_enc IS NOT NULL THEN
    RAISE EXCEPTION 'integration service principal % must have no second-factor secret', principal_id;
  END IF;
  IF principal.email IS DISTINCT FROM 'integration-sync@service.denialdesk.invalid' THEN
    RAISE EXCEPTION 'integration service principal % must have the reserved address', principal_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = principal_id) THEN
    RAISE EXCEPTION 'integration service principal % must have no membership in any practice', principal_id;
  END IF;
END
$$;--> statement-breakpoint

-- 2. The scheduler function. The zero-argument version of 0044 goes; the new signature returns one row per run
-- it queued ('queued') or gave up on ('abandoned', a run quiet for the 20-minute lease), with its practice, so the
-- caller can audit the abandoned runs and abandon (and audit) a run whose job could not be posted. Same
-- SECURITY DEFINER, `search_path` with pg_temp last, schema-qualified tables, REVOKE ALL FROM PUBLIC before the one
-- grant, and the same walk over the practices (see 0044 for why).
--   p_sandbox_only: when true only built-in sandbox connections are due. The app passes true until PI4 can apply a
--   real connection's population scope: a real connection's run is refused by the engine anyway, and queueing one
--   every tick would only walk it into `error` with a misleading `repeated_failures`.
--   Due: an active connection with no queued or running run, and no run queued in the last 14 minutes (a minute of
--   slack for a tick that fires early). A run abandoned before it ever started (a lost job, a deadline) does not
--   count as "recent", so the next tick queues the connection again at once. The two checks are separate NOT
--   EXISTS on the two indexes (the partial unique index on queued/running runs; the (tenant, connection,
--   queued_at) index), and the stale-run update is split by status the same way, so neither is an OR over a scan.
--   The due connections are locked FOR SHARE ... SKIP LOCKED: a concurrent Pause (which holds the row for update)
--   is skipped until the next tick, and once this transaction holds the lock a Pause waits and then abandons the run
--   we queue, so a paused connection can't be left with a queued run.
DROP FUNCTION integration_enqueue_due_runs();--> statement-breakpoint

CREATE FUNCTION integration_enqueue_due_runs(p_sandbox_only boolean) RETURNS TABLE (tenant_id uuid, run_id uuid, outcome text)
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

    RETURN QUERY
      WITH gone AS (
        UPDATE public.integration_sync_runs r
          SET status = 'abandoned', finished_at = now()
          WHERE r.tenant_id = practice
            AND r.status = 'running'
            AND coalesce(r.heartbeat_at, r.started_at) < now() - interval '20 minutes'
          RETURNING r.tenant_id AS gone_tenant, r.id AS gone_run
      )
      SELECT gone.gone_tenant, gone.gone_run, 'abandoned'::text FROM gone;
    RETURN QUERY
      WITH gone AS (
        UPDATE public.integration_sync_runs r
          SET status = 'abandoned', finished_at = now()
          WHERE r.tenant_id = practice
            AND r.status = 'queued'
            AND r.queued_at < now() - interval '20 minutes'
          RETURNING r.tenant_id AS gone_tenant, r.id AS gone_run
      )
      SELECT gone.gone_tenant, gone.gone_run, 'abandoned'::text FROM gone;

    FOR due IN
      SELECT c.id FROM public.integration_connections c
        WHERE c.tenant_id = practice
          AND c.status = 'active'
          AND (NOT p_sandbox_only OR c.is_sandbox)
          AND NOT EXISTS (
            SELECT 1 FROM public.integration_sync_runs r
              WHERE r.tenant_id = c.tenant_id AND r.connection_id = c.id
                AND r.status IN ('queued', 'running')
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.integration_sync_runs r
              WHERE r.tenant_id = c.tenant_id AND r.connection_id = c.id
                AND r.queued_at > now() - interval '14 minutes'
                AND (r.status <> 'abandoned' OR r.started_at IS NOT NULL)
          )
        ORDER BY c.id
        FOR SHARE OF c SKIP LOCKED
    LOOP
      new_run := NULL;
      INSERT INTO public.integration_sync_runs (tenant_id, connection_id, trigger, triggered_by)
        VALUES (practice, due, 'scheduled', NULL)
        ON CONFLICT DO NOTHING
        RETURNING id INTO new_run;
      IF new_run IS NOT NULL THEN
        tenant_id := practice;
        run_id := new_run;
        outcome := 'queued';
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', coalesce(previous_tenant, ''), true);
  RETURN;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION integration_enqueue_due_runs(boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integration_enqueue_due_runs(boolean) TO denialdesk_jobs;
