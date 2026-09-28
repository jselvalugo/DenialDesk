/**
 * Gate for the transport's and address guard's test-only options (`ca`, `allowAddress`, `resolve`,
 * timeout/size overrides). Each of them weakens or bypasses a control (trust anchor, SSRF guard, DoS
 * limits), so passing one outside a test run is a programming error and throws rather than silently
 * taking effect.
 *
 * Requires a positive test signal (Vitest sets `VITEST=true`; `NODE_ENV=test` otherwise). It
 * deliberately does not reuse `syntheticDataOnly()`, which fails toward "synthetic" for data safety
 * and would therefore fail open here (security re-review L1, PR #83): pre-production on Netlify does
 * not need these options, so they are refused there too.
 */
export function testRunActive(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

export function assertTestOnlyOption(name: string): void {
  if (!testRunActive()) {
    throw new Error(
      `The "${name}" option is test-only and cannot be used outside a test run (CLAUDE.md non-negotiables #1, #6).`,
    );
  }
}
