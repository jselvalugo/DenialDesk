// Session and sign-in policy (REQUIREMENTS R-7.2.7, R-7.2.2). Security policy, not legal rules.
export const SESSION_IDLE_MS = 15 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** Client warns this long before its own sign-out (DESIGN.md §12). */
export const SESSION_WARNING_MS = 2 * 60 * 1000;
/**
 * The server records activity at most once a minute (SESSION_TOUCH_MS), so its idle clock can run
 * up to that much ahead of the browser's. The browser signs out this much early to stay inside it.
 */
export const SESSION_TOUCH_MS = 60 * 1000;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const SESSION_COOKIE = "__Host-dd_session";
