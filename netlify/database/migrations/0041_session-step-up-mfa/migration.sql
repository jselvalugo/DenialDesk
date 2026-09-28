-- Generated from drizzle/0041_session_step_up_mfa.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;