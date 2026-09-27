import type { Messages } from "../types";

export const operator: Messages["operator"] = {
  // Shared status words (practices list and practice detail)
  "status.active": "Ativa",
  "status.suspended": "Suspensa",
  "status.archived": "Arquivada",
  "status.demo": "Demonstração",
  "status.customer": "Cliente",

  // Business Associate Agreement status for a practice (AgreementStatusBadge)
  "badge.missing": "Sem BAA",
  "badge.notYetEffective": "Ainda não vigente",
  "badge.expiringSoon": "Vencendo em breve",
  "badge.expired": "Expirado",

  // Status of one agreement record (practice detail table)
  "recordStatus.superseded": "Substituído",
  "recordStatus.historical": "Histórico",
  "recordStatus.voided": "Registrado por engano",

  // Shared navigation
  "nav.allPractices": "Todas as clínicas",
  "nav.breadcrumbLabel": "Trilha de navegação",

  // Practices list (page.tsx)
  "list.title": "Clínicas",
  "list.description":
    "Todas as clínicas neste ambiente do DenialDesk. Somente dados no nível da clínica; os dados dos pacientes permanecem dentro de cada clínica.",
  "list.newPractice": "Nova clínica",
  "list.totalsLabel": "Totais da plataforma",
  "list.stat.customers": "Clínicas clientes",
  "list.stat.withoutBaa": "Sem um BAA vigente",
  "list.stat.openDenials": "Negativas em aberto (todas as clínicas)",
  "list.panelTitle": "Todas as clínicas",
  "list.tableCaption": "Todas as clínicas neste ambiente",
  "list.columns.team": "Equipe",
  "list.columns.openDenials": "Negativas em aberto",
  "list.columns.baa": "BAA",
  "list.suspend": "Suspender",
  "list.reactivate": "Reativar",
  "list.suspendAria": "Suspender {name}",
  "list.reactivateAria": "Reativar {name}",

  // New practice (practices/new)
  "newPractice.title": "Nova clínica",
  "newPractice.description":
    "Cria a clínica e seu primeiro administrador, que poderá então adicionar sua equipe. Em seguida, registre o BAA assinado na página da clínica.",
  "newPractice.practiceNameLabel": "Nome da clínica",
  "newPractice.adminNameLabel": "Nome completo do administrador",
  "newPractice.adminEmailLabel": "E-mail profissional do administrador",
  "newPractice.submit": "Criar clínica",
  "newPractice.creating": "Criando…",
  "newPractice.createdHeading": "{name} criada",
  "newPractice.sendDetails":
    "Envie ao administrador os dados de acesso por um canal seguro. Esta senha é exibida apenas uma vez.",
  "newPractice.temporaryPasswordLabel": "Senha temporária",
  "newPractice.mfaHint": "A verificação em duas etapas será configurada no primeiro acesso.",
  "newPractice.openPractice": "Abrir clínica",
  "newPractice.createAnother": "Criar outra",

  // Practice detail (practices/[tenantId])
  "practice.metaTitle": "Clínica",
  "practice.descriptionCustomer": "Clínica cliente. Somente dados no nível da clínica.",
  "practice.descriptionDemo": "Clínica de demonstração com dados sintéticos.",
  "practice.panelTitle": "Clínica",
  "practice.baaTitle": "Acordo de associado comercial (BAA)",
  "practice.baaDescription": "O acordo assinado registrado para esta clínica, e todas as versões anteriores.",
  "practice.noAgreement":
    "Nenhum acordo registrado. Registre o BAA assinado abaixo antes que esta clínica lide com dados de pacientes.",
  "practice.tableCaption": "Acordos registrados",
  "practice.columns.effective": "Vigência",
  "practice.columns.expires": "Expira",
  "practice.columns.signed": "Assinado",
  "practice.columns.practiceSigner": "Signatário da clínica",
  "practice.columns.ourSigner": "Signatário da DenialDesk",
  "practice.columns.recorded": "Registrado",
  "practice.columns.file": "Arquivo",
  "practice.untilTerminated": "Até o término",
  "practice.voidedNote": "Registrado por engano: {reason}",
  "practice.fileHashTitle": "SHA-256 {sha}",
  "practice.recordTitleRenew": "Registrar um acordo renovado",
  "practice.recordTitleNew": "Registrar o acordo assinado",
  "practice.recordDescription":
    "Armazenado com a clínica durante o período de retenção; os acordos nunca são editados nem excluídos.",
  "practice.correctTitle": "Corrigir o registro",
  "practice.correctDescription":
    "Um envio incorreto ou um erro de digitação não pode ser editado. Marque o acordo como registrado por engano e, em seguida, registre o correto; ambos permanecem arquivados.",

  // Record agreement form
  "agreementForm.replacesActive":
    "Registrar um novo acordo substitui o que está ativo atualmente. O atual permanece arquivado como substituído.",
  "agreementForm.fileLabel": "Acordo assinado (PDF, até 5 MB)",
  "agreementForm.effectiveDateLabel": "Data de vigência",
  "agreementForm.expiresOnLabel": "Expira em",
  "agreementForm.expiresOnHint": "Deixe em branco se vigorar até o término.",
  "agreementForm.signedOnLabel": "Data de assinatura",
  "agreementForm.practiceSignerLabel": "Assinado em nome da clínica por",
  "agreementForm.ourSignerLabel": "Assinado em nome da DenialDesk por",
  "agreementForm.nameAndTitleHint": "Nome e cargo.",
  "agreementForm.noteLabel": "Observação",
  "agreementForm.noteHint": "Opcional. Sem informações de pacientes.",
  "agreementForm.syntheticAttestation":
    "Este é um documento de teste sintético, não um acordo real. O nome do arquivo começa com <code>{prefix}</code>; acordos reais são rejeitados neste ambiente.",
  "agreementForm.submit": "Registrar acordo",
  "agreementForm.recording": "Registrando…",
  "agreementForm.recorded": "{filename} registrado como o acordo ativo.",
  "agreementForm.recordedSuperseded":
    "{filename} registrado como o acordo ativo; o acordo anterior permanece arquivado como substituído.",

  // Void (record in error) agreement form
  "voidForm.recordedNotice":
    "O acordo está marcado como registrado por engano. Permanece arquivado e não conta mais.",
  "voidForm.agreementLabel": "Acordo",
  "voidForm.choosePlaceholder": "Escolha um acordo",
  "voidForm.optionLabel": "{filename} · vigência {date} · {status}",
  "voidForm.reasonLabel": "Por que foi registrado por engano",
  "voidForm.reasonHint": "Mantido com o registro e no registro de auditoria. Sem informações de pacientes.",
  "voidForm.submit": "Marcar como registrado por engano",
  "voidForm.marking": "Marcando…",

  // Server-action and domain errors
  "errors.createFormInvalid": "Informe o nome da clínica, o nome do administrador e um e-mail válido.",
  "errors.invalidRequest": "Solicitação inválida.",
  "errors.agreementFormInvalid": "Informe as datas de vigência e de assinatura, e ambos os signatários.",
  "errors.voidFormInvalid": "Escolha o acordo e explique por que foi registrado por engano.",
  "errors.chooseFile": "Escolha o acordo assinado como um arquivo PDF.",
  "errors.fileTooLarge": "O arquivo tem mais de 5 MB. Exporte o PDF assinado com uma resolução mais baixa.",
  "errors.fileNameInvalid":
    "O nome do arquivo é muito longo ou contém caracteres incomuns. Renomeie o arquivo.",
  "errors.fileNotPdf": "O arquivo não é um PDF. Envie o acordo assinado como um PDF.",
  "errors.syntheticPrefixRequired":
    "Este ambiente aceita apenas clínicas sintéticas. Nomeie os arquivos de teste com {prefix}… e nunca envie um acordo real aqui.",
  "errors.attestSyntheticRequired": "Confirme que o arquivo é um documento de teste sintético.",
  "errors.expiresBeforeEffective": "A data de expiração não pode ser anterior à data de vigência.",
  "errors.signedInFuture": "A data de assinatura não pode estar no futuro.",
  "errors.practiceNotFound": "Essa clínica não existe mais ou não é uma clínica cliente.",
  "errors.agreementRace":
    "Outro acordo acabou de ser registrado para esta clínica. Recarregue a página para vê-lo.",
  "errors.voidReasonTooShort":
    "Explique por que o acordo foi registrado por engano (pelo menos algumas palavras).",
  "errors.agreementNotFound":
    "Esse acordo não está registrado para esta clínica, ou já está marcado como registrado por engano.",
  "errors.emailExists": "Já existe uma conta com esse e-mail.",

  // Painel de acesso à Universidade (página da clínica)
  "university.title": "Universidade DenialDesk",
  "university.description":
    "O acesso aos cursos da Universidade é registrado aqui quando a clínica o compra. Os cursos permanecem bloqueados até lá; a Wiki está sempre aberta.",
  "university.status.none": "Não solicitado",
  "university.status.requested": "Solicitado",
  "university.status.granted": "Acesso concedido",
  "university.status.revoked": "Revogado",
  "university.requestedOn": "Solicitado pela clínica em {date}",
  "university.grantedOn": "Concedido em {date}",
  "university.revokedOn": "Revogado em {date}: {reason}",
  "university.noteLabel": "Referência do pedido ou da fatura",
  "university.noteHint": "Opcional. Sem informações de pacientes.",
  "university.grant": "Conceder acesso",
  "university.granting": "Concedendo…",
  "university.granted": "Acesso concedido. Os cursos da clínica estão desbloqueados.",
  "university.revokeReasonLabel": "Por que o acesso é revogado",
  "university.revokeReasonHint": "Mantido com o registro e na trilha de auditoria.",
  "university.revoke": "Revogar acesso",
  "university.revoking": "Revogando…",
  "university.revoked": "Acesso revogado. Os cursos da clínica estão bloqueados novamente.",
  "errors.universityFormInvalid": "Verifique o formulário e tente novamente.",
  "errors.universityRevokeReasonTooShort": "Informe um motivo com pelo menos cinco caracteres.",
  "errors.universityNotGranted": "Esta clínica não tem acesso a revogar.",
  "errors.universityAlreadyGranted": "Esta clínica já tem acesso. Recarregue a página para vê-lo.",
};
