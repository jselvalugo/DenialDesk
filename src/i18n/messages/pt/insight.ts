import type { Messages } from "../types";

export const insight: Messages["insight"] = {
  moduleName: "Análises",
  "meta.listTitle": "Análises — relatórios",

  "list.description":
    "Relatórios padrão sobre tendências de negativas, recuperação e desempenho dos pagadores, calculados a partir das reivindicações e negativas da sua própria clínica.",
  "list.downloadAll": "Baixar todos os relatórios (Excel)",
  "list.open": "Abrir",

  "catalog.denialsByCategory.title": "Resumo de negativas por categoria e CARC",
  "catalog.denialsByCategory.purpose":
    "Onde se concentram os dólares e o volume de negativas, por causa raiz.",
  "catalog.denialsByPayer.title": "Resumo de negativas por pagador",
  "catalog.denialsByPayer.purpose":
    "Quais pagadores geram mais dólares e volume de negativas, e sua categoria principal.",
  "catalog.denialRate.title": "Taxa de negativas",
  "catalog.denialRate.purpose":
    "A proporção de reivindicações faturadas que receberam pelo menos uma negativa.",
  "catalog.denialsByDeadlineBucket.title": "Negativas em aberto por faixa de vencimento do recurso",
  "catalog.denialsByDeadlineBucket.purpose":
    "Um total em formato de relatório do que a fila de negativas já usa para ordenar.",
  "catalog.claimsByStatus.title": "Reivindicações por situação / resumo de contas a receber",
  "catalog.claimsByStatus.purpose":
    "Quanto está pendente e em que situação, diretamente da tabela de reivindicações.",
  "catalog.appealOutcomes.title": "Resultados de recurso",
  "catalog.appealOutcomes.purpose": "Taxas de reversão versus manutenção, por pagador e categoria.",
  "catalog.promptPayScorecard.title": "Painel de pagamento pontual",
  "catalog.promptPayScorecard.purpose":
    "Planejado; consulte a especificação (bloqueado pela correção de classificação de avisos, revisão de faturamento F4).",
  "catalog.underpaymentVariance.title": "Variação de subpagamento",
  "catalog.underpaymentVariance.purpose":
    "Planejado; consulte a especificação (bloqueado por uma tabela de payer_contracts / tabela de honorários).",

  "report.noDataTitle": "Sem dados para este período",
  "report.noDataDescription": "Tente um período mais amplo ou um pagador diferente.",
  "report.noRowsMatch": "Nenhuma linha corresponde aos filtros atuais.",
  "report.downloadExcel": "Baixar Excel",
  "report.exportRestrictedRoles":
    "A exportação deste relatório é limitada às funções de administrador, gerente e conformidade.",
  "report.plannedBadge": "Planejado — ver especificação",

  "filters.from": "De",
  "filters.to": "Até",
  "filters.allPayers": "Todos os pagadores",
  "filters.selectedPayer": "Pagador selecionado",
  "filters.payerNotApplicable":
    "O filtro de pagador não se aplica: este relatório é o detalhamento por pagador.",
  "filters.dateRange": "Intervalo de datas: {from} a {to}",
  "filters.payerLine": "Pagador: {payer}",
  "filters.error.invalidStartDate": "Essa data de início não existe.",
  "filters.error.invalidEndDate": "Essa data de término não existe.",
  "filters.error.endBeforeStart": "A data de término deve ser igual ou posterior à data de início.",
  "filters.error.rangeTooLong": "O intervalo de datas não pode ser superior a 3 anos.",

  "error.forbidden": "Proibido",
  "error.notFound": "Não encontrado",

  "suppression.label": "Suprimido (<{threshold})",

  "columns.carc": "CARC",
  "columns.count": "Quantidade",
  "columns.deniedAmount": "Negado ($)",
  "columns.averageDeniedAmount": "Negado médio ($)",
  "columns.verified": "Verificado",
  "columns.topCategory": "Categoria principal",
  "columns.claimsSubmittedInRange": "Reivindicações enviadas no período",
  "columns.claimsWithDenial": "Reivindicações com uma negativa (por data do aviso)",
  "columns.denialRate": "Taxa de negativas",
  "columns.deadlineBucket": "Faixa de vencimento",
  "columns.billedAmount": "Faturado ($)",
  "columns.paidAmount": "Pago ($)",
  "columns.outstandingAmount": "Pendente ($)",
  "columns.group": "Grupo",
  "columns.overturned": "Revertidos",
  "columns.upheld": "Mantidos",
  "columns.overturnRate": "Taxa de reversão",
  "columns.deniedAmountReversed": "Valor negado revertido ($)",

  "value.verified": "Verificado",
  "value.unverified": "Não verificado",

  "sheet.denialsByCategory": "Negativas por categoria",
  "sheet.denialsByPayer": "Negativas por pagador",
  "sheet.denialRate": "Taxa de negativas",
  "sheet.denialsByDeadlineBucket": "Negativas em aberto (prazo)",
  "sheet.claimsByStatus": "Reivindicações por situação",
  "sheet.appealOutcomesByPayer": "Resultados por pagador",
  "sheet.appealOutcomesByCategory": "Resultados por categoria",

  "bucket.pastDeadline": "Prazo vencido",
  "bucket.0to7": "0–7 dias",
  "bucket.8to30": "8–30 dias",
  "bucket.31plus": "31+ dias",
  "bucket.noDeadline": "Sem prazo configurado",

  "empty.noClaimsSubmitted": "Nenhuma reivindicação enviada neste período",
  "empty.noDecidedAppeals": "Nenhum recurso decidido neste período",

  "definitions.category":
    "A classificação da fila de trabalho do DenialDesk para o CARC da negativa (REQUIREMENTS §8.3).",
  "definitions.deniedAmount": "Soma do valor negado (denials.deniedCents) do grupo.",
  "definitions.averageDeniedAmount": "Negado ($) dividido pela quantidade, para o grupo.",
  "definitions.verified": "Se o pagador tem um ID de pagador EDI confirmado e um regime regulatório.",
  "definitions.topCategory":
    "A categoria com a maior soma de dólares negados para aquele pagador; empates são resolvidos pela ordem do enum de categorias.",
  "definitions.claimsSubmittedInRange":
    "Reivindicações com status diferente de rascunho, cuja data de envio (ou data de atendimento, se ainda não enviada) está dentro do período selecionado.",
  "definitions.denialRate":
    "Reivindicações distintas com pelo menos uma negativa no período, divididas pelas reivindicações distintas enviadas no período.",
  "definitions.deadlineBucket":
    "Dias restantes até o prazo do recurso, calculados da mesma forma que na fila de negativas (rules/deadlines.ts); nunca recalculados.",
  "definitions.noDeadlineConfigured":
    "O pagador não está verificado ou não tem uma janela de recurso configurada; nunca é estimado.",
  "definitions.outstandingAmount": "Faturado ($) menos pago ($) para o grupo.",
  "definitions.overturnRate":
    "Revertidos dividido por (revertidos + mantidos) para o grupo; em branco quando não há recursos decididos no período.",
  "definitions.deniedAmountReversed":
    "Soma de dólares negados apenas nas linhas revertidas: um limite superior, não um pagamento registrado (ainda não existe a tabela de remessas).",

  "caveats.unknownCarc":
    "Um código CARC fora da lista de referência (src/domain/carc.ts) é exibido com seu código bruto, sem descrição.",
  "caveats.payerFilterNotApplicable":
    "O filtro de pagador não se aplica a este relatório: este é o detalhamento por pagador.",
  "caveats.denialRateFallback":
    "O rastreamento da data de envio (C3 837P) ainda não foi implementado; usa a data de atendimento quando submittedAt é nulo.",
  "caveats.noDeadlineConfiguredExplain":
    '"Sem prazo configurado" inclui pagadores não verificados e pagadores sem uma janela de recurso configurada.',
  "caveats.paidAmountsPartial":
    "Os valores pagos só são registrados quando capturados: a contabilização de remessas 835 ainda não foi implementada.",
  "caveats.latestOutcomeOnly":
    "Reflete apenas o status atual da negativa; ainda não existe uma tabela de histórico de recursos, portanto uma negativa que mudou de status é exibida pelo seu resultado mais recente.",
  "caveats.smallCellSuppression":
    'Supressão de células pequenas (R-8.7): uma linha que inclui uma reivindicação de um paciente com uma tag de sensibilidade (R-3.5.1) e cuja quantidade está abaixo do limite de supressão exibe "Suprimido (<{threshold})" em vez de sua quantidade e de seus valores/taxas em dólares, para evitar identificar esse paciente. Quando exatamente uma linha da planilha seria suprimida, a próxima linha menor com quantidade diferente de zero também é suprimida, para que o valor oculto não possa ser inferido a partir das demais. Sempre que qualquer linha de uma planilha é suprimida, a linha de totais dessa planilha também é suprimida, pois do contrário o total menos as linhas visíveis reconstruiria exatamente o valor oculto. Risco residual aceito (⚠️ VERIFY com a assessoria jurídica): essa supressão é por relatório e por período; comparar dois períodos sobrepostos do mesmo relatório, ou dois relatórios diferentes que cubram as mesmas reivindicações, ainda pode permitir que um leitor determinado deduza por diferença uma célula suprimida; nesta versão não há proteção contra diferenciação entre relatórios ou entre períodos. ⚠️ VERIFY: o limite ({threshold}) segue a convenção de supressão por tamanho de célula dos arquivos de uso público dos CMS como referência de política, não um estatuto da Flórida; confirmar com a assessoria jurídica.',
  "caveats.denialRateResidualRisk":
    "Este relatório é uma única taxa em nível de toda a clínica para o período completo, não um detalhamento linha por linha, portanto a supressão de células pequenas (R-8.7) não se aplica da mesma forma. Risco residual aceito (⚠️ VERIFY com a assessoria jurídica): a quantidade de reivindicações negadas é um total em nível de toda a clínica, não é suprimida mesmo quando pequena, e um período ou filtro de pagador suficientemente restrito ainda poderia identificar a reivindicação de um único paciente com tag de sensibilidade.",

  "about.sheetName": "Sobre",
  "about.practice": "Clínica",
  "about.generatedAt": "Gerado em",
  "about.generatedBy": "Gerado por (ID do usuário)",
  "about.filtersApplied": "Filtros aplicados",
  "about.definitionsHeading": "Definições",
  "about.caveatsHeading": "Ressalvas sobre os dados",
  "about.confidentiality":
    "Contém dados confidenciais da clínica; trate-os conforme a política da sua clínica.",
  "about.allReportsName": "Todos os relatórios de Análises",
  "about.combinedPayerFilterCaveat":
    "O filtro de pagador foi aplicado nos relatórios que o admitem; o relatório de negativas por pagador sempre mostra todos os pagadores.",
};
