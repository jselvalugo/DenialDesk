import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { locations, patients, payers, providers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createDraftClaims } from "@/domain/claims/versions";
import { encryptField } from "@/lib/crypto/field";
import { encryptProviderTin } from "@/lib/crypto/provider-tin";

// Fully synthetic fixtures shared by the 837P service and action tests (docs/specs/claims.md C3a): a
// practice with a complete billing provider, a location with a place of service, a payer, and a patient.

export type Ctx = { tenantId: string; userId: string };

export const MEMBER_ID = "SYN123456789";
export const TIN = "000000001";

export interface Billing {
  providerId: string;
  locationId: string;
  payerId: string;
  patientId: string;
}

let seq = 0;

/** A practice with a complete billing provider, a location with a place of service, a payer, and a patient. */
export async function seedBilling(ctx: Ctx): Promise<Billing> {
  const db = systemDb();
  const [provider] = await db
    .insert(providers)
    .values({
      tenantId: ctx.tenantId,
      name: "Dr. Avery Synthprovider (synthetic)",
      npi: "1234567893",
      taxonomy: "207R00000X",
      firstName: "Avery",
      lastName: "Synthprovider",
      addressLine1: "100 Synthetic Way",
      city: "Tampa",
      state: "FL",
      postalCode: "336020001",
      tinType: "EI",
    })
    .returning({ id: providers.id });
  await db
    .update(providers)
    .set({ tinEnc: encryptProviderTin(TIN, ctx.tenantId, provider!.id) })
    .where(eq(providers.id, provider!.id));
  const [location] = await db
    .insert(locations)
    .values({
      tenantId: ctx.tenantId,
      name: "Bayshore Clinic (synthetic)",
      city: "Tampa",
      placeOfService: "11",
    })
    .returning({ id: locations.id });
  const [payer] = await db
    .insert(payers)
    .values({
      tenantId: ctx.tenantId,
      name: "Gulf Coast Mutual (synthetic)",
      ediPayerId: "SYNTH01",
      regime: "fl_insurer",
    })
    .returning({ id: payers.id });
  const patient = await manualPatient(ctx, payer!.id, MEMBER_ID);
  return { providerId: provider!.id, locationId: location!.id, payerId: payer!.id, patientId: patient };
}

export async function manualPatient(ctx: Ctx, payerId: string | null, memberId: string): Promise<string> {
  seq += 1;
  const [patient] = await systemDb()
    .insert(patients)
    .values({
      tenantId: ctx.tenantId,
      mrn: `SYN-83700${seq}`,
      firstName: "Jane",
      lastName: "Synthpatient",
      birthDate: "1980-01-15",
      sex: "F",
      addressLine1: "200 Synthetic Way",
      city: "Tampa",
      state: "FL",
      postalCode: "33602",
      primaryPayerId: payerId,
      memberIdEnc: encryptField(memberId),
      memberIdLast4: memberId.slice(-4),
    })
    .returning({ id: patients.id });
  return patient!.id;
}

export async function newClaim(
  ctx: Ctx,
  base: Billing,
  overrides: Partial<{
    patientId: string;
    providerId: string;
    locationId: string;
    payerId: string;
    diagnosisCodes: string[];
    lines: { procedureCode: string; modifiers: string[]; units: number; chargeCents: number }[];
  }> = {},
): Promise<string> {
  seq += 1;
  const [created] = await withTenant(ctx, (tx) =>
    createDraftClaims(
      tx,
      ctx,
      [
        {
          claimNumber: `SYN-837-${seq}-${Date.now()}`,
          patientId: overrides.patientId ?? base.patientId,
          providerId: overrides.providerId ?? base.providerId,
          locationId: overrides.locationId ?? base.locationId,
          payerId: overrides.payerId ?? base.payerId,
          serviceDate: "2026-09-01",
          diagnosisCodes: overrides.diagnosisCodes ?? ["E11.9"],
          lines: overrides.lines ?? [
            { procedureCode: "99213", modifiers: ["25"], units: 1, chargeCents: 12_500 },
            { procedureCode: "36415", modifiers: [], units: 1, chargeCents: 3_000 },
          ],
        },
      ],
      { reason: "charge_import" },
    ),
  );
  return created!.id;
}
