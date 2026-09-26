import { z } from "zod";

const schema = z.object({
  APP_ENV: z.enum(["development", "preview", "production"]),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
