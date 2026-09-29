import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";

/**
 * Per-request Content-Security-Policy with a script nonce (`src/lib/csp.ts`, SC-B10.1). Next.js
 * reads the nonce from the request's CSP header and applies it to its own scripts.
 */
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * Every path except static build assets, the image optimizer, the icon, and `/brand/`; those get
 * the static deny-all policy from `next.config.ts` instead (keep the two lists in step).
 */
export const config = {
  matcher: [{ source: "/((?!_next/static/|_next/image$|icon\\.png$|brand/).*)" }],
};
