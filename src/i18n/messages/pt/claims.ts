import type { Messages } from "../types";

export const claims: Messages["claims"] = {
  "nav.breadcrumb": "Trilha de navegação",
  "list.stat.sectionLabel": "Totais de reivindicações não enviadas",

  // Lista de reivindicações (app/(app)/claims/page.tsx)
  "list.title": "Reivindicações",
  "list.description":
    "Primeiro as reivindicações não enviadas, com as mais próximas de perder o prazo de envio no topo.",
  "list.stat.unsubmitted": "Não enviadas",
  "list.stat.unsubmittedDetail": "Rascunho ou rejeitadas pelo pagador",
  "list.stat.unsubmittedBilled": "Faturado não enviado",
  "list.stat.dueSoon": "Prazo de envio em {days} dias",
  "list.stat.dueSoonDetail": "Janela de prazo de envio se fechando",
  "list.stat.pastDeadline": "Prazo de envio vencido",
  "list.stat.pastDeadlineDetail": "Provavelmente negada por extemporaneidade",
  "list.stat.notConfiguredDetail": "{count} sem regra de envio configurada",
  "list.stat.payerUnverifiedDetail": "{count} com pagador não verificado",
  "list.filter.claims": "Reivindicações",
  "list.filter.unsubmitted": "Não enviadas",
  "list.filter.inProcess": "Enviadas ao pagador",
  "list.filter.allPayers": "Todos os pagadores",
  "list.filter.filingDeadline": "Prazo de envio",
  "list.filter.dueSoon": "Vence em {days} dias",
  "list.truncated":
    "Mais de {limit} reivindicações não enviadas: a lista, os filtros e os totais cobrem apenas as {limit} mais antigas por data de atendimento.",
  "list.empty.title.unsubmitted": "Nenhuma reivindicação não enviada",
  "list.empty.title.unsubmittedFiltered": "Nenhuma reivindicação não enviada corresponde a estes filtros",
  "list.empty.title.inProcess": "Nenhuma reivindicação enviada ao pagador",
  "list.empty.title.inProcessFiltered":
    "Nenhuma reivindicação enviada ao pagador corresponde a estes filtros",
  "list.empty.title.all": "Nenhuma reivindicação",
  "list.empty.title.allFiltered": "Nenhuma reivindicação corresponde a estes filtros",
  "list.empty.descriptionUnsubmitted":
    "Reivindicações em rascunho e rejeitadas aparecem aqui até que o pagador as aceite.",
  "list.empty.descriptionOther": "As reivindicações aparecem aqui assim que são criadas ou importadas.",
  "list.table.captionUnsubmitted": "Reivindicações não enviadas",
  "list.table.captionInProcess": "Reivindicações enviadas ao pagador",
  "list.table.captionAll": "Todas as reivindicações",
  "list.table.dateOfService": "Data de atendimento",
  "list.table.filingDeadline": "Prazo de envio",
  "list.table.noDeadlinePayerUnverified": "Sem prazo — pagador não verificado",

  // Estado do prazo de envio (domain/claims/status.ts FILING_STATE_LABEL_KEYS)
  "filing.state.pastDeadline": "Prazo vencido",
  "filing.state.notConfigured": "Não configurado",
  "filing.state.payerUnverified": "Pagador não verificado",

  // Detalhe da reivindicação (app/(app)/claims/[id]/page.tsx)
  "detail.pageTitle": "Reivindicação",
  "detail.eyebrow": "Registro da reivindicação",
  "detail.details.title": "Detalhes da reivindicação",
  "detail.lines.title": "Linhas da reivindicação",
  "detail.filing.rolledNote":
    "(pendente de parecer jurídico: {date}; a prorrogação por fim de semana ou feriado ainda não foi confirmada, portanto envie até a data acima)",
  "detail.breadcrumbClaims": "Reivindicações",
  "detail.field.dateOfService": "Data de atendimento",
  "detail.field.version": "Versão",
  "detail.field.provider": "Prestador",
  "detail.field.npi": "NPI {npi}",
  "detail.field.location": "Local",
  "detail.field.payer": "Pagador",
  "detail.field.billed": "Faturado",
  "detail.field.paid": "Pago",
  "detail.field.payerReceived": "Recebido pelo pagador",
  "detail.field.diagnosis": "Diagnóstico",
  "detail.table.line": "Linha",
  "detail.table.procedure": "Procedimento",
  "detail.table.modifiers": "Modificadores",
  "detail.table.units": "Unidades",
  "detail.table.charge": "Cobrança",
  "detail.table.claimLinesCaption": "Linhas da reivindicação",
  "detail.readOnlyNote": "Seu perfil tem acesso somente leitura às reivindicações.",
  "detail.history.title": "Histórico de versões",
  "detail.history.listLabel": "Versões da reivindicação",
  "detail.history.description":
    "Cada alteração desta reivindicação: quem, quando e por quê. O histórico não pode ser editado.",
  "detail.history.version": "Versão {version}",
  "detail.history.formerTeamMember": "Ex-integrante da equipe",
  "detail.history.system": "Sistema",
  "detail.history.changedTo": "alterado para",
  "detail.filing.title": "Prazo de envio",
  "detail.filing.receivedNoLongerApplies":
    "Recebido pelo pagador em {date}. O prazo de envio não se aplica mais.",
  "detail.filing.acceptedNoLongerApplies": "Aceito pelo pagador. O prazo de envio não se aplica mais.",
  "detail.filing.awaitingReceipt": "Enviada; o prazo é cumprido assim que o pagador confirmar o recebimento.",
  "detail.filing.pastDeadlineWarning":
    "O prazo de envio foi encerrado. É provável que o pagador negue esta reivindicação por extemporaneidade, salvo se houver uma exceção aplicável.",
  "detail.filing.fromServiceDate": "A partir da data de atendimento ({citation}).",
  "detail.filing.pendingVerification": "Pendente de verificação jurídica",
  "detail.filing.payerUnverified":
    "Sem prazo — pagador não verificado. Depois que o regime regulatório deste pagador for verificado, confirme o prazo de envio manualmente com o contrato do pagador ou a lei aplicável; o DenialDesk não pode calculá-lo até lá.",
  "detail.filing.notConfigured":
    "O DenialDesk não tem uma regra de envio configurada para reivindicações de {regime}. Confirme o prazo de envio com o contrato do pagador ou a lei aplicável antes que ele vença.",
  "detail.patient.title": "Paciente",
  "detail.patient.dob": "Data de nascimento",
  "detail.patient.mrn": "Número de prontuário (MRN)",
  "detail.patient.memberId": "ID de associado",
  "detail.payments.title": "Pagamentos",
  "detail.payments.none": "Nenhuma remessa pagou ou negou esta reivindicação ainda.",
  "detail.payments.paidOn": "pago em {date}",
  "detail.payments.promptPayLink": "Relógio de pagamento pontual",
  "detail.denials.title": "Negativas",
  "detail.denials.none": "Esta reivindicação não tem negativas.",
  "detail.denials.notice": "aviso {date}",
  "detail.editCustomFields": "Editar campos personalizados",

  // Página de edição de campos personalizados (app/(app)/claims/[id]/fields/page.tsx)
  "fields.pageTitle": "Campos personalizados",
  "fields.breadcrumb": "Campos personalizados",
  "fields.description":
    "Campos definidos pela clínica nesta reivindicação. Não fazem parte da reivindicação faturada e salvá-los nunca cria uma nova versão.",

  // Formulário de correção (app/(app)/claims/[id]/CorrectionForm.tsx)
  "correction.button": "Corrigir reivindicação",
  "correction.savedAs": "Salvo como versão {version}.",
  "correction.form.dateOfService": "Data de atendimento",
  "correction.form.diagnosisCodes": "Códigos de diagnóstico (ICD-10-CM, separados por vírgulas)",
  "correction.form.linesCaption": "Linhas da reivindicação a corrigir",
  "correction.form.lineProcedureAria": "Código de procedimento da linha {number}",
  "correction.form.lineModifiersAria": "Modificadores da linha {number}",
  "correction.form.lineUnitsAria": "Unidades da linha {number}",
  "correction.form.lineChargeAria": "Cobrança da linha {number}",
  "correction.form.chargeHeader": "Cobrança ($)",
  "correction.form.reason": "Motivo da correção (obrigatório, fica salvo no histórico)",
  "correction.form.reasonHint":
    "Não inclua dados do paciente no motivo. Alterações de código devem ser respaldadas pelo prontuário médico.",
  "correction.form.save": "Salvar nova versão",
  "correction.form.saving": "Salvando…",

  // Rótulos dos campos alterados (domain/claims/correction.ts describeChange)
  "correction.field.serviceDate": "data de atendimento",
  "correction.field.diagnosisCodes": "códigos de diagnóstico",
  "correction.field.procedureCode": "procedimento",
  "correction.field.modifiers": "modificadores",
  "correction.field.units": "unidades",
  "correction.field.chargeCents": "cobrança",
  "correction.field.status": "status",
  "correction.field.paidCents": "pago",
  "correction.field.line": "linha {number}",
  "correction.field.lineSub": "linha {number} {field}",

  // Validação do formulário de correção (domain/claims/correction.ts correctionIssueMessage)
  "correction.error.line": "Linha {number}: {message}",
  "correction.error.serviceDate": "Informe uma data de atendimento válida.",
  "correction.error.diagnosisRequired": "Informe pelo menos um código de diagnóstico.",
  "correction.error.diagnosisMax": "No máximo {max} códigos de diagnóstico.",
  "correction.error.diagnosisFormat":
    "Os códigos de diagnóstico devem estar no formato ICD-10-CM (ex.: E11.9).",
  "correction.error.procedureCode": "Os códigos de procedimento têm 5 letras ou dígitos (CPT/HCPCS).",
  "correction.error.modifierFormat": "Os modificadores têm 2 letras ou dígitos.",
  "correction.error.modifierMax": "No máximo {max} modificadores por linha.",
  "correction.error.unitsInvalid": "As unidades devem ser um número inteiro.",
  "correction.error.unitsRange": "As unidades devem estar entre 1 e 999.",
  "correction.error.chargeInvalid": "Informe as cobranças em dólares e centavos.",
  "correction.error.chargeMin": "As cobranças devem ser de pelo menos $0.01.",
  "correction.error.chargeMax": "As cobranças devem ser menores que $100,000 por linha.",
  "correction.error.linesRequired": "Informe pelo menos uma linha de reivindicação.",
  "correction.error.reasonRequired": "Explique por que a reivindicação está sendo corrigida.",
  "correction.error.reasonMax": "Mantenha o motivo com menos de {max} caracteres.",
  "correction.error.generic": "Revise os campos destacados e tente novamente.",

  // Erros de correção de reivindicações (domain/claims/versions.ts ClaimCorrectionError)
  "correction.error.claimNotFound": "Reivindicação não encontrada.",
  "correction.error.notCorrectable": "Somente reivindicações em rascunho ou rejeitadas podem ser corrigidas.",
  "correction.error.staleVersion":
    "Esta reivindicação mudou desde que você a abriu. Recarregue e tente novamente.",
  "correction.error.futureServiceDate": "A data de atendimento não pode estar no futuro.",
  "correction.error.linesChanged": "As linhas podem ser corrigidas, mas não adicionadas nem removidas.",
  "correction.error.noChanges": "Nada foi alterado.",

  // Erros da ação do servidor (app/(app)/claims/[id]/actions.ts)
  "action.error.forbiddenCorrect": "Seu perfil pode ver as reivindicações, mas não corrigi-las.",
  "action.error.reload": "Recarregue a página e tente novamente.",
};
