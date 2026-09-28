/**
 * Messages for the auth pages: practice and operator sign-in, two-step verification, and the
 * choose-a-password step (src/app/login/**, src/app/operator/(auth)/**, components/auth/**).
 * Flat keys, dotted for grouping; values are the English source text.
 */
export const auth = {
  // Sign-in card chrome (components/auth/AuthCard.tsx)
  "hero.tagline": "Claims and denial management for Florida physician practices.",
  "hero.description":
    "Classify denials, prioritize by value and deadline, draft appeals, and keep every prompt-pay and appeal clock in view.",
  "footer.monitored": "Authorized use only. Access to this system is monitored and logged.",
  "operator.consoleLabel": "Platform console",

  // Practice sign-in (app/login/page.tsx, SignInForm.tsx)
  "signIn.title": "Sign in",
  "signIn.subtitle": "Use your practice account. You'll confirm with your authenticator app next.",
  "signIn.emailLabel": "Work email",
  "signIn.passwordLabel": "Password",
  "signIn.submit": "Sign in",
  "signIn.submitting": "Signing in…",
  "notice.timeout": "You were signed out after {minutes} minutes without activity.",
  "notice.locked": "Too many attempts. Try again in {minutes} minutes or contact your administrator.",
  "notice.operatorLocked": "Too many attempts. Try again in {minutes} minutes.",
  "error.noPractice": "Your account isn't linked to a practice yet. Contact your administrator.",
  "error.practiceSuspended": "This practice's access is suspended. Contact DenialDesk support.",
  "error.enterEmailPassword": "Enter your email and password.",
  "error.signInFailed":
    "Email or password is incorrect, or the account is temporarily locked. Try again in {minutes} minutes or contact your administrator.",

  // Two-step verification at sign-in (app/login/mfa/**)
  "mfaVerify.pageTitle": "Verify sign-in",
  "mfaVerify.title": "Two-step verification",
  "mfaVerify.subtitle": "Enter the code shown in your authenticator app.",
  "mfaVerify.lostAccess":
    "Lost access to your authenticator? Ask your practice administrator to reset it. <a>Use a different account</a>",
  "mfa.codeLabel": "6-digit code",
  "mfa.verifying": "Verifying…",
  "mfa.verifySubmit": "Verify",
  "mfa.enrollSubmit": "Turn on two-step verification",
  "error.enterCode": "Enter the 6-digit code from your authenticator app.",
  "error.codeMismatch": "That code didn't match. Check your authenticator app and try again.",
  "error.codeReused": "That code was already used. Wait for the next code and try again.",

  // Two-step enrollment (app/login/mfa/setup/page.tsx, components/auth/TotpEnrollment.tsx)
  "mfaSetup.title": "Set up two-step verification",
  "mfaSetup.instructions":
    "Required for every account. Scan this code with an authenticator app such as Microsoft Authenticator, then enter the 6-digit code it shows.",
  "mfaSetup.qrLabel": "QR code for your authenticator app",
  "mfaSetup.manualKeyLabel": "Can't scan? Enter this key",

  // Choose a password (app/login/password/**)
  "password.pageTitle": "Choose a password",
  "password.title": "Choose your password",
  "password.subtitle":
    "You signed in with a temporary password. Choose your own before setting up two-step verification.",
  "password.newLabel": "New password",
  "password.hint": "At least 12 characters. A short phrase is easier to remember than symbols.",
  "password.confirmLabel": "Confirm new password",
  "password.submit": "Set password",
  "error.enterConfirmPassword": "Enter and confirm your new password.",
  "error.passwordsMismatch": "The passwords don't match.",
  "error.passwordSameAsTemporary": "Choose a password different from the temporary one.",
  "error.passwordTooShort": "Use at least 12 characters.",
  "error.passwordTooLong": "Use at most 128 characters.",

  // Rate limiting (auth/credentials.ts)
  "rateLimit.tooMany":
    "Too many {what} from your network. Try again in {minutes, plural, one {# minute} other {# minutes}}.",
  "rateLimit.signInAttempts": "sign-in attempts",
  "rateLimit.mfaAttempts": "verification attempts",

  // Platform console (operator) sign-in (app/operator/(auth)/**)
  "operatorSignIn.pageTitle": "Platform console sign-in",
  "operatorSignIn.title": "Operator sign-in",
  "operatorSignIn.subtitle":
    "For the platform operator only. Practice users sign in at <a>the practice sign-in page</a>.",
  "operatorMfaVerify.pageTitle": "Verify operator sign-in",
  "operatorMfaSetup.pageTitle": "Set up operator two-step verification",
  // Step-up re-verification (R-7.2.2; app/(app)/step-up/**): a sensitive action (Submit, resume)
  // needs MFA confirmed again within the last 5 minutes.
  "stepUp.pageTitle": "Verify your identity",
  "stepUp.title": "Verify your identity",
  "stepUp.subtitle": "This action needs a fresh code from your authenticator app.",
  "stepUp.cancel": "Cancel",
  "error.tooManyAttempts":
    "Too many attempts. This account is locked for up to {minutes} minutes; try again after that.",
} as const;
