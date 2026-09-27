import type { Messages } from "../types";

export const remittances: Messages["remittances"] = {
  "nav.breadcrumb": "Trilha de navegação",
  "list.stat.sectionLabel": "Totais de remessas",

  // Status da remessa, método e códigos CLP02 (domain/remittances/status.ts)
  "status.received": "Pronta para lançar",
  "status.posted": "Lançada",
  "status.void": "Anulada",
  "method.check": "Cheque",
  "method.eft": "Transferência (EFT)",
  "method.non_payment": "Sem pagamento",
  "clpStatus.1": "Processada como primária",
  "clpStatus.2": "Processada como secundária",
  "clpStatus.3": "Processada como terciária",
  "clpStatus.4": "Negada",
  "clpStatus.19": "Primária, encaminhada",
  "clpStatus.20": "Secundária, encaminhada",
  "clpStatus.21": "Terciária, encaminhada",
  "clpStatus.22": "Estorno",
  "clpStatus.23": "Não é nossa reivindicação, encaminhada",
  "clpStatus.25": "Somente predeterminação",
  "clpStatus.other": "Outro",

  // Lista de remessas (app/(app)/remittances/page.tsx)
  "list.title": "Remessas",
  "list.description":
    "Pagamentos de pagadores a partir de arquivos de remessa 835. Verifique se um arquivo fecha e depois lance-o nas reivindicações.",
  "list.newRemittance": "Nova remessa",
  "list.stat.readyToPost": "Prontas para lançar",
  "list.stat.readyDetail": "Carregadas, ainda não aplicadas às reivindicações",
  "list.stat.readyPaid": "Prontas para lançar, pago",
  "list.stat.posted": "Lançadas",
  "list.stat.postedPaid": "Lançadas, pago",
  "list.filter.allPayers": "Todos os pagadores",
  "list.empty.titleFiltered": "Nenhuma remessa corresponde a estes filtros",
  "list.empty.title": "Ainda não há remessas",
  "list.empty.description":
    "Carregue um arquivo de remessa 835 do pagador ou da câmara de compensação para vê-lo aqui.",
  "list.table.traceNumber": "Número de rastreio",
  "list.table.method": "Método",
  "list.table.paymentDate": "Data do pagamento",
  "list.table.claims": "Reivindicações",
  "list.table.paid": "Pago",

  // Nova remessa (app/(app)/remittances/new/page.tsx)
  "new.breadcrumbRemittances": "Remessas",
  "new.breadcrumbNew": "Nova",
  "new.title": "Nova remessa",
  "new.description":
    "Carregue um 835 do pagador ou da câmara de compensação. O DenialDesk verifica se ele fecha e corresponde às suas reivindicações antes de lançar qualquer coisa.",
  "new.backToRemittances": "Voltar para remessas",

  // Formulário de upload (app/(app)/remittances/new/UploadRemittanceForm.tsx)
  "upload.fileLabel": "Arquivo de remessa 835 (um pagamento, até 5 MB)",
  "upload.fileHint":
    "O pagador deve estar configurado com seu ID de pagador EDI, e toda reivindicação do arquivo já deve existir no DenialDesk. Nada muda em uma reivindicação até que a remessa seja lançada.",
  "upload.syntheticAttestation":
    "Este arquivo contém apenas dados sintéticos. Remessas reais não são permitidas neste ambiente.",
  "upload.submit": "Carregar e verificar",
  "upload.checking": "Verificando…",

  // Detalhe da remessa (app/(app)/remittances/[id]/page.tsx)
  "detail.pageTitle": "Remessa",
  "detail.breadcrumbRemittances": "Remessas",
  "detail.totalPaid": "Total pago",
  "detail.payment.title": "Pagamento",
  "detail.field.ediId": "EDI {ediId}",
  "detail.field.method": "Método",
  "detail.field.traceNumber": "Número de rastreio",
  "detail.field.paymentDate": "Data do pagamento",
  "detail.field.claimsPaid": "Reivindicações pagas",
  "detail.field.providerAdjustments": "Ajustes do prestador",
  "detail.field.balanceCheck": "Verificação de fechamento",
  "detail.field.loadedBy": "Carregada por",
  "detail.balances": "Fecha",
  "detail.doesNotBalance": "Não fecha",
  "detail.claimPayments.title": "Pagamentos de reivindicações",
  "detail.claimPayments.description": "Uma linha por reivindicação nesta remessa (loop CLP do 835).",
  "detail.table.payerStatus": "Status do pagador",
  "detail.table.charge": "Cobrança",
  "detail.table.paid": "Pago",
  "detail.table.patientOwes": "Paciente deve",
  "detail.table.adjustments": "Ajustes",
  "detail.icn": "ICN {number}",
  "detail.formerTeamMember": "Ex-integrante da equipe",
  "detail.system": "Sistema",
  "detail.actions.title": "Ações",
  "detail.actions.forbidden": "Seu perfil pode ver as remessas, mas não lançá-las.",
  "detail.denialsCaptured.title": "Negativas capturadas",
  "detail.denialsCaptured.description":
    "Adicionadas à fila de negativas quando esta remessa foi lançada. As categorias vêm do próprio mapeamento de códigos do DenialDesk, pendente de revisão.",
  "detail.history.title": "Histórico",
  "detail.history.listLabel": "Histórico da remessa",
  "error.fileFormat": "Não foi possível ler o arquivo 835: {detail}",
  "detail.history.description":
    "Cada alteração desta remessa: quem, quando e por quê. O histórico não pode ser editado.",
  "event.received": "Carregada",
  "event.posted": "Lançada",
  "event.void": "Anulada",

  // Ações de lançar / anular (app/(app)/remittances/[id]/RemittanceActions.tsx)
  "actions.postExplain":
    "Lançar atualiza o valor pago e o status de cada reivindicação (uma nova versão) e registra o pagamento ou a negativa no relógio de pagamento pontual. Não pode ser desfeito aqui.",
  "actions.postSubmit": "Lançar pagamentos",
  "actions.posting": "Lançando…",
  "actions.notBalanced": "Este arquivo não fecha, portanto não pode ser lançado.",
  "actions.voidPrompt": "Por que esta remessa está sendo anulada?",
  "actions.voidSubmit": "Anular remessa",
  "actions.voiding": "Anulando…",
  "actions.voidButton": "Anular…",

  // Erros e resultados da ação do servidor (app/(app)/remittances/actions.ts)
  "action.error.forbiddenUpload": "Seu perfil pode ver as remessas, mas não carregá-las.",
  "action.error.forbiddenPost": "Seu perfil pode ver as remessas, mas não lançá-las.",
  "action.error.forbiddenVoid": "Somente administradores e gerentes podem anular uma remessa.",
  "action.error.chooseFile": "Escolha um arquivo 835 para carregar.",
  "action.error.fileTooLarge": "O arquivo tem mais de 5 MB. Carregue uma remessa por arquivo.",
  "action.error.confirmSynthetic": "Confirme que o arquivo contém apenas dados sintéticos.",
  "action.error.notPlainText":
    "O arquivo não é texto simples. Carregue o 835 exatamente como o pagador o enviou.",
  "action.error.reload": "Recarregue a página e tente novamente.",
  "action.done.postedNoDenials":
    "Lançada em {count, plural, one {# reivindicação} other {# reivindicações}}.",
  "action.done.postedWithDenials":
    "Lançada em {claims, plural, one {# reivindicação} other {# reivindicações}}; {denials, plural, one {# negativa} other {# negativas}} adicionadas à fila.",
  "action.done.voided": "Anulada.",

  // Erros do domínio de remessas (domain/remittances/records.ts RemittanceError)
  "error.andMore": "{shown} e mais {count}",
  "error.noPayerId":
    "O arquivo não identifica o pagador (ID de pagador N1*PR). Peça ao pagador um arquivo corrigido.",
  "error.duplicatePayerId":
    "Mais de um pagador tem o ID de pagador EDI {ediPayerId}. Corrija o cadastro de pagadores e carregue novamente.",
  "error.unknownPayerId":
    "Nenhum pagador desta clínica tem o ID de pagador EDI {ediPayerId}. Adicione o pagador primeiro e carregue novamente.",
  "error.emptyReversals": "Estornos devem recuperar um pagamento: {claims} estornam $0.",
  "error.badReversals":
    "Pagamentos negativos devem ser estornos (CLP02 22) e estornos devem ser negativos: {claims}.",
  "error.duplicateClaims": "Há reivindicações repetidas neste arquivo: {claims}.",
  "error.duplicateTrace": "O número de rastreio {traceNumber} deste pagador já está registrado.",
  "error.noMatchingClaims": "Nenhuma reivindicação deste pagador corresponde a {claims}. Nada foi carregado.",
  "error.notPayable":
    "Estas reivindicações estão em rascunho, rejeitadas ou fechadas e não podem receber pagamento: {claims}.",
  "error.notFound": "Remessa não encontrada.",
  "error.alreadyVoid": "Esta remessa já está anulada.",
  "error.alreadyPosted": "Esta remessa já está lançada.",
  "error.notBalanced": "Esta remessa não fecha, portanto não pode ser lançada.",
  "error.payerUnavailable": "O pagador desta remessa não está mais disponível.",
  "error.claimUnavailable": "Uma reivindicação desta remessa não está mais disponível.",
  "error.claimNotPayable": "A reivindicação {claimNumber} está {status} e não pode receber pagamento.",
  "error.reversalExceedsPaid":
    "Reivindicação {claimNumber}: o estorno recupera mais do que foi pago. Nada foi lançado.",
  "error.voidReasonRequired": "Explique por que esta remessa está sendo anulada.",
  "error.reasonTooLong": "Mantenha o motivo com menos de {max} caracteres.",
  "error.onlyUnposted": "Somente uma remessa ainda não lançada pode ser anulada.",
  "error.reversalMismatch":
    "Um estorno desta remessa não corresponde a nenhum pagamento anterior do mesmo valor. Lance-o manualmente após confirmar com o pagador.",
};
