# Spec: Sign-in, MFA, and sessions

Status: done (2026-09-26) — approved by delegated technical authority
Roadmap item: Phase 0 → "Auth: OIDC SSO behind an interface…, MFA, session timeouts"
Requirement IDs: R-7.2.2, R-7.2.7, R-7.2.9, R-7.5.1

## Acceptance criteria
- [x] Email + password sign-in; scrypt hashing (N=2^17); generic error for wrong password and
      unknown account, with equal timing.
- [x] TOTP MFA (RFC 6238) required for every account; first sign-in enrolls via QR code or key;
      codes are single-use (replay-protected); ±1 step drift.
- [x] Password alone never opens the app; session token rotated after MFA.
- [x] Sessions: DB-backed, hashed token, `__Host-` cookie (HttpOnly, Secure, SameSite=Lax);
      15-minute idle and 12-hour absolute timeouts; warning dialog 2 minutes before idle logout.
- [x] Lockout: 5 attempts (password or MFA) → 15 minutes. Each attempt is reserved atomically
      before checking; only a completed sign-in resets the count. Lock responses reuse the
      wrong-password message so they don't reveal which accounts exist.
- [x] MFA codes claimed atomically (no double use under concurrent submissions).
- [x] Nonce-based Content-Security-Policy on every page.
- [x] Sign-in, failures, lockouts, MFA enrollment, sign-out, and expiry are audit events.
- [x] Roles: admin, manager, specialist, compliance (read-only for denials).
- [x] E2E tests: redirect when signed out, wrong password, unknown account, password-only,
      lockout, first-time enrollment, role display.
- [x] Sign-in page design (owner request, 2026-09-26; R-7.2.2 sign-in surface, §11): every step
      under `/login` shows the DenialDesk reception image (`public/brand/denialdesk-reception.jpg`,
      synthetic render, no PHI, provenance in `public/brand/README.md`) in a matted frame. At 1024px
      and wider the image and a short product description sit beside the card; below that the image
      alone stacks above the card. Borders and a hairline shadow only, per DESIGN.md §3 and §7; the
      product text is Inter (§6). The image is decorative (`alt=""`); the logo still names the
      product. `/login` fits 1280×800 without scrolling and the platform console sign-in has no
      image (both covered by `test/e2e/auth.spec.ts`).

## Deferred
- Customer SSO (SAML/OIDC, Entra ID) and SCIM — at Azure cutover (R-7.2.1).
- Phishing-resistant MFA (WebAuthn) for admins (R-7.2.2) — next auth iteration.
- Breached-password screening (R-7.2.9); admin MFA reset; practice switcher for multi-practice users.
