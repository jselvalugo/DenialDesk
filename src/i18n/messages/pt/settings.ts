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
  // Billing details (docs/specs/claims.md C3a-S)
  "tabs.billing": "Faturamento",
  "billing.metaTitle": "Dados de faturamento",
  "billing.providerMetaTitle": "Dados de faturamento do prestador",
  "billing.locationMetaTitle": "Local de atendimento",
  "billing.intro":
    "O prestador de faturamento e o local de atendimento que vão em cada arquivo de guia 837P. Somente administradores podem alterá-los.",
  "billing.saved.provider": "Dados de faturamento do prestador salvos.",
  "billing.saved.location": "Local de atendimento salvo.",
  "billing.providers.title": "Prestadores",
  "billing.providers.description": "Nome, endereço e identificação fiscal de cada prestador que fatura.",
  "billing.providers.caption": "Prestadores e seus dados de faturamento",
  "billing.providers.emptyTitle": "Ainda não há prestadores",
  "billing.providers.emptyDescription":
    "Os prestadores são adicionados quando o seu consultório é configurado.",
  "billing.locations.title": "Locais",
  "billing.locations.description": "O código de local de atendimento de cada local.",
  "billing.locations.caption": "Locais e seu local de atendimento",
  "billing.locations.emptyTitle": "Ainda não há locais",
  "billing.locations.emptyDescription": "Os locais são adicionados quando o seu consultório é configurado.",
  "billing.col.npi": "NPI",
  "billing.col.status": "Dados de faturamento",
  "billing.col.city": "Cidade",
  "billing.col.pos": "Local de atendimento",
  "billing.status.complete": "Completo",
  "billing.status.missing": "{count, plural, one {Falta # item} other {Faltam # itens}}",
  "billing.pos.notSet": "Não definido",
  "billing.action.edit": "Editar",
  "billing.section.name.title": "Nome de faturamento",
  "billing.section.name.description":
    "Como o pagador conhece o prestador. Somente letras, dígitos e & ' ( ) , . - / #.",
  "billing.section.address.title": "Endereço de faturamento",
  "billing.section.address.description": "Um endereço de rua, não uma caixa postal.",
  "billing.section.tin.title": "Identificação fiscal",
  "billing.section.tin.description":
    "Armazenada criptografada. Nunca é exibida novamente; somente os quatro últimos dígitos.",
  "billing.section.pos.title": "Local de atendimento",
  "billing.section.pos.description": "O código de dois dígitos que vai nas guias deste local.",
  "billing.form.firstName": "Nome",
  "billing.form.lastName": "Sobrenome",
  "billing.form.addressLine1": "Endereço",
  "billing.form.city": "Cidade",
  "billing.form.state": "Estado (duas letras)",
  "billing.form.postalCode": "CEP",
  "billing.form.postalCodeHint":
    "Cinco dígitos ou nove (12345-6789). O prestador de faturamento do 837P precisa dos nove.",
  "billing.form.tinType": "Tipo de identificação fiscal",
  "billing.form.tinTypeNone": "Não definido",
  "billing.form.tinTypeEI": "EIN (identificação de empregador)",
  "billing.form.tinTypeSY": "SSN (proprietário individual)",
  "billing.form.tin": "Identificação fiscal (9 dígitos)",
  "billing.form.tinHintNone": "Nenhuma identificação fiscal cadastrada. Informe nove dígitos.",
  "billing.form.tinHintOnFile":
    "Cadastrada, termina em {last4}. Deixe em branco para mantê-la ou informe nove dígitos para substituí-la.",
  "billing.form.tinHintUnreadable":
    "Não é possível ler a identificação fiscal armazenada. Informe-a novamente.",
  "billing.form.pos": "Código de local de atendimento",
  "billing.form.posHint":
    "Dois dígitos. O formato é verificado, não o significado; use o código da lista do CMS.",
  "billing.form.provider": "Prestador",
  "billing.form.location": "Local",
  "billing.form.save": "Salvar",
  "billing.form.saving": "Salvando…",
  "billing.stepUp.notice":
    "Alterar a identificação fiscal exige uma verificação de identidade recente. Verifique primeiro e depois volte a esta página.",
  "billing.stepUp.link": "Verifique sua identidade",
  "billing.error.notAdmin": "Somente administradores podem alterar os dados de faturamento.",
  "billing.error.stepUpRequired":
    "Verifique sua identidade novamente antes de alterar a identificação fiscal.",
  "billing.error.notFound": "Esse registro não foi encontrado.",
  "billing.error.saveFailed": "Não foi possível salvar os dados. Tente novamente.",
  "billing.error.fixFields": "Corrija os campos marcados abaixo e salve novamente.",
  "billing.error.required": "Este campo é obrigatório.",
  "billing.error.tooLong": "Use no máximo {max} caracteres.",
  "billing.error.characters": "Use somente letras de A a Z, dígitos, espaços e & ' ( ) , . - / #.",
  "billing.error.poBox":
    "Uma caixa postal não pode ser o endereço de faturamento. Informe um endereço de rua.",
  "billing.error.state": "Informe o código do estado com duas letras.",
  "billing.error.zip": "Informe cinco dígitos ou nove dígitos (12345-6789).",
  "billing.error.tinType": "Escolha o tipo de identificação fiscal.",
  "billing.error.tin": "Informe exatamente nove dígitos.",
  "billing.error.tinRequired": "Informe a identificação fiscal (nove dígitos).",
  "billing.error.pos": "Informe um código de dois dígitos.",
};
