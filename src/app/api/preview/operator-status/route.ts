import { and, gt, isNull, sql } from "drizzle-orm";
import { operatorConfigurationStatus, operatorEmail, syncOperatorAccount } from "@/auth/operator-account";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { isProduction } from "@/lib/env";
import { log } from "@/lib/log";
import { limitCurrentRequest } from "@/lib/rate-limit";
import { authorizedBySeedToken } from "@/lib/seed-token";

// Pre-production only (ADR 0003): says why the operator can or can't sign in, for the owner holding
// SEED_TOKEN (docs/specs/operator-login.md). Reports fixed words only: never an email, a hash, or
// anything derived from them. 404 in production, without the token, or with a wrong token; rate
// limited like the seed endpoint. It syncs the account from configuration exactly as a sign-in does.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (isProduction()) return new Response(null, { status: 404 });
  const limited = await limitCurrentRequest("seed");
  if (!limited.allowed) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  if (!authorizedBySeedToken(request)) return new Response(null, { status: 404 });

  const configuration = operatorConfigurationStatus();
  const account = await syncOperatorAccount("status_check");
  let locked: boolean | null = null;
  const email = operatorEmail();
  if (email && (account === "current" || account === "provisioned" || account === "rotated")) {
    const [row] = await systemDb()
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          sql`lower(${users.email}) = ${email}`,
          isNull(users.disabledAt),
          gt(users.lockedUntil, sql`now()`),
        ),
      )
      .limit(1);
    locked = row !== undefined;
  }
  const status = { ...configuration, account, locked };
  log.info("operator.status_checked", { status: `${status.email}/${status.passwordHash}/${account}` });
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
