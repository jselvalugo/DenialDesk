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
  "detail.patient.memberIdNone": "Nenhum registrado",
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

  // Importação de cobranças (app/(app)/claims/import, docs/specs/claims.md C2)
  "detail.history.createdByImport": "Criada pela importação de cobranças",
  "import.button": "Importar cobranças",
  "import.title": "Importar cobranças",
  "import.description":
    "Envie um CSV de cobranças e o DenialDesk cria reivindicações em rascunho. Se alguma linha precisar de correção, nada é importado.",
  "import.breadcrumbClaims": "Reivindicações",
  "import.forbidden": "Seu perfil pode ver as reivindicações, mas não importar cobranças.",
  "import.backToClaims": "Voltar às reivindicações",
  "import.file.title": "Arquivo de cobranças",
  "import.file.description":
    "Um CSV de até {size} MB e {rows} linhas. É lido uma única vez e nunca é armazenado.",
  "import.file.label": "Arquivo CSV",
  "import.file.hint": "Uma linha por linha de reivindicação, com as colunas listadas abaixo.",
  "import.defaults.title": "Prestador e local",
  "import.defaults.description":
    "Usados nas reivindicações cujas linhas não têm NPI do prestador nem local. Uma linha que informa seu próprio prestador ou local o mantém.",
  "import.defaults.provider": "Prestador padrão",
  "import.defaults.location": "Local padrão",
  "import.defaults.choose": "Escolher",
  "import.synthetic.title": "Confirmação",
  "import.synthetic.description": "Este ambiente aceita apenas dados sintéticos.",
  "import.synthetic.attestation":
    "Confirmo que este arquivo contém apenas dados sintéticos. Os números de reivindicação começam com SYN- e os MRN com SYN.",
  "import.submit": "Importar cobranças",
  "import.submitting": "Importando…",
  "import.auditNote": "Cada importação e cada reivindicação que ela cria é registrada no log de auditoria.",
  "import.format.title": "Formato do arquivo",
  "import.format.description":
    "Linhas com o mesmo número de reivindicação são as linhas de uma só reivindicação; as colunas da reivindicação se repetem em cada linha e devem coincidir. Os códigos são guardados exatamente como escritos: a importação nunca altera, acrescenta nem corrige um código.",
  "import.format.column": "Coluna",
  "import.format.rule": "O que vai nela",
  "import.format.required": "Obrigatória",
  "import.format.optional": "Opcional",
  "import.format.template": "Baixar o modelo (apenas a linha de cabeçalho)",
  "import.format.tableCaption": "Colunas do arquivo de cobranças",
  "import.column.claimNumber":
    "O número de reivindicação ou de cobrança da sua própria prática: até 30 letras, dígitos, pontos, hifens ou sublinhados. Nunca um ID de beneficiário.",
  "import.column.mrn":
    "Número do prontuário de um paciente que já está no DenialDesk. A importação nunca cria nem altera pacientes.",
  "import.column.payer": "Nome do pagador como aparece na lista de pagadores desta prática.",
  "import.column.serviceDate": "AAAA-MM-DD ou M/D/AAAA, sem datas futuras.",
  "import.column.diagnosisCodes": "De 1 a 12 códigos ICD-10-CM separados por espaços ou vírgulas.",
  "import.column.procedureCode": "Código CPT ou HCPCS: cinco letras ou dígitos.",
  "import.column.modifiers": "Até quatro modificadores de dois caracteres.",
  "import.column.units": "Número inteiro de 1 a 999.",
  "import.column.charge": "Cobrança total da linha em dólares, de $0.01 a $99,999.99.",
  "import.column.providerNpi":
    "NPI de dez dígitos de um prestador desta prática. Em branco usa o prestador padrão.",
  "import.column.location": "Nome do local como aparece nesta prática. Em branco usa o local padrão.",

  // Verificações do envio e falhas (retornadas pela ação de importação)
  "import.error.chooseFile": "Escolha um arquivo CSV para importar.",
  "import.error.notCsv": "O arquivo deve ser um arquivo .csv.",
  "import.error.tooLarge": "O arquivo é maior que {size} MB.",
  "import.error.confirmSynthetic": "Confirme que o arquivo contém apenas dados sintéticos.",
  "import.error.notUtf8": "O arquivo não é texto UTF-8. Salve-o como CSV (UTF-8) e tente novamente.",
  "import.error.forbidden": "Seu perfil pode ver as reivindicações, mas não importar cobranças.",
  "import.error.defaults": "Escolha um prestador padrão e um local padrão desta prática.",
  "import.error.notImported": "Nada foi importado. Corrija as linhas abaixo e envie o arquivo novamente.",
  "import.error.conflict":
    "Uma reivindicação com um destes números foi criada enquanto o arquivo era lido. Nada foi importado; tente novamente.",

  // Relatório de problemas
  "import.problems.aria": "Linhas a corrigir",
  "import.problems.row": "Linha {row}: {message}",
  "import.problems.showing": "Mostrando os primeiros {shown} de {total} problemas.",
  "import.problems.download": "Baixar relatório (CSV)",
  "import.problems.truncated":
    "O relatório lista os primeiros {limit} problemas; {more} a mais não foram listados.",

  // Problemas (domain/claims/charge-file.ts PROBLEM_MESSAGE_KEYS); nunca citam o valor de uma célula
  "import.problem.noDataRows": "O arquivo tem cabeçalho, mas nenhuma linha de cobrança.",
  "import.problem.missingColumns": "Faltam colunas obrigatórias no cabeçalho: {columns}.",
  "import.problem.ambiguousColumns": "Mais de uma coluna corresponde a: {columns}. Mantenha só uma.",
  "import.problem.csvTooManyColumns": "Uma linha tem mais de {max} colunas.",
  "import.problem.csvTooManyRows": "O arquivo tem mais de {max} linhas.",
  "import.problem.csvTextAfterQuote": "Há texto depois de aspas de fechamento.",
  "import.problem.csvQuoteInField": "Há aspas dentro de um campo sem aspas.",
  "import.problem.csvUnclosedQuote": "Um campo entre aspas nunca é fechado.",
  "import.problem.alreadyImported":
    "Todos os números de reivindicação deste arquivo já existem, então este arquivo parece já ter sido importado.",
  "import.problem.tooLong": "{column} tem mais de {max} caracteres.",
  "import.problem.claimNumberBlank": "O número da reivindicação está em branco.",
  "import.problem.claimNumberFormat":
    "O número da reivindicação deve ter de 1 a 30 letras, dígitos, pontos, hifens ou sublinhados.",
  "import.problem.claimNumberNotSynthetic":
    "Neste ambiente (somente dados sintéticos) o número da reivindicação deve começar com {prefix}.",
  "import.problem.mrnBlank": "O MRN está em branco.",
  "import.problem.mrnNotSynthetic":
    "Neste ambiente (somente dados sintéticos) o MRN deve começar com {prefix}.",
  "import.problem.payerBlank": "O pagador está em branco.",
  "import.problem.serviceDateInvalid": "A data do serviço não é uma data real. Use AAAA-MM-DD ou M/D/AAAA.",
  "import.problem.serviceDateTooOld": "A data do serviço é anterior a 2000-01-01.",
  "import.problem.serviceDateFuture": "A data do serviço está no futuro.",
  "import.problem.diagnosisBlank": "Os códigos de diagnóstico estão em branco.",
  "import.problem.diagnosisFormat":
    "Um código de diagnóstico não está no formato ICD-10-CM (por exemplo, E11.9). A importação nunca altera códigos.",
  "import.problem.diagnosisTooMany": "Mais de {max} códigos de diagnóstico.",
  "import.problem.procedureCodeFormat":
    "O código do procedimento deve ter cinco letras ou dígitos (CPT/HCPCS). A importação nunca altera códigos.",
  "import.problem.modifierFormat": "Um modificador deve ter duas letras ou dígitos.",
  "import.problem.modifierTooMany": "Mais de {max} modificadores.",
  "import.problem.unitsInvalid": "As unidades devem ser um número inteiro de 1 a 999.",
  "import.problem.chargeInvalid": "A cobrança não é um valor em dólares válido.",
  "import.problem.chargeRange": "A cobrança deve ser de $0.01 a $99,999.99 por linha.",
  "import.problem.providerNpiFormat": "O NPI do prestador deve ter 10 dígitos.",
  "import.problem.claimFieldsDiffer":
    "{column} difere da primeira linha desta reivindicação. As colunas da reivindicação devem coincidir em todas as linhas.",
  "import.problem.tooManyLines": "Uma reivindicação pode ter no máximo {max} linhas.",
  "import.problem.patientNotFound":
    "Nenhum paciente desta prática tem este MRN. A importação nunca cria pacientes.",
  "import.problem.payerNotFound": "Nenhum pagador da lista desta prática tem este nome.",
  "import.problem.payerAmbiguous": "Dois pagadores têm este nome e não podem ser distinguidos.",
  "import.problem.providerNotFound": "Nenhum prestador desta prática tem este NPI.",
  "import.problem.locationNotFound": "Nenhum local desta prática tem este nome.",
  "import.problem.locationAmbiguous": "Mais de um local tem este nome.",
  "import.problem.claimNumberExists":
    "Já existe uma reivindicação com este número. Corrija as reivindicações existentes pela página da reivindicação.",
  "import.problem.matchesExistingClaim":
    "Uma reivindicação existente tem o mesmo paciente, pagador, data do serviço e um código de procedimento com os mesmos modificadores. Possível duplicidade.",
  "import.problem.matchesClaimInFile":
    "Outra reivindicação deste arquivo tem o mesmo paciente, pagador, data do serviço e um código de procedimento com os mesmos modificadores. Possível duplicidade.",

  "import.problem.duplicateLine":
    "Esta linha repete uma linha anterior da mesma reivindicação (mesmo código de procedimento e modificadores). Se o arquivo foi colado duas vezes, remova a cópia.",
  "import.problem.claimRowsNotContiguous":
    "As linhas de uma reivindicação devem ficar juntas, mas este número de reivindicação aparece de novo depois de outras reivindicações.",
  "import.error.rateLimited":
    "Importações demais em pouco tempo para esta prática. Aguarde alguns minutos e tente novamente.",
  "import.file.claimNumberNotice":
    "O número da reivindicação é guardado sem criptografia em nível de campo. Nunca coloque nele um ID de beneficiário, um número de Seguro Social ou qualquer outro identificador.",

  // Resultado
  "import.result.title": "Importação concluída",
  "import.result.summary":
    "{claims, plural, one {# reivindicação em rascunho criada} other {# reivindicações em rascunho criadas}} a partir de {lines, plural, one {# linha} other {# linhas}}, {billed} faturados.",
  "import.result.warningsTitle": "Vale a pena conferir",
  "import.result.noWarnings": "Nenhum aviso.",
  "import.result.pastDeadline":
    "{count, plural, one {# reivindicação passou do prazo de envio} other {# reivindicações passaram do prazo de envio}}.",
  "import.result.dueSoon":
    "{count, plural, one {# reivindicação vence em até {days} dias} other {# reivindicações vencem em até {days} dias}}.",
  "import.result.notConfigured":
    "{count, plural, one {# reivindicação não tem regra de envio configurada para seu pagador} other {# reivindicações não têm regra de envio configurada para seu pagador}}.",
  "import.result.payerUnverified":
    "{count, plural, one {# reivindicação é de um pagador não verificado, por isso ainda não pode ser enviada} other {# reivindicações são de pagadores não verificados, por isso ainda não podem ser enviadas}}.",
  "import.result.noCoverage":
    "{count, plural, one {# reivindicação é de um paciente sem cobertura registrada} other {# reivindicações são de pacientes sem cobertura registrada}}.",
  "import.result.patientInactive":
    "{count, plural, one {# reivindicação é de um paciente marcado como inativo ou mesclado no registro de origem} other {# reivindicações são de pacientes marcados como inativos ou mesclados no registro de origem}}.",
  "import.result.viewClaims": "Ver reivindicações não enviadas",
  "import.result.viewPastDeadline": "Ver reivindicações fora do prazo",
  "import.result.another": "Importar outro arquivo",

  // 837P generation (claims C3a): app/(app)/claims/[id]/Claim837Form.tsx
  "edi.title": "Reivindicação eletrônica (837P)",
  "edi.description":
    "Gera esta reivindicação como um arquivo X12 837P que você pode visualizar e baixar. Nada é enviado a um pagador nem a uma clearinghouse.",
  "edi.testNotice":
    "Somente arquivo de teste. Este ambiente contém apenas dados sintéticos, então o arquivo é marcado como teste e usa identificadores de remetente e destinatário fictícios.",
  "edi.pointers.title": "Ponteiros de diagnóstico",
  "edi.pointers.description":
    "Esta reivindicação tem mais de um diagnóstico. Para cada linha, escolha os diagnósticos que a sustentam, até quatro. Nada é escolhido por você.",
  "edi.pointers.line": "Linha {line}: {code}",
  "edi.pointers.option": "{position}. {code}",
  "edi.generate": "Gerar 837P",
  "edi.generating": "Gerando…",
  "edi.result.summary":
    "Arquivo {controlNumber} gerado: {segments} segmentos, {lines, plural, one {# linha de serviço} other {# linhas de serviço}}.",
  "edi.result.testFile": "Arquivo de teste (ISA15 = T). Não é enviado a lugar nenhum.",
  "edi.result.previewLabel": "Pré-visualização do 837P com o ID de associado e o ID fiscal mascarados",
  "edi.result.masked":
    "O ID de associado e o ID fiscal estão mascarados aqui. O arquivo baixado os contém completos.",
  "edi.result.download": "Baixar arquivo",
  "edi.result.pastDeadline":
    "Esta reivindicação está fora do prazo de apresentação. Confira o painel de prazos antes de enviar este arquivo a qualquer lugar.",
  "edi.error.forbidden": "Seu perfil pode ver as reivindicações, mas não gerar arquivos de reivindicação.",
  "edi.error.rateLimited":
    "Muitos arquivos foram gerados em pouco tempo. Aguarde alguns minutos e tente novamente.",
  "edi.error.notFound": "Não foi possível encontrar esta reivindicação.",
  "edi.error.reload": "Recarregue a página e tente novamente.",
  "edi.error.notGenerated": "O 837P não foi gerado. Corrija os itens abaixo e tente novamente.",
  "edi.issue.status_not_generatable": "Somente reivindicações em rascunho ou rejeitadas podem ser geradas.",
  "edi.issue.not_synthetic_environment":
    "Ainda não é possível gerar arquivos de reivindicação em produção: os identificadores de remetente e destinatário para o envio real não estão configurados.",
  "edi.issue.no_member_id":
    "Não há cobertura de pagador registrada para este paciente. Adicione ou mapeie primeiro o ID de associado.",
  "edi.issue.coverage_payer_mismatch":
    "O pagador desta reivindicação não é o pagador principal do paciente, ao qual pertence o ID de associado registrado.",
  "edi.issue.payer_not_verified": "O pagador ainda não tem um ID de pagador EDI nem um regime verificados.",
  "edi.issue.claim_filing_indicator_unmapped":
    "O indicador de apresentação de reivindicações para este tipo de pagador ainda não foi confirmado, então não é possível gerar um arquivo.",
  "edi.issue.billing_npi": "O NPI do prestador está ausente ou não é um NPI válido.",
  "edi.issue.billing_name": "Faltam o nome e o sobrenome do prestador para a cobrança.",
  "edi.issue.billing_taxonomy":
    "O código de taxonomia do prestador está ausente ou não tem o formato correto.",
  "edi.issue.billing_tin":
    "O ID fiscal do prestador ou o seu tipo está ausente, ou o ID fiscal não tem nove dígitos.",
  "edi.issue.billing_address":
    "O endereço de cobrança do prestador está incompleto: precisa de rua, cidade, estado e CEP de nove dígitos.",
  "edi.issue.billing_address_po_box":
    "O endereço de cobrança deve ser um endereço físico, não uma caixa postal.",
  "edi.issue.subscriber_name": "Faltam o nome e o sobrenome do paciente.",
  "edi.issue.subscriber_birth_date": "A data de nascimento do paciente está ausente ou não é uma data real.",
  "edi.issue.subscriber_address":
    "O endereço do paciente está incompleto: precisa de rua, cidade, estado e CEP.",
  "edi.issue.missing_place_of_service": "O local da reivindicação não tem código de local de serviço.",
  "edi.issue.diagnosis_invalid":
    "A reivindicação precisa de um a doze códigos de diagnóstico no formato ICD-10-CM.",
  "edi.issue.diagnosis_pointers_required": "Linha {line}: escolha quais diagnósticos sustentam esta linha.",
  "edi.issue.diagnosis_pointer_invalid":
    "Linha {line}: escolha de um a quatro diagnósticos diferentes desta reivindicação.",
  "edi.issue.lines_missing": "A reivindicação não tem linhas de serviço.",
  "edi.issue.lines_too_many": "A reivindicação tem mais de {max} linhas de serviço.",
  "edi.issue.line_invalid":
    "Linha {line}: o código de procedimento, os modificadores, as unidades ou a cobrança não têm o formato esperado.",
  "edi.issue.line_invalid_general": "As linhas de serviço têm um número de linha repetido.",
  "edi.issue.billed_mismatch": "O valor cobrado não é a soma das cobranças das linhas.",
  "edi.issue.claim_number_invalid":
    "O número da reivindicação não pode ser usado como número de controle do paciente.",
  "edi.issue.service_date_invalid": "A data do serviço não é uma data real.",
  "edi.issue.invalid_character":
    "{field}: tem um caractere, ou um tamanho, que um 837P não consegue transportar.",
  "edi.issue.control_number_exhausted":
    "Os números de controle da prática se esgotaram. Entre em contato com o suporte.",
  "edi.field.billing_last_name": "Sobrenome do prestador",
  "edi.field.billing_first_name": "Nome do prestador",
  "edi.field.billing_address": "Endereço do prestador",
  "edi.field.billing_city": "Cidade do prestador",
  "edi.field.subscriber_last_name": "Sobrenome do paciente",
  "edi.field.subscriber_first_name": "Nome do paciente",
  "edi.field.subscriber_address": "Endereço do paciente",
  "edi.field.subscriber_city": "Cidade do paciente",
  "edi.field.subscriber_member_id": "ID de associado",
  "edi.field.payer_name": "Nome do pagador",
  "edi.result.title": "Arquivo gerado",
  "edi.field.envelope_id": "ID de remetente ou destinatário",
};
