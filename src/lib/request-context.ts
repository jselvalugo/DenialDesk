import { headers } from "next/headers";

/**
 * Where a request came from, for audit events (R-7.5.1 "where").
 * The client IP comes from headers our hosting platform sets and clients can't forge:
 * Netlify (x-nf-client-connection-ip), Azure Front Door (x-azure-clientip). Otherwise the last
 * X-Forwarded-For hop, which the nearest proxy appends (the first hop is client-controlled).
 * Returns nulls outside a request (scripts, tests).
 */
export async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h
      .get("x-forwarded-for")
      ?.split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const ip = h.get("x-nf-client-connection-ip") ?? h.get("x-azure-clientip") ?? forwarded?.at(-1) ?? null;
    const userAgent = h.get("user-agent")?.slice(0, 256) ?? null;
    return { ip, userAgent };
  } catch {
    return { ip: null, userAgent: null };
  }
}
