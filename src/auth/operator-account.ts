import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { isUniqueViolation } from "@/db/errors";
import { auditEvents, memberships, operatorCredentials, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { isProduction, onNetlify } from "@/lib/env";
import { log } from "@/lib/log";
import type { TenantTx } from "@/db/tenant";
import { isOperatorEmail, operatorEmail } from "./operator-email";
import { SCRYPT_PARAMS } from "./password";

// The platform operator account (docs/specs/operator-login.md): the one account whose email is
// PLATFORM_OPERATOR_EMAIL and that belongs to no practice. It signs in only at /operator/login, and
// it exists only as provisioned from infrastructure configuration (syncOperatorAccount).

export { isOperatorEmail, operatorEmail } from "./operator-email";

/** An account with any practice membership is never the operator, whatever its email (fail closed). */
export async function hasPracticeMembership(userId: string): Promise<boolean> {
  const [row] = await systemDb()
    .select({ id: memberships.id })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .limit(1);
  return row !== undefined;
}

/**
 * The one rule for "is this the operator account": configured email AND no practice membership.
 * Used by practice sign-in (to refuse it), operator sign-in (to accept only it), and the console.
 */
export async function isOperatorAccount(user: { id: string; email: string }): Promise<boolean> {
  return isOperatorEmail(user.email) && !(await hasPracticeMembership(user.id));
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** Identifies one applied credential: this email with this hash (the hash itself is never stored). */
const credentialFingerprint = (email: string, hash: string) => sha256(`${email}\n${hash}`);

/**
 * The e2e suite's operator hash is public (test/e2e/operator-credentials.ts). It works only on a
 * local test server: never on Netlify and never in production.
 */
const PUBLIC_TEST_HASH_FINGERPRINT = "a983bfd3bd3f77d53e78e1f74713e3671a53b04b72a312648b21fc9cc8e56e67";

/** Exactly the scrypt parameters and lengths `pnpm operator:credential` produces. */
function wellFormed(hash: string): boolean {
  const [scheme, n, r, p, salt, key] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !key || hash.split("$").length !== 6) return false;
  if (Number(n) !== SCRYPT_PARAMS.N || Number(r) !== SCRYPT_PARAMS.R || Number(p) !== SCRYPT_PARAMS.P) {
    return false;
  }
  const b64url = /^[A-Za-z0-9_-]+$/;
  return (
    b64url.test(salt) &&
    b64url.test(key) &&
    Buffer.from(salt, "base64url").length === SCRYPT_PARAMS.SALT_LENGTH &&
    Buffer.from(key, "base64url").length === SCRYPT_PARAMS.KEY_LENGTH
  );
}

/** Fingerprints of unusable configured values already warned about (once per process each). */
const warnedUnusable = new Set<string>();

/**
 * A configured value that can't be used switches the console off silently for visitors (sign-in
 * shows the generic error), so the operator learns why from the server log: `status` says whether
 * the value is malformed (e.g. the password itself instead of the hash `pnpm operator:credential`
 * prints) or the public e2e test hash. Nothing derived from the value is logged: a malformed value
 * may be the password itself, and even a short digest of it would help offline guessing. Its digest
 * stays in memory only, to warn once per value.
 */
function warnUnusable(hash: string, status: "malformed" | "test_hash"): void {
  const fingerprint = sha256(hash);
  if (warnedUnusable.has(fingerprint)) return;
  warnedUnusable.add(fingerprint);
  log.warn("operator.credential_unusable", { status });
}

/**
 * Why the configured PLATFORM_OPERATOR_PASSWORD_HASH can or can't be used. `test_hash` is the public
 * e2e hash, refused on Netlify and in production.
 */
export type HashStatus = "usable" | "missing" | "malformed" | "test_hash";

function classifyConfiguredHash(): { status: HashStatus; hash: string } {
  const hash = process.env.PLATFORM_OPERATOR_PASSWORD_HASH?.trim() ?? "";
  if (!hash) return { status: "missing", hash };
  if (!wellFormed(hash)) return { status: "malformed", hash };
  if ((isProduction() || onNetlify()) && sha256(hash) === PUBLIC_TEST_HASH_FINGERPRINT) {
    return { status: "test_hash", hash };
  }
  return { status: "usable", hash };
}

/** The operator's password hash from infrastructure configuration, or null if unset or unusable. */
export function configuredOperatorHash(): string | null {
  const { status, hash } = classifyConfiguredHash();
  if (status === "usable") return hash;
  if (status !== "missing") warnUnusable(hash, status);
  return null;
}

/** Both the operator email and a usable password hash are configured. */
export function operatorConfigured(): boolean {
  return operatorEmail() !== null && configuredOperatorHash() !== null;
}

export interface OperatorConfigurationStatus {
  email: "set" | "missing";
  passwordHash: HashStatus;
}

/**
 * What is wrong with the operator configuration, for the operator alone (the server log and the
 * pre-production status endpoint): never the values, nothing derived from them.
 */
export function operatorConfigurationStatus(): OperatorConfigurationStatus {
  return {
    email: operatorEmail() === null ? "missing" : "set",
    passwordHash: classifyConfiguredHash().status,
  };
}

/**
 * - `current`: the account matches configuration. `provisioned` / `rotated`: it now does.
 * - `unconfigured`: the console is off. `retired`: this deployment still carries a hash that was
 *   already replaced (e.g. an old deploy link); it can never re-apply it, and sign-in is refused here.
 * - `refused`: the configured email belongs to a practice or disabled account; never touched.
 */
export type SyncResult = "current" | "provisioned" | "rotated" | "unconfigured" | "retired" | "refused";

/** Only these results let the operator sign in or use the console. */
export const usableSync = (result: SyncResult) =>
  result === "current" || result === "provisioned" || result === "rotated";

/** What caused a sync: a sign-in attempt, a console request, or the pre-production status endpoint. */
export type SyncTrigger = "sign_in" | "console_request" | "status_check";

/**
 * Makes the operator account match infrastructure configuration (PLATFORM_OPERATOR_EMAIL and
 * PLATFORM_OPERATOR_PASSWORD_HASH). No page or endpoint can create or reset the operator: only
 * whoever controls the hosting configuration can (docs/specs/operator-login.md).
 *
 * A new hash is a credential rotation (recovery): it applies once, clears two-step enrollment and
 * lockout, and ends every operator session. Rotations only move forward: every applied hash's
 * fingerprint is recorded, and a retired one is never applied again. Audit events name hosting
 * configuration as the source (no user actor; the request IP is only what triggered the sync).
 * Cheap when nothing changed (one indexed lookup), so it runs on every console request and sign-in.
 */
export async function syncOperatorAccount(trigger: SyncTrigger): Promise<SyncResult> {
  const email = operatorEmail();
  const hash = configuredOperatorHash();
  if (!email || !hash) return "unconfigured";
  const fingerprint = credentialFingerprint(email, hash);
  // Fast path (every request): this exact credential is the one active credential.
  const [[state], [current]] = await Promise.all([
    systemDb()
      .select({ retiredAt: operatorCredentials.retiredAt })
      .from(operatorCredentials)
      .where(eq(operatorCredentials.fingerprint, fingerprint))
      .limit(1),
    systemDb()
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1),
  ]);
  if (state?.retiredAt) return "retired";
  if (state && current?.passwordHash === hash) return "current";

  const source = {
    source: "hosting_config",
    trigger,
    fingerprint: fingerprint.slice(0, 8),
    ipIsTrigger: true,
  };
  return systemDb()
    .transaction(async (tx): Promise<SyncResult> => {
      // One credential change at a time; every check below is repeated under this lock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('denialdesk.operator_credentials'))`);
      const [known] = await tx
        .select({ retiredAt: operatorCredentials.retiredAt })
        .from(operatorCredentials)
        .where(eq(operatorCredentials.fingerprint, fingerprint))
        .limit(1);
      if (known?.retiredAt) return "retired";
      // At most one credential is active. Another active one means this configuration is stale
      // (an old deploy link, or a previous operator email) unless it is new and being applied now.
      const [otherActive] = await tx
        .select({ fingerprint: operatorCredentials.fingerprint })
        .from(operatorCredentials)
        .where(and(isNull(operatorCredentials.retiredAt), ne(operatorCredentials.fingerprint, fingerprint)))
        .limit(1);
      const retireOthers = () =>
        tx
          .update(operatorCredentials)
          .set({ retiredAt: new Date() })
          .where(
            and(isNull(operatorCredentials.retiredAt), ne(operatorCredentials.fingerprint, fingerprint)),
          );

      const [user] = await tx
        .select({ id: users.id, passwordHash: users.passwordHash, disabledAt: users.disabledAt })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1)
        // Locks the row so a concurrent membership insert waits until this commits.
        .for("update");

      if (user?.passwordHash === hash) {
        if (known) return "current";
        // The account already matches but this credential was never recorded (it predates this
        // table). Adopt it only if nothing else is active; otherwise it is stale.
        if (otherActive) {
          await tx.insert(operatorCredentials).values({ fingerprint, retiredAt: new Date() });
          return "retired";
        }
        await tx.insert(operatorCredentials).values({ fingerprint });
        return "current";
      }

      if (!user) {
        const [created] = await tx
          .insert(users)
          .values({ email, displayName: "Platform operator", passwordHash: hash })
          .returning({ id: users.id });
        // A new operator email: every earlier credential (and so any earlier operator account on an
        // old deploy link) is retired.
        await retireOthers();
        await tx.insert(operatorCredentials).values({ fingerprint }).onConflictDoNothing();
        await audit(tx as unknown as TenantTx, {
          action: "operator.credential_provisioned",
          actorUserId: null,
          entityType: "user",
          entityId: created!.id,
          metadata: source,
        });
        return "provisioned";
      }
      const [membership] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(eq(memberships.userId, user.id))
        .limit(1);
      if (membership || user.disabledAt) {
        const reason = membership ? "practice_account" : "disabled";
        // Recorded once per configured hash, so a misconfiguration is visible without flooding.
        const [already] = await tx
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.action, "operator.credential_refused"),
              eq(auditEvents.entityId, user.id),
              sql`${auditEvents.metadata}->>'fingerprint' = ${source.fingerprint}`,
            ),
          )
          .limit(1);
        if (!already) {
          await audit(tx as unknown as TenantTx, {
            action: "operator.credential_refused",
            actorUserId: null,
            entityType: "user",
            entityId: user.id,
            metadata: { ...source, reason },
          });
        }
        return "refused";
      }

      await tx
        .update(users)
        .set({
          passwordHash: hash,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          totpSecretEnc: null,
          mfaEnrolledAt: null,
          totpLastStep: null,
        })
        .where(eq(users.id, user.id));
      // The new hash is recorded as applied and the old one as retired, so neither can come back
      // through a deployment that still carries the old configuration.
      const previous = credentialFingerprint(email, user.passwordHash);
      await retireOthers();
      await tx.insert(operatorCredentials).values({ fingerprint }).onConflictDoNothing();
      await tx
        .insert(operatorCredentials)
        .values({ fingerprint: previous, retiredAt: new Date() })
        .onConflictDoUpdate({ target: operatorCredentials.fingerprint, set: { retiredAt: new Date() } });
      const ended = await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      await audit(tx as unknown as TenantTx, {
        action: "operator.credential_rotated",
        actorUserId: null,
        entityType: "user",
        entityId: user.id,
        metadata: {
          ...source,
          previousFingerprint: previous.slice(0, 8),
          mfaReset: true,
          sessionsEnded: ended.length,
        },
      });
      return "rotated";
    })
    .catch((error: unknown) => {
      // A concurrent request applied the same configuration first (unique email or fingerprint).
      if (isUniqueViolation(error)) return "current";
      throw error;
    });
}
