import { SeedRefusedError, seedDemoPractice } from "@/db/demo";
import { auditSystem } from "@/lib/audit";
import { isProduction } from "@/lib/env";
import { limitCurrentRequest } from "@/lib/rate-limit";
import { authorizedBySeedToken } from "@/lib/seed-token";

// Pre-production only (ADR 0003): seeds the synthetic demo practice where the database is only
// reachable from inside the platform (Netlify Database). Locked three ways: 404 in production,
// a secret bearer token (SEED_TOKEN, ≥ 32 chars), and it only ever creates the demo practice once.
// Calling it again repairs the seeded admin (password from env, lockout cleared, optional MFA reset).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (isProduction()) return new Response(null, { status: 404 });
  const limited = await limitCurrentRequest("seed");
  if (!limited.allowed) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  if (!authorizedBySeedToken(request)) return new Response(null, { status: 404 });

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    return Response.json(
      { error: "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters)." },
      { status: 400 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as { resetMfa?: unknown };
  let status: Awaited<ReturnType<typeof seedDemoPractice>>;
  try {
    status = await seedDemoPractice({ email, password }, { resetMfa: body.resetMfa === true });
  } catch (error) {
    if (error instanceof SeedRefusedError) return Response.json({ error: error.message }, { status: 409 });
    throw error;
  }
  // Repairs are audited inside their own transaction (src/db/demo.ts).
  if (status === "seeded") await auditSystem({ action: "system.demo_seeded" });
  return Response.json({ status }, { headers: { "Cache-Control": "no-store" } });
}
