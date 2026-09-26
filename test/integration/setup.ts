// Integration tests run against a real, migrated PostgreSQL (DATABASE_URL).
if (!process.env.DATABASE_URL) {
  throw new Error("Integration tests need DATABASE_URL. Run `docker compose up db` and `pnpm db:migrate`.");
}
process.env.APP_ENV ||= "development";
// Test-only key; real keys come from Netlify env (pre-prod) or Key Vault (prod).
process.env.FIELD_ENCRYPTION_KEY ||= Buffer.alloc(32, 1).toString("base64");
process.env.DEMO_LOGIN_ENABLED ||= "true";
