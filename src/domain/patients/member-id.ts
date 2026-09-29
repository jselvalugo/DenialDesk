import { sql } from "drizzle-orm";
import { claims, patients } from "@/db/schema";

// A patient's member ID on file is the one for their primary payer (`patients.primary_payer_id`). A
// claim billed to another payer must not show or reveal it: it would be the wrong identifier for that
// payer and more PHI than the task needs (minimum necessary, R-5.1.2). Until coverage records exist
// (one member ID per payer), the claim and denial/appeal pages show and reveal it only when the
// claim's payer is the patient's primary payer. Use these inside a query that joins `claims` and
// `patients`.

/** Last four of the member ID when it belongs to the claim's payer, otherwise ''. */
export const memberIdLast4ForClaim = sql<string>`case when ${patients.primaryPayerId} = ${claims.payerId} then coalesce(${patients.memberIdLast4}, '') else '' end`;

/** True when a member ID is on file but not for the claim's payer (another payer, or none mapped yet). */
export const memberIdForOtherPayer = sql<boolean>`(${patients.memberIdLast4} is not null and ${patients.memberIdLast4} <> '' and ${patients.primaryPayerId} is distinct from ${claims.payerId})`;

/** Whether a member ID on file may be revealed on a claim billed to `claimPayerId`. */
export function memberIdBelongsToClaimPayer(primaryPayerId: string | null, claimPayerId: string): boolean {
  return primaryPayerId !== null && primaryPayerId === claimPayerId;
}
