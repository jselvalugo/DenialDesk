import type { Messages } from "../types";

export const settings: Messages["settings"] = {
  // Estrutura de Configurações (layout, abas)
  "page.title": "Configurações",
  "page.description":
    "Como o DenialDesk está configurado para sua clínica: seu perfil, os campos dos seus registros e quem pode fazer o quê.",
  "tabs.general": "Geral",
  "tabs.customFields": "Campos personalizados",
  "tabs.payers": "Pagadores",
  "tabs.usersAndRoles": "Usuários e funções",
  "tabs.security": "Segurança",
  "tabs.notifications": "Notificações",
  "tabs.integrations": "Integrações",
  "tabs.sectionsLabel": "Seções de configurações",
  "nav.breadcrumb": "Trilha de navegação",

  // Página de configurações gerais
  "general.profileTitle": "Perfil da clínica",
  "general.profileDescription": "Definido quando o DenialDesk criou sua clínica.",
  "general.practiceName": "Nome da clínica",
  "general.environment": "Ambiente",
  "general.production": "Produção",
  "general.preProduction": "Pré-produção",
  "general.syntheticDataOnly": "somente dados sintéticos",
  "general.dataResidency": "Residência dos dados",
  "general.dataResidencyValue": "Somente Estados Unidos",
  "general.contactSupport": "Para alterar o nome da clínica, entre em contato com o suporte do DenialDesk.",
  "general.accountTitle": "Sua conta",
  "general.accountDescription": "O usuário com o qual você entrou.",
  "general.canChangeSettings": "Pode alterar as configurações",
  "general.viewOnly": "Não: somente visualização",

  // Lista de campos personalizados
  "fields.metaTitle": "Campos personalizados",
  "fields.recordTypesLabel": "Tipos de registro",
  "fields.recordsHeading": "Registros",
  "fields.panelTitle": "Campos de {entity}",
  "fields.panelDescription":
    "Campos que sua clínica adiciona a {entity}, na ordem do formulário. Campos desativados ficam ocultos dos formulários e mantêm seu histórico.",
  "fields.addField": "Adicionar campo",
  "fields.emptyTitle": "Ainda não há campos personalizados em {entity}",
  "fields.emptyDescriptionCanEdit":
    "Adicione um campo para registrar algo que o DenialDesk não acompanha por padrão, como uma clínica de referência ou um nível interno de conta.",
  "fields.emptyDescriptionReadOnly":
    "Um administrador pode adicionar campos para registrar o que sua clínica acompanha além do registro padrão.",
  "fields.tableCaption": "Campos personalizados de {entity}",
  "fields.label": "Rótulo",
  "fields.key": "Chave",
  "fields.sensitivity": "Sensibilidade",
  "fields.locked": "Bloqueado · {category}",
  "fields.notSensitive": "Não sensível",
  "fields.active": "Ativo",
  "fields.inactive": "Inativo",
  "fields.editAria": "Editar {label}",
  "fields.deactivate": "Desativar",
  "fields.reactivate": "Reativar",
  "fields.toggleAria": "{action} {label}",

  "fields.newMetaTitle": "Adicionar campo personalizado",
  "fields.newTitle": "Adicionar um campo personalizado",
  "fields.newDescription": "O campo aparece em todo registro do tipo escolhido.",
  "fields.editMetaTitle": "Editar campo personalizado",
  "fields.editTitle": "Editar “{label}”",
  "fields.editDescription":
    "O tipo de registro, a chave e o tipo do campo ficam fixos assim que o campo existe.",

  // Tipos de registro aos quais um campo personalizado pode pertencer
  "entity.patient": "Pacientes",
  "entity.claim": "Reivindicações",
  "entity.denial": "Negativas",
  "entity.payer": "Pagadores",

  // Tipos de campo personalizado
  "type.text": "Texto curto",
  "type.longText": "Texto longo",
  "type.number": "Número",
  "type.date": "Data",
  "type.checkbox": "Caixa de seleção (sim / não)",
  "type.select": "Lista de opções",
  "fields.choicesCount": "{count, plural, one {# opção} other {# opções}}",

  // Formulário para adicionar ou editar um campo personalizado
  "form.addTo": "Adicionar a",
  "form.fieldType": "Tipo de campo",
  "form.labelHint":
    "O que as pessoas veem no formulário, por exemplo “Clínica de referência”. Nunca coloque informações do paciente em um rótulo.",
  "form.keyHintEditing": "A chave não pode mudar depois que o campo existe.",
  "form.keyHintNew":
    "Usada em exportações e integrações. Deixe em branco para usar a sugestão. Não poderá ser alterada depois.",
  "form.choices": "Opções",
  "form.choicesHint": "Uma opção por linha, na ordem em que serão exibidas (até 50).",
  "form.helpText": "Texto de ajuda (opcional)",
  "form.helpTextHint": "Exibido abaixo do campo no formulário.",
  "form.sensitiveOption": "Sensível: {name}",
  "form.sensitivityHint":
    "Um campo sensível fica bloqueado em todo registro: seu valor permanece oculto até que alguém o abra com um motivo, e cada abertura é registrada na trilha de auditoria.",
  "form.requiredLabel": "Obrigatório: o registro não pode ser salvo sem este campo",
  "form.showInListLabel": "Mostrar na lista: adiciona uma coluna para este campo na lista de registros",
  "form.showInListDisabledHint": "Campos sensíveis nunca aparecem em listas, buscas ou exportações.",
  "form.saveField": "Salvar campo",
  "form.adding": "Adicionando…",

  // Ações do servidor para campos personalizados (app/(app)/settings/fields/actions.ts)
  "error.notAdmin": "Somente administradores podem alterar campos personalizados.",
  "error.duplicateKey": "Outro campo desses registros já usa esta chave.",
  "error.fieldNotFound": "Campo não encontrado.",

  // Definições de campos personalizados (domain/settings/custom-fields.ts)
  "validation.enterLabel": "Informe um rótulo.",
  "validation.labelMaxLength": "Mantenha o rótulo com 60 caracteres ou menos.",
  "validation.helpTextMaxLength": "Mantenha o texto de ajuda com 200 caracteres ou menos.",
  "validation.choiceMaxLength": "Mantenha cada opção com 60 caracteres ou menos.",
  "validation.choicesMax": "Uma lista de opções pode ter no máximo {max} opções.",
  "validation.chooseSensitivity": "Escolha uma categoria de sensibilidade da lista.",
  "validation.needOneChoice": "Adicione pelo menos uma opção, uma por linha.",
  "validation.chooseEntity": "Escolha quais registros recebem este campo.",
  "validation.keyFormat":
    "Use uma chave em letras minúsculas que comece com uma letra: letras, números e sublinhados.",
  "validation.chooseFieldType": "Escolha um tipo de campo.",

  // Armazenamento de campos personalizados (domain/settings/queries.ts)
  "error.tooManyFields":
    "Este tipo de registro já tem {max} campos ativos. Desative um que você não usa mais.",
  "error.staleField": "Este campo mudou desde que você o abriu. Recarregue e tente novamente.",
  "error.tooManyListColumns":
    "No máximo {max} campos por tipo de registro podem aparecer na lista. Desative um primeiro.",

  // Valores dos campos personalizados (domain/custom-fields/values.ts)
  "error.required": "{field} é obrigatório.",
  "error.maxLength": "{field} deve ter {max} caracteres ou menos.",
  "error.mustBeNumber": "{field} deve ser um número.",
  "error.tooManyDigits": "{field} tem dígitos demais.",
  "error.mustBeDate": "{field} deve ser uma data válida.",
  "error.chooseCurrentOption": "Escolha uma opção vigente para {field}.",
  "error.unknownFieldType": "Tipo de campo desconhecido para {field}.",
  "error.cantChangeField": "Sua função não pode alterar {field}.",
  "error.cantReveal": "Sua função não pode revelar valores de campos personalizados.",
  "error.notLocked": "Este valor não está bloqueado.",
  "error.noValueOnFile": "Nenhum valor registrado.",
  "error.valueUnavailable": "Valor indisponível.",
  "error.staleValues": "Esses campos mudaram desde que você os abriu. Recarregue e tente novamente.",
  "error.reload": "Recarregue a página e tente novamente.",

  // Pagadores em Configurações (docs/specs/settings-and-custom-fields.md S2 PR4; registro somente
  // leitura; payer-catalog P2 adicionará verificação e edição).
  "payers.metaTitle": "Pagadores",
  "payers.listTitle": "Pagadores",
  "payers.listDescription": "Os pagadores da sua clínica, carregados do catálogo inicial da Flórida.",
  "payers.count": "{count, plural, one {# pagador} other {# pagadores}}",
  "payers.tableCaption": "Pagadores",
  "payers.ediPayerId": "ID de pagador EDI",
  "payers.notVerified": "Não verificado",
  "payers.source": "Fonte",
  "payers.sourceNotRecorded": "Não registrado",
  "payers.sourceOir": "Lista de seguradoras licenciadas da OIR da Flórida",
  "payers.sourceSmmc": "Lista de planos de atendimento gerenciado do Medicaid (AHCA)",
  "payers.sourceCms": "CMS",
  "payers.sourceReference": "Lista de referência (ainda não verificada)",
  "payers.emptyTitle": "Ainda não há pagadores",
  "payers.emptyDescription": "Os pagadores aparecem quando o catálogo inicial da sua clínica é carregado.",

  "payers.detailMetaTitle": "Pagador",
  "payers.detailEyebrow": "Registro de pagador",
  "payers.breadcrumbList": "Pagadores",
  "payers.badgeUnverified": "Não verificado",
  "payers.detailsTitle": "Dados do pagador",
  "payers.detailsDescription":
    "O nome, o ID de pagador EDI e o regime regulatório são verificados em uma fase posterior e não podem ser alterados aqui.",
  "payers.field.ediPayerId": "ID de pagador EDI",
  "payers.field.regime": "Regime regulatório",
  "payers.field.source": "Fonte",
  "payers.field.added": "Adicionado",
  "payers.editCustomFields": "Editar campos personalizados",

  "payers.fieldsMetaTitle": "Editar campos personalizados do pagador",
  "payers.fieldsPageTitle": "Editar campos personalizados",
  "payers.fieldsDescription": "Campos que sua clínica adicionou aos pagadores.",
  "payers.fieldsBreadcrumb": "Campos personalizados",

  "error.notPayerEditor":
    "Somente administradores e gerentes podem alterar os campos personalizados de um pagador.",
  "error.recordNotFound": "Registro não encontrado.",

  "integrations.metaTitle": "Integrações",
  "integrations.listTitle": "Integrações",
  "integrations.listDescription":
    "Conecte o EHR/PM da sua clínica para que o Registro de pacientes seja uma cópia sincronizada e somente leitura, em vez de registros digitados à mão.",
  "integrations.newConnection": "Nova conexão",
  "integrations.newConnectionBlocked": "Apenas uma conexão por vez: {name} já existe.",
  "integrations.tableCaption": "Integrações",
  "integrations.field.name": "Nome",
  "integrations.field.table": "Tabela",
  "integrations.field.status": "Status",
  "integrations.field.lastSync": "Última sincronização",
  "integrations.table.patients": "Pacientes",
  "integrations.neverSynced": "Nunca sincronizado",
  "integrations.emptyTitle": "Ainda não há integrações",
  "integrations.emptyDescriptionCanManage":
    "Conecte o EHR/PM da sua clínica para que os pacientes sejam sincronizados automaticamente em vez de digitados à mão.",
  "integrations.emptyDescriptionReadOnly": "Um administrador pode conectar o EHR/PM da sua clínica aqui.",

  "integrations.status.draft": "Rascunho",
  "integrations.status.pending_approval": "Aguardando aprovação",
  "integrations.status.active": "Ativa",
  "integrations.status.paused": "Pausada",
  "integrations.status.error": "Precisa de atenção",
  "integrations.status.revoked": "Revogada",

  "integrations.new.metaTitle": "Nova conexão",
  "integrations.new.title": "Conectar uma integração",
  "integrations.new.description":
    "Conecte o EHR/PM da sua clínica via HL7 FHIR R4. Um administrador testa e envia; o operador da plataforma verifica com o administrador do seu EHR antes que a sincronização comece.",
  "integrations.new.sandboxOption": "Usar o ambiente de teste sintético",
  "integrations.new.sandboxHint":
    "Preenche o endereço do ambiente de teste integrado para você experimentar o ciclo de vida da conexão apenas com dados sintéticos, sem um EHR real.",
  "integrations.new.sandboxNotice":
    "Este formulário foi preenchido com o endereço do ambiente de teste sintético integrado.",
  "integrations.new.stepUpFirstNotice":
    "A atestação de residência nos EUA de uma conexão real exige uma verificação de identidade recente. Verifique sua identidade primeiro e depois volte para preencher os dados da conexão.",
  "integrations.new.save": "Criar conexão",
  "integrations.new.saving": "Criando…",

  "integrations.form.displayName": "Nome da conexão",
  "integrations.form.displayNameHint":
    "Visto pela sua equipe, ex.: “Athenahealth”. Nunca inclua informações de pacientes aqui.",
  "integrations.form.baseUrl": "URL base",
  "integrations.form.baseUrlHint":
    "O endereço base FHIR R4 fornecido pelo seu EHR/PM, ex.: https://ehr.example.com/r4.",
  "integrations.form.clientId": "ID do cliente",
  "integrations.form.clientIdHint": "O ID de cliente OAuth que seu EHR/PM registrou para o DenialDesk.",
  "integrations.form.mrnIdentifierSystem": "Sistema de identificador de MRN",
  "integrations.form.mrnIdentifierSystemHint":
    "O sistema de identificador FHIR que seu EHR/PM usa para o número de prontuário (não um número de Seguro Social, Medicare, carteira de motorista ou passaporte).",
  "integrations.form.usResidencyAttested":
    "Este endpoint de EHR/PM armazena e processa dados somente nos Estados Unidos.",
  "integrations.form.endpointLocked":
    "O endpoint não pode ser alterado depois que a conexão deixa de ser um rascunho.",

  "integrations.detailMetaTitle": "Integração",
  "integrations.detailEyebrow": "Integração",
  "integrations.breadcrumbList": "Integrações",
  "integrations.field.kind": "Conector",
  "integrations.field.kindFhir": "HL7 FHIR R4",
  "integrations.field.isSandbox": "Ambiente",
  "integrations.field.isSandboxValue": "Ambiente de teste sintético",
  "integrations.field.isRealValue": "EHR/PM real",
  "integrations.field.attestation": "Declaração de residência nos EUA",
  "integrations.field.attestedBy": "Declarado em {date}",
  "integrations.field.notAttested": "Ainda não declarado",
  "integrations.field.created": "Criada",
  "integrations.field.submitted": "Enviada",
  "integrations.field.approved": "Aprovada",
  "integrations.field.revoked": "Revogada",
  "integrations.field.lastSuccess": "Última sincronização bem-sucedida",
  "integrations.section.configuration": "Configuração",
  "integrations.section.lifecycle": "Ciclo de vida",

  "integrations.action.edit": "Editar",
  "integrations.action.withdraw": "Retirar",
  "integrations.action.withdrawPending": "Retirando…",
  "integrations.action.pause": "Pausar",
  "integrations.action.pausePending": "Pausando…",
  "integrations.action.resume": "Retomar",
  "integrations.action.resumePending": "Retomando…",
  "integrations.action.revoke": "Revogar",
  "integrations.action.submit": "Enviar",
  "integrations.action.submitDisabledHint":
    "Testar uma conexão real ainda não está disponível; por enquanto só é possível ativar o ambiente de teste sintético incorporado.",
  "integrations.action.activateSandbox": "Ativar conexão de teste sintética",
  "integrations.action.activateSandboxPending": "Ativando…",
  "integrations.action.syncHistory": "Histórico de sincronização",
  "integrations.action.verifyIdentity": "Verifique sua identidade",

  "integrations.revoke.confirmTitle": "Revogar esta conexão?",
  "integrations.revoke.confirmDescription":
    "Esta ação não pode ser desfeita. Você poderá registrar pacientes manualmente de novo; os pacientes já sincronizados permanecem somente leitura. Depois, remova o registro do DenialDesk como cliente no seu EHR/PM.",
  "integrations.revoke.reasonLabel": "Motivo",
  "integrations.revoke.reasonNoLongerUsed": "Não é mais usada",
  "integrations.revoke.reasonSwitchingSystems": "Troca de sistema EHR/PM",
  "integrations.revoke.reasonConfiguredInError": "Configurada por engano",
  "integrations.revoke.reasonSecurityConcern": "Preocupação de segurança",
  "integrations.revoke.reasonOther": "Outro",
  "integrations.revoke.confirm": "Revogar conexão",
  "integrations.revoke.offboardingTitle": "A seguir: remova o registro do DenialDesk no seu EHR/PM",
  "integrations.revoke.offboardingBody":
    "Peça ao administrador do seu EHR para remover ou desativar o registro do cliente do DenialDesk para que não possa ser reutilizado. Os pacientes já sincronizados por esta conexão permanecem no DenialDesk como registros somente leitura, mantidos conforme a política de retenção (§9.2); revogar não os exclui.",
  "integrations.revoke.offboardingSecurityConcernNote":
    "Revogada por uma preocupação de segurança: isso foi encaminhado ao processo de resposta a incidentes. Se você acredita que a conexão foi usada depois de revogada, verifique o log de acesso do seu EHR/PM em busca de atividade do cliente DenialDesk após o horário de revogação indicado acima.",
  "integrations.revoke.offboardingSwitchingSystemsNote":
    "Para conectar um EHR/PM diferente, crie uma nova conexão; esta não pode ser reutilizada para outro endpoint.",
  "integrations.revoke.offboardingRunbookNote":
    "Passos completos: docs/runbooks/integration-offboarding.md no repositório do DenialDesk.",

  "integrations.runs.metaTitle": "Histórico de sincronização",
  "integrations.runs.title": "Histórico de sincronização",
  "integrations.runs.description": "Somente contagens e resultados, nunca dados de pacientes.",
  "integrations.runs.emptyTitle": "Ainda não há sincronizações",
  "integrations.runs.emptyDescription":
    "As sincronizações aparecerão aqui quando esta conexão começar a sincronizar.",
  "integrations.runs.status.queued": "Na fila",
  "integrations.runs.status.running": "Em execução",
  "integrations.runs.status.succeeded": "Concluída",
  "integrations.runs.status.failed": "Falhou",
  "integrations.runs.status.abandoned": "Abandonada",

  "integrations.error.notAdmin": "Somente administradores podem gerenciar integrações.",
  "integrations.error.notFound": "Conexão não encontrada.",
  "integrations.error.invalidField": "Verifique o campo destacado.",
  "integrations.error.displayNameInvalid": "Digite um nome de conexão de 1 a 80 caracteres.",
  "integrations.error.baseUrlRequired": "Digite a URL base.",
  "integrations.error.clientIdInvalid": "Digite um ID de cliente de 1 a 255 caracteres.",
  "integrations.error.mrnSystemRequired": "Digite o sistema de identificador de MRN.",
  "integrations.error.sandboxRefused":
    "Somente o ambiente de teste sintético pode ser criado neste ambiente.",
  "integrations.error.realEndpointRefused":
    "Endpoints reais de EHR/PM não estão disponíveis neste ambiente. Use o ambiente de teste sintético.",
  "integrations.error.mrnSystemRefused":
    "Este sistema de identificador não pode ser usado como MRN: ele nomeia um número de Seguro Social, Medicare, carteira de motorista ou passaporte, não um número de prontuário.",
  "integrations.error.attestationRequired":
    "Declare que este endpoint armazena e processa dados somente nos Estados Unidos para conectar um endpoint real.",
  "integrations.error.stepUpRequired": "Verifique sua identidade novamente para continuar.",
  "integrations.error.editLockedNotDraft": "Esta conexão só pode ser editada enquanto for um rascunho.",
  "integrations.error.cannotChangeConnectionType":
    "O endpoint de uma conexão não pode alternar entre o ambiente de teste e um EHR/PM real. Crie uma nova conexão.",
  "integrations.error.invalidTransition": "Esta ação não está disponível para o status atual da conexão.",
  "integrations.error.anotherConnectionLive":
    "Já existe outra conexão ativa para Pacientes. Revogue-a primeiro, ou gerencie essa em vez disso.",
  "integrations.error.unexpected":
    "Algo deu errado ao salvar esta conexão. Tente novamente e contate o suporte se persistir.",
  "integrations.error.chooseReason": "Escolha um motivo.",

  "integrations.error.urlInvalid": "Digite uma URL válida.",
  "integrations.error.urlNotHttps": "A URL base deve usar https.",
  "integrations.error.urlHasUserinfo": "A URL base não pode incluir usuário nem senha.",
  "integrations.error.urlHasQuery": "A URL base não pode incluir uma query string.",
  "integrations.error.urlHasFragment": "A URL base não pode incluir um fragmento.",
  "integrations.error.urlIpLiteral": "A URL base deve usar um nome de host, não um endereço IP.",
  "integrations.error.urlBlockedHost": "Este host não é um endereço real de EHR/PM.",
  "integrations.error.urlSingleLabel": "Digite um nome de host completo (ex.: ehr.example.com).",
  "integrations.error.urlTrailingDot": "Remova o ponto final do nome de host.",
  "integrations.error.urlPortNotAllowed": "Esta porta não é permitida para uma conexão de EHR/PM.",
};
