import { MFA_STEP_UP_WINDOW_MS } from "./policy";

// Step-up MFA (R-7.2.2). Pure and free of server-only imports so domain code, client components,
// and unit tests can use it without the session module (cookies, database).

/** How far ahead of the reading instance's clock a verification may read (clock skew between instances). */
export const MFA_CLOCK_SKEW_MS = 30 * 1000;

/**
 * True when MFA completed within the step-up window: at sign-in, or on the last `/step-up`.
 * Inclusive at exactly the window (5:00 passes, 5:01 doesn't). A session that never recorded a
 * verification (null, including any that predates migration 0041) is never recent. The timestamp
 * is written only by `completeMfa`/`completeStepUpMfa` from the app's clock, so up to 30 seconds of
 * skew between instances can make it read as slightly in the future and still counts as recent; a
 * timestamp further ahead than that is not a verification that has happened yet, so it never counts.
 */
export function hasRecentMfa(mfaVerifiedAt: Date | null, now: Date = new Date()): boolean {
  if (!mfaVerifiedAt) return false;
  const elapsed = now.getTime() - mfaVerifiedAt.getTime();
  return elapsed >= -MFA_CLOCK_SKEW_MS && elapsed <= MFA_STEP_UP_WINDOW_MS;
}
