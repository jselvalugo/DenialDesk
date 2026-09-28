import type { Messages } from "../types";

export const auth: Messages["auth"] = {
  // Sign-in card chrome (components/auth/AuthCard.tsx)
  "hero.tagline": "Gestão de reivindicações e negativas para clínicas médicas da Flórida.",
  "hero.description":
    "Classifique negativas, priorize por valor e prazo, redija recursos e acompanhe todos os prazos de pagamento pontual e de recurso.",
  "footer.monitored": "Uso autorizado apenas. O acesso a este sistema é monitorado e registrado.",
  "operator.consoleLabel": "Console da plataforma",

  // Practice sign-in (app/login/page.tsx, SignInForm.tsx)
  "signIn.title": "Entrar",
  "signIn.subtitle":
    "Use a conta da sua clínica. Em seguida, você confirmará com seu aplicativo autenticador.",
  "signIn.emailLabel": "E-mail profissional",
  "signIn.passwordLabel": "Senha",
  "signIn.submit": "Entrar",
  "signIn.submitting": "Entrando…",
  "notice.timeout": "Sua sessão foi encerrada após {minutes} minutos sem atividade.",
  "notice.locked":
    "Muitas tentativas. Tente novamente em {minutes} minutos ou entre em contato com o administrador.",
  "notice.operatorLocked": "Muitas tentativas. Tente novamente em {minutes} minutos.",
  "error.noPractice":
    "Sua conta ainda não está vinculada a nenhuma clínica. Entre em contato com o administrador.",
  "error.practiceSuspended":
    "O acesso desta clínica está suspenso. Entre em contato com o suporte da DenialDesk.",
  "error.enterEmailPassword": "Informe seu e-mail e senha.",
  "error.signInFailed":
    "O e-mail ou a senha estão incorretos, ou a conta está temporariamente bloqueada. Tente novamente em {minutes} minutos ou entre em contato com o administrador.",

  // Two-step verification at sign-in (app/login/mfa/**)
  "mfaVerify.pageTitle": "Verificar acesso",
  "mfaVerify.title": "Verificação em duas etapas",
  "mfaVerify.subtitle": "Informe o código exibido no seu aplicativo autenticador.",
  "mfaVerify.lostAccess":
    "Perdeu o acesso ao seu autenticador? Peça ao administrador da sua clínica para redefini-lo. <a>Usar outra conta</a>",
  "mfa.codeLabel": "Código de 6 dígitos",
  "mfa.verifying": "Verificando…",
  "mfa.verifySubmit": "Verificar",
  "mfa.enrollSubmit": "Ativar a verificação em duas etapas",
  "error.enterCode": "Informe o código de 6 dígitos do seu aplicativo autenticador.",
  "error.codeMismatch":
    "Esse código não corresponde. Verifique seu aplicativo autenticador e tente novamente.",
  "error.codeReused": "Esse código já foi usado. Aguarde o próximo código e tente novamente.",

  // Two-step enrollment (app/login/mfa/setup/page.tsx, components/auth/TotpEnrollment.tsx)
  "mfaSetup.title": "Configurar a verificação em duas etapas",
  "mfaSetup.instructions":
    "Obrigatório para todas as contas. Leia este código com um aplicativo autenticador, como o Microsoft Authenticator, e depois informe o código de 6 dígitos exibido.",
  "mfaSetup.qrLabel": "Código QR para o seu aplicativo autenticador",
  "mfaSetup.manualKeyLabel": "Não consegue ler o código? Informe esta chave",

  // Choose a password (app/login/password/**)
  "password.pageTitle": "Escolher uma senha",
  "password.title": "Escolha sua senha",
  "password.subtitle":
    "Você entrou com uma senha temporária. Escolha a sua antes de configurar a verificação em duas etapas.",
  "password.newLabel": "Nova senha",
  "password.hint": "No mínimo 12 caracteres. Uma frase curta é mais fácil de lembrar do que símbolos.",
  "password.confirmLabel": "Confirmar nova senha",
  "password.submit": "Definir senha",
  "error.enterConfirmPassword": "Informe e confirme sua nova senha.",
  "error.passwordsMismatch": "As senhas não coincidem.",
  "error.passwordSameAsTemporary": "Escolha uma senha diferente da temporária.",
  "error.passwordTooShort": "Use no mínimo 12 caracteres.",
  "error.passwordTooLong": "Use no máximo 128 caracteres.",

  // Rate limiting (auth/credentials.ts)
  "rateLimit.tooMany":
    "Muitas {what} da sua rede. Tente novamente em {minutes, plural, one {# minuto} other {# minutos}}.",
  "rateLimit.signInAttempts": "tentativas de acesso",
  "rateLimit.mfaAttempts": "tentativas de verificação",

  // Platform console (operator) sign-in (app/operator/(auth)/**)
  "operatorSignIn.pageTitle": "Acesso ao console da plataforma",
  "operatorSignIn.title": "Acesso do operador",
  "operatorSignIn.subtitle":
    "Somente para o operador da plataforma. Os usuários da clínica acessam pela <a>página de acesso da clínica</a>.",
  "operatorMfaVerify.pageTitle": "Verificar acesso do operador",
  "operatorMfaSetup.pageTitle": "Configurar a verificação em duas etapas do operador",

  "stepUp.pageTitle": "Verifique sua identidade",
  "stepUp.title": "Verifique sua identidade",
  "stepUp.subtitle": "Esta ação precisa de um novo código do seu aplicativo autenticador.",
  "stepUp.submit": "Verificar",
  "stepUp.cancel": "Cancelar",
  "error.tooManyAttempts": "Muitas tentativas. Tente novamente em {minutes} minutos.",
};
