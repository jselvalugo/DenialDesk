// Session and sign-in policy (REQUIREMENTS R-7.2.7, R-7.2.2). Security policy, not legal rules.
export const SESSION_IDLE_MS = 15 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Client warns this long before the idle timeout (DESIGN.md §12: warn at 13 minutes). */
export const SESSION_WARNING_MS = 2 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const SESSION_COOKIE = "__Host-dd_session";
