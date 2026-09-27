import type { Messages } from "../types";

export const patients: Messages["patients"] = {
  // Lista de pacientes
  "list.title": "Pacientes",
  "list.description":
    "Toda reivindicação e negativa pertence a um paciente. Abra um paciente para ver sua cobertura, reivindicações e negativas em um só lugar.",
  "list.register": "Cadastrar paciente",
  "list.emptyTitle": "Ainda não há pacientes",
  "list.emptyDescriptionCanEdit":
    "Cadastre um paciente para iniciar seu prontuário. As reivindicações e negativas se vinculam a ele.",
  "list.emptyDescriptionReadOnly": "Os pacientes aparecerão aqui quando sua equipe os cadastrar.",

  // Tabela de pacientes (lista e resultados de busca) e emblemas
  "badge.restricted": "Restrito",
  "badge.selfPay": "Particular",

  // Busca
  "search.label": "Buscar um paciente",
  "search.placeholder": "Sobrenome, Nome · nome · MRN",
  "search.searching": "Buscando…",
  "search.resultsLabel": "Resultados da busca",
  "search.noMatches": "Nenhum paciente corresponde.",
  "search.matchCount": "{count, plural, one {# resultado} other {# resultados}}",
  "search.truncatedHint": "(primeiros 25; refine a busca)",
  "search.resultsCaption": "Resultados da busca de pacientes",

  // Nomes de campos, compartilhados pelos rótulos do formulário, cabeçalhos de tabela e mensagens
  // de validação
  "field.mrn": "MRN",
  "field.firstName": "Nome",
  "field.lastName": "Sobrenome",
  "field.birthDate": "Data de nascimento",
  "field.sex": "Sexo",
  "field.address": "Endereço",
  "field.city": "Cidade",
  "field.state": "Estado",
  "field.zip": "CEP",
  "field.phone": "Telefone",
  "field.primaryPayer": "Pagador principal",
  "field.memberId": "ID do beneficiário",
  "field.sensitivityTags": "Etiquetas de sensibilidade",

  // Sexo
  "sex.female": "Feminino",
  "sex.male": "Masculino",
  "sex.unknown": "Desconhecido",

  // Etiquetas de sensibilidade do registro (R-3.5.1)
  "sensitivity.hiv": "HIV",
  "sensitivity.mentalHealth": "Saúde mental",
  "sensitivity.sud": "Uso de substâncias (42 CFR Part 2)",
  "sensitivity.genetic": "Testes genéticos",
  "sensitivity.minor": "Menor de idade",
  "sensitivity.reproductiveHealth": "Saúde reprodutiva",

  // Formulário de cadastro e edição
  "form.mrnHint": "Deixe em branco para atribuir o próximo número.",
  "form.payerPlaceholder": "Sem convênio registrado (particular)",
  "form.payerNoMatch":
    "Nenhum pagador corresponde a “{query}”. Escolha um da lista ou limpe o campo para particular.",
  "form.payerUnverifiedOption": "{name} (não verificado)",
  "form.payerUnverifiedHint":
    "Pagador não verificado — ainda não há ID de pagador nem regime regulatório registrado.",
  "form.memberIdHintOnFile": "Registrado: •••• {last4}. Deixe em branco para mantê-lo.",
  "form.memberIdHintNew": "Armazenado criptografado; apenas os últimos 4 dígitos são exibidos.",
  "form.reasonLabel": "Motivo da alteração (obrigatório, salvo na trilha de auditoria)",
  "form.reasonHint": "Não inclua dados do paciente no motivo.",
  "form.syntheticNotice":
    "Somente dados sintéticos. Nunca cadastre aqui um paciente real; MRNs e IDs de beneficiário devem começar com SYN.",
  "form.syntheticAttestation":
    "Confirmo que este registro é um dado de teste sintético, não um paciente real.",
  "form.saveChanges": "Salvar alterações",

  // Validação (patientSchema)
  "validation.enterFirstName": "Informe o nome.",
  "validation.firstNameMaxLength": "O nome pode ter no máximo {max} caracteres.",
  "validation.firstNameFormat": "O nome só pode ter letras, espaços, pontos, apóstrofos e hífens.",
  "validation.enterLastName": "Informe o sobrenome.",
  "validation.lastNameMaxLength": "O sobrenome pode ter no máximo {max} caracteres.",
  "validation.lastNameFormat": "O sobrenome só pode ter letras, espaços, pontos, apóstrofos e hífens.",
  "validation.mrnMaxLength": "O MRN pode ter no máximo {max} caracteres.",
  "validation.mrnFormat": "O MRN só pode ter letras, números e hífens.",
  "validation.birthDateInvalid": "Informe uma data de nascimento válida.",
  "validation.birthDateTooOld": "Informe uma data de nascimento posterior a 1900.",
  "validation.birthDateFuture": "A data de nascimento não pode ser no futuro.",
  "validation.chooseSex": "Escolha o sexo do paciente.",
  "validation.addressMaxLength": "O endereço pode ter no máximo {max} caracteres.",
  "validation.cityMaxLength": "A cidade pode ter no máximo {max} caracteres.",
  "validation.stateFormat": "Informe o estado com duas letras.",
  "validation.postalFormat": "Informe um CEP de 5 dígitos ou ZIP+4.",
  "validation.phoneFormat": "Informe um telefone de 10 dígitos.",
  "validation.memberIdMinLength": "O ID do beneficiário deve ter pelo menos {min} caracteres.",
  "validation.memberIdMaxLength": "O ID do beneficiário pode ter no máximo {max} caracteres.",
  "validation.memberIdFormat": "O ID do beneficiário só pode ter letras, números e hífens.",
  "validation.syntheticPrefix": "{field} deve começar com {marker} (somente dados sintéticos).",
  "validation.memberIdNeedsPayer": "Escolha o pagador ao qual este ID de beneficiário pertence.",

  // Erros do registro de paciente (domain/patients/queries.ts)
  "error.choosePayer": "Escolha um pagador da lista.",
  "error.enterMemberIdForPayer": "Informe o ID de beneficiário para este pagador.",
  "error.duplicateMrn": "Outro paciente já tem este MRN.",
  "error.patientNotFound": "Paciente não encontrado.",
  "error.staleRecord": "Este paciente mudou desde que você abriu o formulário. Recarregue e tente novamente.",
  "error.notFound": "Não encontrado.",
  "error.noMemberIdOnFile": "Nenhum ID de beneficiário registrado.",

  // Erros das ações do servidor (app/(app)/patients/actions.ts)
  "error.roleReadOnly": "Sua função pode ver pacientes, mas não alterá-los.",
  "error.syntheticRequired":
    "Confirme que este paciente é sintético. Dados reais de pacientes não são permitidos aqui.",
  "error.reload": "Recarregue a página e tente novamente.",
  "error.reasonLength": "Diga por que o registro está mudando (de 5 a 500 caracteres).",
  "error.searchTooShort": "Informe pelo menos 2 caracteres de um nome ou MRN.",
  "error.cantViewMemberId": "Sua função não pode ver os IDs de beneficiário completos.",
  "error.chooseReason": "Escolha um motivo.",

  // Navegação
  "nav.breadcrumb": "Trilha de navegação",
  "nav.edit": "Editar",
  "nav.register": "Cadastrar",

  // Prontuário do paciente (página de detalhes)
  "detail.totalsLabel": "Totais do paciente",
  "detail.bornOn": "nascido em {date}",
  "detail.noInsurance": "Sem convênio registrado (particular).",
  "detail.editRecord": "Editar registro",
  "detail.claims": "Reivindicações",
  "detail.billed": "Faturado",
  "detail.paid": "Pago",
  "detail.openDenied": "Negado em aberto",
  "detail.openDenialsCount": "{count, plural, one {# negativa em aberto} other {# negativas em aberto}}",
  "detail.denials": "Negativas",
  "detail.noClaimsTitle": "Nenhuma reivindicação para este paciente",
  "detail.claimsCaption": "Reivindicações deste paciente",
  "detail.denialsCaption": "Negativas deste paciente",
  "detail.noClaimsDescription":
    "As reivindicações aparecerão aqui quando forem criadas ou importadas para este paciente.",
  "detail.noDenialsTitle": "Nenhuma negativa para este paciente",
  "detail.noDenialsDescription": "As negativas das reivindicações deste paciente aparecem aqui.",
  "detail.dateOfService": "Data do atendimento",
  "detail.notice": "Aviso",
  "detail.appealBy": "Recorrer até",
  "detail.denied": "Negado",
  "detail.demographics": "Dados demográficos",
  "detail.notOnFile": "Não registrado",
  "detail.primaryInsurance": "Convênio principal",

  // Página de edição
  "edit.title": "Editar paciente",
  "edit.description":
    "As alterações são salvas com seu motivo na trilha de auditoria. Reivindicações já enviadas mantêm o que foi faturado.",

  // Página de cadastro (novo paciente)
  "new.title": "Cadastrar paciente",
  "new.description":
    "Dados demográficos e convênio principal. As reivindicações deste paciente se vincularão a este registro.",
  "new.readOnlyNotice": "Sua função pode ver pacientes, mas não cadastrá-los.",
  "new.backToPatients": "Voltar para pacientes",

  // Revelar o ID de beneficiário mascarado (components/patients/MaskedMemberId)
  "reveal.hide": "Ocultar",
  "reveal.endingIn": "ID de beneficiário terminado em {last4}",
  "reveal.reasonLabel": "Motivo para visualizar",
  "reveal.reasonAppeal": "Preparando recurso",
  "reveal.reasonEligibility": "Verificando elegibilidade",
  "reveal.reasonPayerCall": "Ligação ao pagador",
  "reveal.reasonOther": "Outro",
  "reveal.reveal": "Revelar",
  "reveal.error": "Não foi possível revelar.",

  // Padrão de registro (docs/specs/record-pages.md): barra da lista, cabeçalho do prontuário, seções do formulário
  "list.count": "{count, plural, one {# paciente cadastrado} other {# pacientes cadastrados}}",
  "list.searchHint": "Digite pelo menos 2 letras de um nome, “Sobrenome, Nome” ou um MRN.",
  "field.age": "{years, plural, one {# ano} other {# anos}}",
  "field.location": "Localidade",
  "field.coverage": "Cobertura",
  "detail.eyebrow": "Prontuário do paciente",
  "detail.claimsCount": "{count, plural, one {# reivindicação} other {# reivindicações}}",
  "detail.denialsCount": "{count, plural, one {# negativa} other {# negativas}}",
  "detail.record": "Registro",
  "detail.recordDescription": "Quando este registro foi cadastrado e alterado pela última vez.",
  "form.demographicsHint":
    "Nome e data de nascimento como aparecem na carteirinha do convênio, além dos dados de contato.",
  "form.insuranceHint":
    "O pagador principal e o ID de beneficiário da carteirinha. Deixe o pagador em branco para particular.",
  "form.auditTitle": "Trilha de auditoria",
  "form.auditHint": "Toda alteração é salva com quem a fez e por quê.",
  "form.confirmTitle": "Confirmação",
  "form.confirmHint": "Obrigatória antes de salvar o registro.",
  "form.actionsNote": "Ao salvar, seu nome e o horário são registrados na trilha de auditoria.",
};
