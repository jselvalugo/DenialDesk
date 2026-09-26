import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "preview", "production"]),
  /** Optional on Netlify, where the platform supplies the database (src/platform/netlify). */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  /** Base64 of 32 random bytes (AES-256). Pre-prod only; Azure Key Vault in production (ADR 0002). */
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, "base64").length === 32, "must be base64 of 32 bytes"),
  /** "true" shows the one-click demo login (never in production, whatever this says). */
  DEMO_LOGIN_ENABLED: z.enum(["true", "false"]).optional(),
  /** The one account allowed into the platform operator console (/operator). */
  PLATFORM_OPERATOR_EMAIL: z.email().optional(),
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

/** Demo login is available only outside production and only when explicitly enabled. */
export function demoLoginEnabled(): boolean {
  return !isProduction() && process.env.DEMO_LOGIN_ENABLED === "true";
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
