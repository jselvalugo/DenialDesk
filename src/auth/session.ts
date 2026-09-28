import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { memberships, sessions, tenants, users } from "@/db/schema";
import { auditSystem } from "@/lib/audit";
import { requestContext } from "@/lib/request-context";
import {
  OPERATOR_SESSION_COOKIE,
  SESSION_ABSOLUTE_MS,
  SESSION_COOKIE,
  SESSION_IDLE_MS,
  SESSION_TOUCH_MS,
} from "./policy";

export { hasRecentMfa } from "./step-up";

export type Role = (typeof memberships.$inferSelect)["role"];
/** "demo" remains only for sessions created before the demo was removed; none are created now. */
export type AuthMethod = "password_mfa" | "demo" | "operator";

/**
 * Practice sessions (password + MFA) and platform operator sessions live in separate
 * cookies and are never accepted in place of each other (docs/specs/operator-login.md).
 */
export type Realm = "practice" | "operator";
const COOKIE: Record<Realm, string> = { practice: SESSION_COOKIE, operator: OPERATOR_SESSION_COOKIE };

export interface SessionInfo {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  mfaVerified: boolean;
  /** When MFA last completed (sign-in or step-up); null if never. Feeds `hasRecentMfa`. */
  mfaVerifiedAt: Date | null;
  displayName: string;
  email: string;
  mfaEnrolled: boolean;
  mustChangePassword: boolean;
  authMethod: AuthMethod;
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  displayName: string;
  tenantName: string;
  role: Role;
  tenantKind: "customer" | "demo";
  authMethod: Exclude<AuthMethod, "operator">;
  email: string;
  /** For `hasRecentMfa`: a step-up gated action (R-7.2.2) checks this against the five-minute window. */
  mfaVerifiedAt: Date | null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function clientIp(): Promise<string | null> {
  return (await requestContext()).ip;
}

async function setCookie(token: string, realm: Realm) {
  (await cookies()).set(COOKIE[realm], token, {
    httpOnly: true,
    secure: true,
    // The console is never reached from another site, so its cookie is never sent cross-site.
    sameSite: realm === "operator" ? "strict" : "lax",
    path: "/",
    maxAge: SESSION_ABSOLUTE_MS / 1000,
  });
}

/**
 * Starts a session. After a correct password, MFA is still required (`mfaVerified` false).
 * Operator sessions have no practice and use the operator cookie. Suspended practices are skipped
 * when choosing the session's practice.
 */
export async function createSession(
  userId: string,
  options: { authMethod?: AuthMethod; tenantId?: string; mfaVerified?: boolean } = {},
): Promise<void> {
  const operator = options.authMethod === "operator";
  const [membership] = operator
    ? []
    : options.tenantId
      ? [{ tenantId: options.tenantId }]
      : await systemDb()
          .select({ tenantId: memberships.tenantId })
          .from(memberships)
          .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
          .where(and(eq(memberships.userId, userId), isNull(tenants.suspendedAt)))
          .orderBy(asc(memberships.createdAt))
          .limit(1);
  if (options.authMethod === "demo") throw new Error("Demo sessions no longer exist");
  const token = randomBytes(32).toString("base64url");
  await systemDb()
    .insert(sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      tenantId: membership?.tenantId ?? null,
      // Only operator sign-in may start verified, and only with two-step switched off by
      // configuration outside production (operator-actions.ts). No pre-MFA token exists to rotate.
      mfaVerified: options.mfaVerified === true && operator,
      mfaVerifiedAt: options.mfaVerified === true && operator ? new Date() : null,
      authMethod: options.authMethod ?? "password_mfa",
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
    });
  await setCookie(token, operator ? "operator" : "practice");
}

/** Marks MFA done and rotates the token so a pre-MFA token can't be reused (session fixation). */
export async function completeMfa(sessionId: string, realm: Realm = "practice"): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await systemDb()
    .update(sessions)
    .set({
      mfaVerified: true,
      mfaVerifiedAt: new Date(),
      tokenHash: hashToken(token),
      lastSeenAt: new Date(),
    })
    .where(eq(sessions.id, sessionId));
  await setCookie(token, realm);
}

/**
 * Records a step-up re-verification (R-7.2.2) on an already signed-in practice session. Rotates
 * the token like `completeMfa`: a step-up is another proof of possession of the authenticator, so
 * the token it was performed under should not outlive it. Returns whether a live session row was
 * updated: false (the session was revoked or ended meanwhile) sets no cookie, and the caller must
 * not treat the step-up as done.
 */
export async function completeStepUpMfa(sessionId: string): Promise<boolean> {
  const token = randomBytes(32).toString("base64url");
  const updated = await systemDb()
    .update(sessions)
    .set({ mfaVerifiedAt: new Date(), tokenHash: hashToken(token), lastSeenAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  if (updated.length === 0) return false;
  await setCookie(token, "practice");
  return true;
}

/** Revokes a session without touching the cookie (for when a new session replaces it). */
export async function revokeSession(sessionId: string): Promise<void> {
  await systemDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function endSession(sessionId: string, realm: Realm = "practice"): Promise<void> {
  await revokeSession(sessionId);
  (await cookies()).delete(COOKIE[realm]);
}

/** The practice session, once per request. Never returns an operator session. */
export const getSession = cache(async (): Promise<SessionInfo | null> => readSession("practice"));

/** The platform operator session, once per request. Never returns a practice session. */
export const getOperatorSession = cache(async (): Promise<SessionInfo | null> => readSession("operator"));

/** Reads and validates a realm's session cookie; enforces idle and absolute timeouts. */
async function readSession(realm: Realm): Promise<SessionInfo | null> {
  const token = (await cookies()).get(COOKIE[realm])?.value;
  if (!token) return null;
  const [row] = await systemDb()
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      tenantId: sessions.tenantId,
      mfaVerified: sessions.mfaVerified,
      mfaVerifiedAt: sessions.mfaVerifiedAt,
      authMethod: sessions.authMethod,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      displayName: users.displayName,
      email: users.email,
      mfaEnrolledAt: users.mfaEnrolledAt,
      mustChangePassword: users.mustChangePassword,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        // A token only works in its own cookie: an operator token pasted into the practice cookie
        // (or the reverse) is rejected.
        realm === "operator" ? eq(sessions.authMethod, "operator") : ne(sessions.authMethod, "operator"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const now = Date.now();
  const expired = row.expiresAt.getTime() <= now || now - row.lastSeenAt.getTime() > SESSION_IDLE_MS;
  if (expired || row.disabledAt) {
    await systemDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.sessionId));
    await auditSystem({
      action: "auth.session_expired",
      actorUserId: row.userId,
      tenantId: row.tenantId,
      entityType: "session",
      entityId: row.sessionId,
    });
    return null;
  }
  // Sliding idle window; write at most once a minute.
  if (now - row.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
    await systemDb().update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.sessionId));
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    tenantId: row.tenantId,
    mfaVerified: row.mfaVerified,
    mfaVerifiedAt: row.mfaVerifiedAt,
    displayName: row.displayName,
    email: row.email,
    mfaEnrolled: row.mfaEnrolledAt !== null,
    mustChangePassword: row.mustChangePassword,
    authMethod: row.authMethod,
  };
}

/** For pages and actions that need a fully signed-in user with a practice. Redirects otherwise. */
export const requireAuth = cache(async (): Promise<AuthContext> => {
  const session = await getSession();
  // getSession never returns an operator session; the check also narrows the type.
  if (!session || session.authMethod === "operator") redirect("/login");
  if (session.mustChangePassword) redirect("/login/password");
  if (!session.mfaVerified) redirect(session.mfaEnrolled ? "/login/mfa" : "/login/mfa/setup");
  if (!session.tenantId) redirect("/login?error=no-practice");
  const [membership] = await systemDb()
    .select({
      role: memberships.role,
      tenantName: tenants.name,
      tenantKind: tenants.kind,
      suspendedAt: tenants.suspendedAt,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, session.tenantId)))
    .limit(1);
  if (!membership) redirect("/login?error=no-practice");
  // The one-click demo was removed (2026-09-26): any leftover demo session ends here, audited.
  if (session.authMethod === "demo") {
    await systemDb()
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, session.sessionId));
    await auditSystem({
      action: "auth.session_revoked",
      actorUserId: session.userId,
      tenantId: session.tenantId,
      entityType: "session",
      entityId: session.sessionId,
      metadata: { reason: "demo_retired" },
    });
    redirect("/login");
  }
  if (membership.suspendedAt) {
    // Revoke in the database (cookies can't be changed while rendering); the cookie is now inert.
    await systemDb()
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, session.sessionId));
    redirect("/login?error=suspended");
  }
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    tenantId: session.tenantId,
    displayName: session.displayName,
    tenantName: membership.tenantName,
    role: membership.role,
    tenantKind: membership.tenantKind,
    authMethod: session.authMethod,
    email: session.email,
    mfaVerifiedAt: session.mfaVerifiedAt,
  };
});

/** Touches the session without other side effects (session-timeout "Stay signed in"). */
export async function touchSession(sessionId: string): Promise<void> {
  await systemDb().update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
}
