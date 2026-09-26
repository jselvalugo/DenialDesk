import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { and, asc, eq, isNull } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { memberships, sessions, tenants, users } from "@/db/schema";
import { auditSystem } from "@/lib/audit";
import { requestContext } from "@/lib/request-context";
import { SESSION_ABSOLUTE_MS, SESSION_COOKIE, SESSION_IDLE_MS, SESSION_TOUCH_MS } from "./policy";

export type Role = (typeof memberships.$inferSelect)["role"];

export interface SessionInfo {
  sessionId: string;
  userId: string;
  tenantId: string | null;
  mfaVerified: boolean;
  displayName: string;
  mfaEnrolled: boolean;
}

export interface AuthContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  displayName: string;
  tenantName: string;
  role: Role;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function clientIp(): Promise<string | null> {
  return (await requestContext()).ip;
}

async function setCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_ABSOLUTE_MS / 1000,
  });
}

/** Starts a session after a correct password. MFA is still required before app access. */
export async function createSession(userId: string): Promise<void> {
  const [membership] = await systemDb()
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt))
    .limit(1);
  const token = randomBytes(32).toString("base64url");
  await systemDb()
    .insert(sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      tenantId: membership?.tenantId ?? null,
      expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
    });
  await setCookie(token);
}

/** Marks MFA done and rotates the token so a pre-MFA token can't be reused (session fixation). */
export async function completeMfa(sessionId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await systemDb()
    .update(sessions)
    .set({ mfaVerified: true, tokenHash: hashToken(token), lastSeenAt: new Date() })
    .where(eq(sessions.id, sessionId));
  await setCookie(token);
}

export async function endSession(sessionId: string): Promise<void> {
  await systemDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
  (await cookies()).delete(SESSION_COOKIE);
}

/** Reads and validates the session cookie once per request; enforces idle and absolute timeouts. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await systemDb()
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      tenantId: sessions.tenantId,
      mfaVerified: sessions.mfaVerified,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      displayName: users.displayName,
      mfaEnrolledAt: users.mfaEnrolledAt,
      disabledAt: users.disabledAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
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
    displayName: row.displayName,
    mfaEnrolled: row.mfaEnrolledAt !== null,
  };
});

/** For pages and actions that need a fully signed-in user with a practice. Redirects otherwise. */
export const requireAuth = cache(async (): Promise<AuthContext> => {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mfaVerified) redirect(session.mfaEnrolled ? "/login/mfa" : "/login/mfa/setup");
  if (!session.tenantId) redirect("/login?error=no-practice");
  const [membership] = await systemDb()
    .select({ role: memberships.role, tenantName: tenants.name })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(memberships.userId, session.userId), eq(memberships.tenantId, session.tenantId)))
    .limit(1);
  if (!membership) redirect("/login?error=no-practice");
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    tenantId: session.tenantId,
    displayName: session.displayName,
    tenantName: membership.tenantName,
    role: membership.role,
  };
});

/** Touches the session without other side effects (session-timeout "Stay signed in"). */
export async function touchSession(sessionId: string): Promise<void> {
  await systemDb().update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
}
