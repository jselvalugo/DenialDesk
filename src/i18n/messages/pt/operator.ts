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
  "newPractice.sectionTitle": "Dados da clínica",
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
  "integrations.link": "Aprovação de integrações",
  "integrations.metaTitle": "Aprovação de integrações",
  "integrations.title": "Aprovação de integrações",
  "integrations.description":
    "Conexões reais de EHR/PM enviadas pelas clínicas. Verifique cada uma com o administrador de EHR da clínica, fora do DenialDesk, antes de aprová-la. Somente configuração; sem dados de pacientes.",
  "integrations.panelTitle": "Aguardando aprovação",
  "integrations.tableCaption": "Conexões aguardando aprovação",
  "integrations.empty": "Nenhuma conexão aguarda aprovação.",
  "integrations.columns.name": "Conexão",
  "integrations.columns.baseUrl": "URL base",
  "integrations.columns.clientId": "ID do cliente",
  "integrations.columns.submitted": "Enviada",
  "integrations.review": "Revisar",
  "integrations.practiceTitle": "Conexões de EHR/PM aguardando aprovação",
  "integrations.practiceDescription":
    "Enviadas pelos administradores desta clínica. Revise a configuração, verifique-a fora do DenialDesk e depois aprove ou rejeite.",
  "integrations.practiceEmpty": "Nenhuma conexão desta clínica aguarda aprovação.",
  "integrations.reviewMetaTitle": "Revisar conexão",
  "integrations.reviewTitle": "Revisar conexão",
  "integrations.reviewDescription": "Clínica: {practice}. Nada é sincronizado até você aprovar.",
  "integrations.config.title": "Configuração",
  "integrations.config.description":
    "Exatamente o que a clínica enviou. Confira cada valor com o administrador de EHR da clínica.",
  "integrations.field.name": "Nome da conexão",
  "integrations.field.baseUrl": "URL base",
  "integrations.field.tokenEndpoint": "Endpoint de tokens",
  "integrations.field.issuer": "Emissor",
  "integrations.field.clientId": "ID do cliente",
  "integrations.field.mrnSystem": "Sistema de identificadores de MRN",
  "integrations.field.jwks": "Endereço da chave pública (JWKS)",
  "integrations.field.jwksHint":
    "É um caminho neste site. Passe o endereço completo ao administrador de EHR da clínica.",
  "integrations.field.keyMode": "Modo de chave",
  "integrations.field.scope": "Escopo da população",
  "integrations.field.submitted": "Enviada",
  "integrations.field.attested": "Residência nos EUA confirmada",
  "integrations.field.notDiscovered": "Não descoberto",
  "integrations.keyMode.unassigned": "Ainda não atribuído",
  "integrations.keyMode.per_connection": "Uma chave por conexão",
  "integrations.keyMode.shared_vendor_exception": "Chave compartilhada (exceção do fornecedor)",
  "integrations.keyMode.preprod_shared": "Chave compartilhada de pré-produção",
  "integrations.scope.unset": "Você define ao aprovar",
  "integrations.approve.title": "Aprovar",
  "integrations.approve.description":
    "Ao aprovar, os pacientes desta clínica passam a ser sincronizados. Aprove somente depois de verificar a configuração com o administrador de EHR da clínica, fora do DenialDesk.",
  "integrations.choose": "Escolha…",
  "integrations.approve.methodLabel": "Como você verificou",
  "integrations.approve.dateLabel": "Data da verificação",
  "integrations.approve.dateHint":
    "Não pode ser futura nem anterior ao dia em que a clínica enviou a conexão.",
  "integrations.approve.roleLabel": "Função do contato na clínica",
  "integrations.approve.roleHint": "Somente a função, nunca um nome.",
  "integrations.approve.scopeLabel": "Escopo da população",
  "integrations.approve.scopeHint":
    "Limita a sincronização aos pacientes da própria clínica. Por enquanto só uma exportação de Group pode ser aprovada: um filtro de busca verificado ainda não tem onde ser registrado.",
  "integrations.approve.nineDigitsLabel": "Os MRNs contêm um número de nove dígitos (verificado)",
  "integrations.approve.nineDigitsHint":
    "Opcional. Marque somente se a clínica confirmou que seus MRNs reais contêm um número de nove dígitos; caso contrário, esses MRNs são recusados por se parecerem com um número de Seguro Social.",
  "integrations.approve.ownershipLabel":
    "Verifiquei, fora do DenialDesk, que esta clínica é titular do ID de cliente {clientId}",
  "integrations.approve.ownershipHint":
    "A clínica o registrou no próprio EHR/PM, não outra organização. A chave de assinatura por si só não prova isso.",
  "integrations.approve.submit": "Aprovar conexão",
  "integrations.approve.pending": "Aprovando…",
  "integrations.approve.done": "Aprovada. A conexão está ativa.",
  "integrations.reject.title": "Rejeitar",
  "integrations.reject.description":
    "Devolve a conexão à clínica como rascunho e libera a reserva do endpoint. A clínica vê o motivo e pode corrigir e enviar novamente.",
  "integrations.reject.reasonLabel": "Motivo",
  "integrations.reject.submit": "Rejeitar conexão",
  "integrations.reject.pending": "Rejeitando…",
  "integrations.reject.done": "Rejeitada. A conexão voltou a ser um rascunho.",
  "integrations.method.phone_callback": "Ligação para um número registrado",
  "integrations.method.video_call": "Videochamada com o administrador de EHR/PM",
  "integrations.method.written_confirmation":
    "Confirmação por escrito do endereço verificado do administrador",
  "integrations.method.vendor_portal": "Confirmado no registro de aplicativos do fornecedor de EHR/PM",
  "integrations.role.ehr_administrator": "Administrador de EHR/PM",
  "integrations.role.practice_administrator": "Administrador da clínica",
  "integrations.role.it_contact": "Contato de TI da clínica",
  "integrations.role.vendor_representative": "Representante do fornecedor de EHR/PM",
  "integrations.role.other": "Outro",
  "integrations.scope.group_export": "Exportação de Group (o Group da própria clínica)",
  "integrations.scope.verified_filter": "Filtro de busca verificado",
  "errors.integrationNotOperator": "Somente o operador da plataforma pode decidir sobre uma conexão.",
  "errors.approvalFormInvalid": "Escolha como foi verificado, a função do contato e o escopo da população.",
  "errors.approvalDateInvalid": "Informe a data em que verificou. Não pode ser futura.",
  "errors.approvalOwnershipRequired":
    "Confirme que você verificou, fora do DenialDesk, que a clínica é titular deste ID de cliente.",
  "errors.rejectReasonRequired": "Escolha um motivo.",
  "errors.integrationNotFound": "Esta conexão não aguarda aprovação para esta clínica.",
  "errors.integrationNotPending": "Esta conexão não aguarda mais aprovação. Recarregue a página.",
  "errors.integrationStale":
    "Esta conexão mudou desde que você a abriu. Recarregue a página e revise a configuração novamente.",
  "errors.integrationNotClaimed":
    "O registro do endpoint desta conexão não corresponde mais à configuração. Ela não pode ser aprovada; rejeite-a.",
  "errors.integrationPracticeSuspended":
    "Esta clínica está suspensa. Reative-a antes de aprovar uma conexão.",
  "integrations.scope.verified_filter_unavailable": "Filtro de busca verificado (ainda não disponível)",
  "errors.approvalScopeUnsupported":
    "Um filtro de busca verificado ainda não tem onde ser registrado, então só uma exportação de Group pode ser aprovada.",
  "errors.integrationRealEndpointRefused":
    "Neste ambiente não é possível aprovar conexões reais de EHR: ele contém apenas dados sintéticos.",
  "errors.approvalDateBeforeSubmission":
    "A data da verificação não pode ser anterior ao dia em que a clínica enviou a conexão ({date}).",
  "errors.approvalBaaRequired":
    "Esta clínica não tem um Acordo de Associado Comercial (BAA) em vigor. Registre o acordo assinado na página da clínica antes de aprovar uma conexão.",
  "integrations.rejectReason.endpoint_not_verified": "Endpoint não verificado com o administrador de EHR/PM",
  "integrations.rejectReason.client_id_not_verified":
    "ID do cliente não verificado com o administrador de EHR/PM",
  "integrations.rejectReason.contact_not_verified": "Não foi possível contatar o administrador de EHR/PM",
  "integrations.rejectReason.population_not_scoped": "População de pacientes não limitada à clínica",
  "integrations.rejectReason.configuration_incorrect": "A configuração está incorreta",
  "integrations.rejectReason.other": "Outro motivo",
};
