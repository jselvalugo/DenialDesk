ALTER TABLE "payer_classes" ADD COLUMN "regime" "regulatory_regime";--> statement-breakpoint
-- Backfill: a class linked to a DenialDesk payer takes that payer's regime; starter classes by
-- code. Tenant by tenant, because FORCE row-level security hides rows from a non-superuser owner.
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE payer_classes pc SET regime = p.regime
      FROM payers p
      WHERE pc.tenant_id = t AND pc.regime IS NULL AND p.id = pc.payer_id AND p.tenant_id = t;
    UPDATE payer_classes SET regime = CASE code
        WHEN 'COMM' THEN 'fl_insurer'::regulatory_regime
        WHEN 'HMO' THEN 'fl_hmo'::regulatory_regime
        WHEN 'ERISA' THEN 'erisa_self_funded'::regulatory_regime
        WHEN 'MCR' THEN 'medicare'::regulatory_regime
        WHEN 'MA' THEN 'medicare_advantage'::regulatory_regime
        WHEN 'MCD' THEN 'medicaid_ffs'::regulatory_regime
        WHEN 'SMMC' THEN 'smmc'::regulatory_regime
        WHEN 'WC' THEN 'workers_comp'::regulatory_regime
        WHEN 'PIP' THEN 'pip'::regulatory_regime
      END
      WHERE tenant_id = t AND regime IS NULL
        AND code IN ('COMM', 'HMO', 'ERISA', 'MCR', 'MA', 'MCD', 'SMMC', 'WC', 'PIP');
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
