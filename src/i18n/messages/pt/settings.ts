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
};
