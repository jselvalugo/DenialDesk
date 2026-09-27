import type { Messages } from "../types";

export const promptPay: Messages["promptPay"] = {
  "nav.breadcrumb": "Trilha de navegação",
  "list.stat.sectionLabel": "Totais de pagamento pontual",

  // Status do relógio e tipos de resposta (domain/prompt-pay/clock.ts)
  "clockState.open": "Aberto",
  "clockState.met": "Cumprido",
  "clockState.late": "Pagador atrasado",
  "clockState.uncontestable": "Incontestável",
  "responseKind.payment": "Pagamento",
  "responseKind.denial": "Negativa",
  "responseKind.contest": "Contestação ou pedido de informação",

  // Estados dos marcos (app/(app)/prompt-pay/[claimId]/page.tsx MILESTONE_STATES)
  "milestoneState.met": "Cumprido",
  "milestoneState.late": "Cumprido com atraso",
  "milestoneState.open": "Aberto",
  "milestoneState.overdue": "Não cumprido",

  // Cabeçalhos de tabela compartilhados entre a lista e o detalhe
  "table.received": "Recebido",
  "table.clockDay": "Dia do relógio",
  "table.nextMilestone": "Próximo marco",
  "table.paid": "Pago",
  "table.interest": "Juros",
  "table.state": "Status",
  "table.milestone": "Marco",
  "table.due": "Vencimento",
  "table.metOn": "Cumprido em",
  "table.daysLate": "Dias de atraso",
  "table.paymentDate": "Data do pagamento",
  "table.dueDate": "Data de vencimento",
  "table.rate": "Taxa",

  // Lista de pagamento pontual (app/(app)/prompt-pay/page.tsx)
  "list.title": "Pagamento pontual",
  "list.description":
    "Relógios de pagamento pontual da Flórida a partir da data de recebimento pelo pagador: o que o pagador deve e quando, marcos não cumpridos e juros.",
  "list.stat.open": "Relógios abertos",
  "list.stat.openDetail": "Aguardando pagamento ou negativa",
  "list.dueSoonLabel": "Vence em {days} dias",
  "list.stat.dueSoonDetail": "Próximo marco do pagador",
  "list.stat.late": "Pagador atrasado",
  "list.stat.lateDetail": "Não cumpriu um marco",
  "list.stat.uncontestable": "Incontestável",
  "list.stat.uncontestableDetail": "Não pago nem negado a tempo",
  "list.stat.interestOwed": "Juros devidos",
  "list.stat.interestDetail": "Sobre pagamentos atrasados",
  "list.filter.clock": "Relógio",
  "list.filter.allPayers": "Todos os pagadores",
  "list.truncated":
    "Mais de {limit} reivindicações recebidas: a lista e os totais cobrem apenas as recebidas mais recentemente.",
  "list.empty.titleFiltered": "Nenhum relógio corresponde a estes filtros",
  "list.empty.title": "Nenhum relógio de pagamento pontual",
  "list.empty.description":
    "Um relógio começa quando um pagador coberto pelo pagamento pontual da Flórida confirma o recebimento de uma reivindicação.",
  "list.table.electronic": "Eletrônica",
  "list.table.paper": "Papel",
  "list.table.day": "Dia {day}",
  "list.table.dayAlert": "Alerta do dia {day}",
  "list.footnote":
    "Os marcos e a taxa de juros vêm do motor de regras e estão pendentes de verificação jurídica na Flórida. Os dias de alerta ({days}) são uma configuração da clínica.",

  // Detalhe do relógio de pagamento pontual (app/(app)/prompt-pay/[claimId]/page.tsx)
  "detail.pageTitle": "Relógio de pagamento pontual",
  "detail.breadcrumbPromptPay": "Pagamento pontual",
  "detail.kind.electronic": "eletrônica",
  "detail.kind.paper": "em papel",
  "detail.claimLabel": "reivindicação {kind}",
  "detail.received": "recebida em {date}",
  "detail.day": "dia {day}",
  "detail.openClaim": "Abrir reivindicação",
  "detail.recordContest": "Registrar contestação",
  "detail.noRegime":
    "O regime regulatório deste pagador ainda não foi verificado, então o DenialDesk não executa um relógio de pagamento pontual para ele. Um administrador pode verificar o pagador.",
  "detail.notCovered":
    "O pagamento pontual da Flórida não cobre reivindicações de {regime}, portanto esta reivindicação não tem relógio.",
  "detail.notReceived":
    "O pagador ainda não confirmou o recebimento desta reivindicação, então seu relógio de pagamento pontual não começou.",
  "detail.uncontestableAlert":
    "O pagador não pagou nem negou esta reivindicação até o marco de incontestabilidade. O pagamento agora pode ser uma obrigação incontestável (R-3.1.4). Confirme com um advogado antes de enviar uma cobrança.",
  "detail.milestones.title": "Marcos",
  "detail.milestones.caption": "Marcos do pagamento pontual",
  "detail.milestones.description": "Contados em dias corridos a partir da data de recebimento pelo pagador.",
  "detail.milestones.pendingVerification": "Pendente de verificação jurídica",
  "detail.interest.title": "Planilha de juros",
  "detail.interest.description":
    "Juros simples sobre cada pagamento feito após o vencimento do pagamento (R-3.1.3).",
  "detail.interest.noneWithDue": "Nenhum pagamento atrasado. O pagamento vence em {date}.",
  "detail.interest.noneNoDue": "Ainda não há pagamentos.",
  "detail.interest.totalOwed": "Total de juros devidos",
  "detail.interest.ratePerYear": "{rate}% ao ano",
  "detail.interest.footnote":
    "Os juros começam no dia seguinte ao vencimento do pagamento (a data de pagar ou contestar, ou a de pagar ou negar assim que o pagador contesta). Pendente de verificação jurídica.",
  "detail.claim.title": "Reivindicação",
  "detail.claim.billedPaid": "Faturado / pago",
  "detail.claim.contestResponseDue": "Sua resposta à contestação vence em",
  "detail.responses.title": "Respostas do pagador",
  "detail.responses.description":
    "Cada resposta deste relógio. As entradas nunca são editadas nem excluídas.",
  "detail.responses.none": "Nenhum pagamento, negativa ou contestação registrado ainda.",
  "detail.responses.recordedInError": "Registrado por engano: ",
  "detail.responses.fromRemittance": "Da remessa",
  "detail.responses.formerTeamMember": "Ex-integrante da equipe",
  "detail.responses.system": "Sistema",

  // Formulário de anulação (registrado por engano) (app/(app)/prompt-pay/[claimId]/VoidResponseForm.tsx)
  "void.button": "Registrado por engano…",
  "void.prompt": "Por que esta entrada está errada?",
  "void.submit": "Marcar como erro",
  "void.saving": "Salvando…",

  // Página e formulário de nova contestação
  "newContest.title": "Registrar contestação do pagador",
  "newContest.description":
    "O pagador contestou esta reivindicação ou pediu mais informações. Isso cumpre apenas o marco de pagar ou contestar; o relógio de pagar ou negar continua correndo.",
  "newContest.breadcrumbRecordContest": "Registrar contestação",
  "contestForm.dateLabel": "Data do aviso do pagador",
  "contestForm.dateHint": "A data em que o pagador contestou a reivindicação ou pediu informações.",
  "contestForm.noteLabel": "O que o pagador pediu?",
  "contestForm.submit": "Registrar contestação",
  "contestForm.saving": "Salvando…",

  // Erros e resultados da ação do servidor (app/(app)/prompt-pay/actions.ts)
  "action.error.forbiddenRecord":
    "Seu perfil pode ver os relógios de pagamento pontual, mas não registrar respostas.",
  "action.error.forbiddenChange": "Seu perfil pode ver os relógios de pagamento pontual, mas não alterá-los.",
  "action.error.reload": "Recarregue a página e tente novamente.",
  "action.error.invalidDate": "Informe a data do aviso do pagador.",
  "action.done.voided": "Marcado como registrado por engano.",

  // Erros do domínio de pagamento pontual (domain/prompt-pay/responses.ts PromptPayError)
  "error.sayWhatPayerAsked": "Explique o que o pagador pediu.",
  "error.sayWhyWrong": "Explique por que esta entrada está errada.",
  "error.noteTooLong": "Mantenha isso com menos de {max} caracteres.",
  "error.claimNotFound": "Reivindicação não encontrada.",
  "error.notReceived": "O pagador ainda não recebeu esta reivindicação.",
  "error.noticeBeforeReceived":
    "O aviso do pagador não pode ter data anterior ao recebimento da reivindicação pelo pagador.",
  "error.noticeInFuture": "A data do aviso não pode estar no futuro.",
  "error.entryNotFound": "Entrada não encontrada.",
  "error.notVoidable": "Pagamentos e negativas vêm de remessas e não podem ser marcados como erro aqui.",
  "error.alreadyVoided": "Esta entrada já está marcada como registrada por engano.",
};
