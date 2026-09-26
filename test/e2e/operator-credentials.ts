// The platform operator's credential for the e2e preview server only. Synthetic, test-only values:
// the server gets the hash through configuration (playwright.config.ts), like production would, and
// global-setup enrolls two-step for the same account (docs/specs/operator-login.md).
export const E2E_OPERATOR_EMAIL = "platform-operator@e2e.denialdesk.test";
export const E2E_OPERATOR_PASSWORD = "e2e synthetic operator passphrase";
export const E2E_OPERATOR_PASSWORD_HASH =
  "scrypt$131072$8$1$fd64mHLgDDwHmfgekWwbZg$Es1yD6PVdfuQSBjlvOXhy3Y1Zth0wMyy3o60DqexwUmvz7zeLTdc19mC1qGg5hAYBBlZtks9RzhE4tQrPlmu1A";
