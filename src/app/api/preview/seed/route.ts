import { createHash, timingSafeEqual } from "node:crypto";
import { seedDemoPractice } from "@/db/demo";
import { auditSystem } from "@/lib/audit";
import { isProduction } from "@/lib/env";
import { limitCurrentRequest } from "@/lib/rate-limit";

// Pre-production only (ADR 0003): seeds the synthetic demo practice where the database is only
// reachable from inside the platform (Netlify Database). Locked three ways: 404 in production,
// a secret bearer token (SEED_TOKEN, ≥ 32 chars), and it only ever creates the demo practice once.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const digest = (value: string) => createHash("sha256").update(value).digest();

function authorized(request: Request): boolean {
  const expected = process.env.SEED_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || expected.length < 32 || !supplied) return false;
  return timingSafeEqual(digest(supplied), digest(expected));
}

export async function POST(request: Request) {
  if (isProduction()) return new Response(null, { status: 404 });
  const limited = await limitCurrentRequest("seed");
  if (!limited.allowed) {
    return new Response(null, { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } });
  }
  if (!authorized(request)) return new Response(null, { status: 404 });

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) {
    return Response.json(
      { error: "Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters)." },
      { status: 400 },
    );
  }
  const status = await seedDemoPractice({ email, password });
  if (status === "seeded") await auditSystem({ action: "system.demo_seeded" });
  return Response.json({ status }, { headers: { "Cache-Control": "no-store" } });
}
