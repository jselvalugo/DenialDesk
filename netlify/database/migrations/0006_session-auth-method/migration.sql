-- Generated from drizzle/0006_session_auth_method.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "sessions" ADD COLUMN "auth_method" text DEFAULT 'password_mfa' NOT NULL;