import type { Messages } from "../types";

export const auth: Messages["auth"] = {
  // Sign-in card chrome (components/auth/AuthCard.tsx)
  "hero.tagline": "Gestión de reclamaciones y denegaciones para consultorios médicos de Florida.",
  "hero.description":
    "Clasifique denegaciones, priorice por valor y plazo, redacte apelaciones y mantenga a la vista cada plazo de pago puntual y de apelación.",
  "footer.monitored": "Uso autorizado únicamente. El acceso a este sistema es supervisado y registrado.",
  "operator.consoleLabel": "Consola de la plataforma",

  // Practice sign-in (app/login/page.tsx, SignInForm.tsx)
  "signIn.title": "Iniciar sesión",
  "signIn.subtitle":
    "Use la cuenta de su consultorio. A continuación, confirmará con su aplicación de autenticación.",
  "signIn.emailLabel": "Correo electrónico laboral",
  "signIn.passwordLabel": "Contraseña",
  "signIn.submit": "Iniciar sesión",
  "signIn.submitting": "Iniciando sesión…",
  "notice.timeout": "Se cerró su sesión tras {minutes} minutos sin actividad.",
  "notice.locked":
    "Demasiados intentos. Vuelva a intentarlo en {minutes} minutos o comuníquese con su administrador.",
  "notice.operatorLocked": "Demasiados intentos. Vuelva a intentarlo en {minutes} minutos.",
  "error.noPractice":
    "Su cuenta aún no está vinculada a ningún consultorio. Comuníquese con su administrador.",
  "error.practiceSuspended":
    "El acceso de este consultorio está suspendido. Comuníquese con el soporte de DenialDesk.",
  "error.enterEmailPassword": "Ingrese su correo electrónico y contraseña.",
  "error.signInFailed":
    "El correo electrónico o la contraseña son incorrectos, o la cuenta está bloqueada temporalmente. Vuelva a intentarlo en {minutes} minutos o comuníquese con su administrador.",

  // Two-step verification at sign-in (app/login/mfa/**)
  "mfaVerify.pageTitle": "Verificar inicio de sesión",
  "mfaVerify.title": "Verificación en dos pasos",
  "mfaVerify.subtitle": "Ingrese el código que muestra su aplicación de autenticación.",
  "mfaVerify.lostAccess":
    "¿Perdió el acceso a su aplicación de autenticación? Pida al administrador de su consultorio que la restablezca. <a>Usar otra cuenta</a>",
  "mfa.codeLabel": "Código de 6 dígitos",
  "mfa.verifying": "Verificando…",
  "mfa.verifySubmit": "Verificar",
  "mfa.enrollSubmit": "Activar la verificación en dos pasos",
  "error.enterCode": "Ingrese el código de 6 dígitos de su aplicación de autenticación.",
  "error.codeMismatch": "Ese código no coincide. Revise su aplicación de autenticación e inténtelo de nuevo.",
  "error.codeReused": "Ese código ya se usó. Espere el próximo código e inténtelo de nuevo.",

  // Two-step enrollment (app/login/mfa/setup/page.tsx, components/auth/TotpEnrollment.tsx)
  "mfaSetup.title": "Configurar la verificación en dos pasos",
  "mfaSetup.instructions":
    "Obligatorio para todas las cuentas. Escanee este código con una aplicación de autenticación, como Microsoft Authenticator, y luego ingrese el código de 6 dígitos que muestra.",
  "mfaSetup.qrLabel": "Código QR para su aplicación de autenticación",
  "mfaSetup.manualKeyLabel": "¿No puede escanear? Ingrese esta clave",

  // Choose a password (app/login/password/**)
  "password.pageTitle": "Elegir una contraseña",
  "password.title": "Elija su contraseña",
  "password.subtitle":
    "Inició sesión con una contraseña temporal. Elija la suya antes de configurar la verificación en dos pasos.",
  "password.newLabel": "Nueva contraseña",
  "password.hint": "Al menos 12 caracteres. Una frase corta es más fácil de recordar que los símbolos.",
  "password.confirmLabel": "Confirmar nueva contraseña",
  "password.submit": "Establecer contraseña",
  "error.enterConfirmPassword": "Ingrese y confirme su nueva contraseña.",
  "error.passwordsMismatch": "Las contraseñas no coinciden.",
  "error.passwordSameAsTemporary": "Elija una contraseña diferente de la temporal.",
  "error.passwordTooShort": "Use al menos 12 caracteres.",
  "error.passwordTooLong": "Use como máximo 128 caracteres.",

  // Rate limiting (auth/credentials.ts)
  "rateLimit.tooMany":
    "Demasiados {what} desde su red. Vuelva a intentarlo en {minutes, plural, one {# minuto} other {# minutos}}.",
  "rateLimit.signInAttempts": "intentos de inicio de sesión",
  "rateLimit.mfaAttempts": "intentos de verificación",

  // Platform console (operator) sign-in (app/operator/(auth)/**)
  "operatorSignIn.pageTitle": "Inicio de sesión de la consola de la plataforma",
  "operatorSignIn.title": "Inicio de sesión del operador",
  "operatorSignIn.subtitle":
    "Solo para el operador de la plataforma. Los usuarios del consultorio inician sesión en <a>la página de inicio de sesión del consultorio</a>.",
  "operatorMfaVerify.pageTitle": "Verificar inicio de sesión del operador",
  "operatorMfaSetup.pageTitle": "Configurar la verificación en dos pasos del operador",
};
