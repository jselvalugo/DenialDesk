ALTER TABLE "audit_events" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "denials" ADD COLUMN "appeal_submitted_on" date;