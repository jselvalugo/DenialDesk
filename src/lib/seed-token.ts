import { createHash, timingSafeEqual } from "node:crypto";

// SEED_TOKEN guards the pre-production maintenance endpoints under /api/preview (ADR 0003): the
// seed/repair of the synthetic sample practice and the operator configuration status. It has no
// operator power: it can't create, reset or read the operator credential.

const digest = (value: string) => createHash("sha256").update(value).digest();

/** True only when the request carries the configured SEED_TOKEN (at least 32 characters) as a bearer token. */
export function authorizedBySeedToken(request: Request): boolean {
  const expected = process.env.SEED_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!expected || expected.length < 32 || !supplied) return false;
  return timingSafeEqual(digest(supplied), digest(expected));
}
