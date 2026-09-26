/**
 * A payer is "verified" once its EDI payer ID and regulatory regime are both known (P2 loads these
 * from the clearinghouse payer list and an admin confirms the regime). Until then, DenialDesk must
 * not invent either value (CLAUDE.md #9), so nothing downstream may treat the payer as ready for
 * 837P submission or statutory deadline math.
 */
export interface VerifiablePayer {
  ediPayerId: string | null;
  regime: string | null;
}

export function isPayerVerified(payer: VerifiablePayer): boolean {
  return payer.ediPayerId !== null && payer.regime !== null;
}

export class UnverifiedPayerError extends Error {
  constructor() {
    super("This payer has not been verified with a payer ID and regulatory regime; it cannot be submitted.");
    this.name = "UnverifiedPayerError";
  }
}

/**
 * Refuses an unverified payer for anything that must not proceed without a confirmed EDI payer ID
 * and regime — most importantly 837P claim submission (spec: payer-catalog P1 acceptance criteria).
 */
export function assertPayerVerified(payer: VerifiablePayer): void {
  if (!isPayerVerified(payer)) throw new UnverifiedPayerError();
}
