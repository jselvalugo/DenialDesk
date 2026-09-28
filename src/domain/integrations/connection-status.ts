import { en } from "@/i18n/messages/en";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";

// Pure display helpers for a connection's lifecycle status (docs/specs/patient-integrations.md
// "PI1b"). Deliberately free of any `@/db/*` or `@/lib/audit` import: client components (the
// tab-bar drop-down, the record page's action buttons) import from here, not from
// `./connections`, so the database driver never reaches the browser bundle.

export type ConnectionStatus = "draft" | "pending_approval" | "active" | "paused" | "error" | "revoked";

type SettingsKey = MessageKey<"settings">;
type SettingsT = Translator<Messages["settings"]>;
/** English translator used when a caller doesn't have the request's language (e.g. unit tests). */
const englishSettingsT: SettingsT = createTranslator(en.settings, "en");

const STATUS_LABEL_KEYS = {
  draft: "integrations.status.draft",
  pending_approval: "integrations.status.pending_approval",
  active: "integrations.status.active",
  paused: "integrations.status.paused",
  error: "integrations.status.error",
  revoked: "integrations.status.revoked",
} as const satisfies Record<ConnectionStatus, SettingsKey>;

export function connectionStatusLabel(status: ConnectionStatus, t: SettingsT = englishSettingsT): string {
  return t(STATUS_LABEL_KEYS[status]);
}

const STATUS_TONES = {
  draft: "neutral",
  pending_approval: "info",
  active: "success",
  paused: "warning",
  error: "danger",
  revoked: "neutral",
} as const satisfies Record<ConnectionStatus, "neutral" | "info" | "success" | "warning" | "danger">;

export function connectionStatusTone(status: ConnectionStatus): (typeof STATUS_TONES)[ConnectionStatus] {
  return STATUS_TONES[status];
}

/** Fixed vocabulary for Revoke's reason code (matches `status_reason`'s `^[a-z_]{1,64}$` CHECK). */
export const REVOKE_REASON_CODES = [
  "no_longer_used",
  "switching_systems",
  "configured_in_error",
  "security_concern",
  "other",
] as const;
export type RevokeReasonCode = (typeof REVOKE_REASON_CODES)[number];
export const REVOKE_REASON_LABEL_KEYS = {
  no_longer_used: "integrations.revoke.reasonNoLongerUsed",
  switching_systems: "integrations.revoke.reasonSwitchingSystems",
  configured_in_error: "integrations.revoke.reasonConfiguredInError",
  security_concern: "integrations.revoke.reasonSecurityConcern",
  other: "integrations.revoke.reasonOther",
} as const satisfies Record<RevokeReasonCode, SettingsKey>;
