// The configured platform operator email (PLATFORM_OPERATOR_EMAIL). No server-only imports, so the
// seed script (scripts/seed.ts, plain Node) can use it too.

/** The configured operator email, normalized, or null when the console is switched off. */
export function operatorEmail(): string | null {
  const email = process.env.PLATFORM_OPERATOR_EMAIL?.trim().toLowerCase();
  return email ? email : null;
}

export function isOperatorEmail(email: string): boolean {
  const configured = operatorEmail();
  return configured !== null && email.trim().toLowerCase() === configured;
}
