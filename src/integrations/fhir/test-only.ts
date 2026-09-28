/**
 * Gate for the transport's and address guard's test-only options (`ca`, `allowAddress`, `resolve`,
 * timeout/size overrides). Each of them weakens or bypasses a control (trust anchor, SSRF guard, DoS
 * limits), so passing one outside a test or synthetic environment is a programming error and throws
 * rather than silently taking effect. Uses the project's existing gate (`syntheticDataOnly()`,
 * `src/lib/env.ts`): true for tests and every non-production environment (including pre-production
 * on Netlify, ADR 0003); false only for production outside Netlify.
 */
import { syntheticDataOnly } from "@/lib/env";

export function assertTestOnlyOption(name: string): void {
  if (!syntheticDataOnly()) {
    throw new Error(
      `The "${name}" option is test-only and cannot be used in production (CLAUDE.md non-negotiables #1, #6).`,
    );
  }
}
