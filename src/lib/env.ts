import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "preview", "production"]),
  /** Optional on Netlify, where the platform supplies the database (src/platform/netlify). */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  /** Base64 of 32 random bytes (AES-256). Pre-prod only; Azure Key Vault in production (ADR 0002). */
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "must be base64 of 32 bytes"),
  /**
   * The platform operator's account (/operator/login). Must be an address used only for the
   * console: an account with a practice membership never qualifies (docs/specs/operator-login.md).
   */
  PLATFORM_OPERATOR_EMAIL: z.email().optional(),
  /**
   * scrypt hash of the operator's password, from `pnpm operator:credential` (secret). The operator
   * account exists only as provisioned from this; changing it resets the password and two-step.
   */
  // Validated strictly where it's used (src/auth/operator-account.ts): a bad value switches the
  // console off rather than stopping the whole app.
  PLATFORM_OPERATOR_PASSWORD_HASH: z.string().optional(),
  /**
   * `off` lets the operator sign in with the password alone (owner decision, 2026-09-26, while the
   * console is being set up). Ignored in production: two-step is always required there (R-7.2.2).
   */
  PLATFORM_OPERATOR_MFA: z.enum(["on", "off"]).optional(),
  /**
   * Extra ports a real EHR/PM base URL may use, comma-separated (docs/specs/patient-integrations.md
   * "PI1b"). Port 443 is always allowed regardless of this value. Parsed defensively in
   * `src/integrations/fhir/url-rules.ts`, never trusted as-is.
   */
  INTEGRATION_ALLOWED_PORTS: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

/** Parses env vars; throws with the names (never the values) of any invalid variables. */
export function parseEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
    throw new Error(`Invalid or missing environment variables: ${names.join(", ")}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

/**
 * APP_ENV for rendering decisions. Doesn't require the full server env, so static pages can build
 * without a database. Anything not explicitly "production" is treated as non-production.
 */
export function appEnv(): string {
  return process.env.APP_ENV || "development";
}

export function isProduction(): boolean {
  return appEnv() === "production";
}

/**
 * True when running on Netlify (pre-production only, ADR 0003). Checked from several variables the
 * platform sets, so a mistaken APP_ENV=production on Netlify can't unlock real-PHI features.
 */
export function onNetlify(): boolean {
  return Boolean(
    process.env.NETLIFY || process.env.NETLIFY_DB_URL || process.env.DEPLOY_ID || process.env.SITE_ID,
  );
}

/** Only production outside Netlify may accept real patient files; everywhere else is synthetic-only. */
export function syntheticDataOnly(): boolean {
  return !isProduction() || onNetlify();
}
