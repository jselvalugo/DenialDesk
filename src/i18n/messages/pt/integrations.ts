import type { Messages } from "../types";

export const integrations: Messages["integrations"] = {
  "meta.title": "Integrações",
  "list.panelTitle": "Conexões com EHR/PM",
  "list.panelDescription":
    "Conecte seu sistema EHR ou de gestão do consultório para que o Registro de pacientes seja sincronizado a partir dele. Somente configuração: nenhuma informação de paciente aparece aqui.",
  "list.newConnection": "Nova conexão",
  "list.emptyTitle": "Ainda não há conexão com um EHR/PM",
  "list.emptyDescriptionAdmin":
    "Crie uma conexão para sincronizar o Registro de pacientes a partir do seu EHR/PM. Até lá, a equipe cadastra os pacientes manualmente.",
  "list.emptyDescriptionReadOnly":
    "Um administrador pode conectar seu EHR/PM. Até lá, a equipe cadastra os pacientes manualmente.",
  "list.tableCaption": "Conexões com EHR/PM",
  "list.name": "Nome",
  "list.source": "Origem",
  "list.lastSync": "Última sincronização bem-sucedida",
  "list.created": "Criada",
  "list.never": "Nunca",
  "source.sandbox": "Ambiente de teste integrado",
  "source.fhir": "EHR/PM (FHIR R4)",
  "target.patients": "Registro de pacientes",
  "status.draft": "Rascunho",
  "status.pending_approval": "Aguardando aprovação",
  "status.active": "Ativa",
  "status.paused": "Pausada",
  "status.error": "Requer atenção",
  "status.revoked": "Revogada",
  "new.metaTitle": "Nova conexão",
  "new.title": "Nova conexão com EHR/PM",
  "new.description":
    "Uma nova conexão começa como rascunho. Salvá-la não contata o EHR/PM nem sincroniza nenhum paciente.",
  "new.sandboxNotice":
    "Este ambiente usa apenas dados sintéticos, então se conecta ao ambiente de teste integrado, nunca a um EHR/PM real.",
  "new.create": "Criar conexão",
  "new.creating": "Criando…",
  "form.displayName": "Nome da conexão",
  "form.displayNameHint": "Exibido ao lado da aba Pacientes. Não inclua informações de pacientes.",
  "form.baseUrl": "URL base do FHIR",
  "form.baseUrlHint": "Da documentação FHIR do seu EHR/PM, por exemplo https://fhir.example.com/r4.",
  "form.clientId": "ID de cliente",
  "form.clientIdHint": "O ID que o administrador do seu EHR/PM registrou para o DenialDesk.",
  "form.mrnSystem": "Sistema de identificadores de MRN",
  "form.mrnSystemHint":
    "O sistema de identificadores que seu EHR/PM usa para números de prontuário, como URL ou urn:oid. Nunca um sistema de Seguro Social, Medicare, carteira de motorista ou passaporte.",
  "form.endpointLockedHint":
    "A URL, o ID de cliente e o sistema de identificadores ficam fixos depois que a conexão é enviada ou sincronizada. Para usar outro endpoint, revogue esta conexão e crie uma nova.",
  "form.save": "Salvar alterações",
  "form.saving": "Salvando…",
  "detail.metaTitle": "Conexão",
  "detail.configurationTitle": "Configuração",
  "detail.configurationDescription": "O que o DenialDesk usa para acessar seu EHR/PM.",
  "detail.status": "Status",
  "detail.source": "Origem",
  "detail.target": "Sincroniza com",
  "detail.tokenEndpoint": "Endpoint de token",
  "detail.issuer": "Emissor",
  "detail.notDiscovered": "Obtido quando a conexão é testada",
  "detail.created": "Criada",
  "detail.submitted": "Enviada",
  "detail.approved": "Aprovada",
  "detail.revokedAt": "Revogada",
  "detail.lastSync": "Última sincronização bem-sucedida",
  "detail.editTitle": "Editar conexão",
  "detail.editDescription": "As alterações ficam registradas no log de auditoria.",
  "revoke.title": "Revogar conexão",
  "revoke.description":
    "Revogar é permanente: o DenialDesk deixa de usar esta conexão, e ela não pode ser reativada. Para conectar de novo, crie uma nova conexão.",
  "revoke.reason": "Motivo",
  "revoke.reasonHint":
    "Fica registrado no log de auditoria. Não inclua informações de pacientes em nenhum campo.",
  "revoke.reasonPlaceholder": "Escolha um motivo",
  "revoke.reason.no_longer_used": "Não usamos mais esta conexão",
  "revoke.reason.switching_systems": "Estamos trocando de sistema EHR/PM",
  "revoke.reason.configured_in_error": "Foi configurada por engano",
  "revoke.reason.security_concern": "Preocupação de segurança",
  "revoke.reason.other": "Outro",
  "revoke.confirm": "Entendo que revogar esta conexão é permanente.",
  "revoke.submit": "Revogar conexão",
  "revoke.pending": "Revogando…",
  "lifecycle.title": "Sincronização",
  "lifecycle.active":
    "Pausar interrompe a sincronização de pacientes desta conexão. Nada é excluído, e você pode retomar depois.",
  "lifecycle.paused":
    "A sincronização está pausada. Retomá-la a reinicia e exige que você verifique sua identidade com o aplicativo autenticador antes.",
  "lifecycle.error":
    "O DenialDesk parou de sincronizar por causa de um erro. Depois que o administrador do seu EHR/PM resolver, execute Testar conexão e obtenha uma aprovação, e então retome. Retomar também exige que você verifique sua identidade com o aplicativo autenticador antes.",
  "lifecycle.pending_approval":
    "Esta conexão está aguardando aprovação. Retirá-la a devolve a um rascunho que você pode editar e enviar de novo.",
  "pause.submit": "Pausar sincronização",
  "pause.pending": "Pausando…",
  "resume.submit": "Retomar sincronização",
  "resume.pending": "Retomando…",
  "withdraw.submit": "Retirar envio",
  "withdraw.pending": "Retirando…",
  "stepUp.link": "Verificar minha identidade",
  "offboarding.title": "Etapas de desconexão",
  "offboarding.description": "Conclua estas etapas com o administrador do seu EHR/PM depois de revogar:",
  "offboarding.step1":
    "Remova ou desative o registro de cliente do DenialDesk (ID de cliente {clientId}) no EHR/PM.",
  "offboarding.step2": "Remova qualquer chave pública do DenialDesk registrada no EHR/PM.",
  "offboarding.step3":
    "Os pacientes já sincronizados permanecem no DenialDesk como registros somente leitura e deixam de ser atualizados: as correções feitas no EHR/PM não chegarão ao DenialDesk.",
  "offboarding.step4": "Anote quem no consultório confirmou que o registro foi removido, e quando.",
  "offboarding.revokedNotice":
    "Revogada em {date}. Conclua as etapas de desconexão abaixo, se ainda não o fez.",
  "error.saveFailed": "Não foi possível salvar a conexão. Recarregue a página e tente novamente.",
  "error.confirmRevoke": "Marque a caixa para confirmar que entende que revogar é permanente.",
  "error.revokeReasonRequired": "Escolha por que você está revogando esta conexão.",
  "error.stepUpRequired":
    "Isso exige uma verificação em duas etapas recente. Verifique sua identidade e tente novamente.",
  "error.invalidTransition": "Esta conexão não está em um estado que permita isso. Recarregue a página.",
  "error.notAdmin": "Somente um administrador pode gerenciar integrações.",
  "error.notFound": "Integração não encontrada.",
  "error.stale": "Esta conexão mudou desde que você a abriu. Recarregue a página e tente novamente.",
  "error.revoked": "Esta conexão foi revogada e não pode mais ser alterada.",
  "error.unexpectedField":
    "O formulário enviou um campo não permitido. Recarregue a página e tente novamente.",
  "error.displayNameRequired": "Digite um nome para esta conexão.",
  "error.displayNameTooLong": "O nome deve ter no máximo 80 caracteres.",
  "error.displayNameInvalid": "O nome não pode conter caracteres de controle.",
  "error.clientIdRequired": "Digite o ID de cliente que o EHR/PM atribuiu ao DenialDesk.",
  "error.clientIdInvalid": "O ID de cliente só aceita caracteres visíveis sem espaços, até 255.",
  "error.url.invalid": "Digite a URL base do FHIR, por exemplo https://fhir.example.com/r4.",
  "error.url.too_long": "A URL é longa demais.",
  "error.url.not_https": "A URL deve começar com https://.",
  "error.url.credentials": "Remova o usuário ou a senha da URL.",
  "error.url.query_or_fragment": "Remova da URL a parte depois de ? ou #.",
  "error.url.ip_literal": "Use o nome de host do servidor, não um endereço IP.",
  "error.url.reserved_host":
    "Este nome de host só funciona em uma rede privada. Use o nome de host público do EHR/PM.",
  "error.url.single_label": "Use o nome de host completo, com o domínio (por exemplo fhir.example.com).",
  "error.url.trailing_dot": "Remova o ponto no final do nome de host.",
  "error.url.port_not_allowed": "Esta porta não é permitida. Use a porta HTTPS padrão (443).",
  "error.url.path_characters":
    "O caminho da URL só aceita letras, dígitos e - . _ ~ /. Copie a URL base exatamente como o EHR/PM a documenta.",
  "error.url.sandbox": "Para usar o ambiente de teste integrado, escolha-o ao criar a conexão.",
  "error.realEndpointRefused":
    "Este ambiente usa apenas dados sintéticos, então não pode se conectar a um EHR/PM real. Use o ambiente de teste integrado.",
  "error.sandboxRefused": "O ambiente de teste integrado não está disponível em produção.",
  "error.mrnSystem.invalid":
    "Digite o sistema de identificadores que o EHR/PM usa para números de prontuário, como URL ou urn:oid.",
  "error.mrnSystem.too_long": "O sistema de identificadores é longo demais.",
  "error.mrnSystem.government_identifier":
    "Esse sistema é um número de Seguro Social, Medicare, carteira de motorista ou passaporte, não um número de prontuário.",
  "error.endpointLocked":
    "A URL, o ID de cliente e o sistema de identificadores só podem mudar enquanto a conexão for um rascunho que nunca foi sincronizado.",
  "test.outcome.ok":
    "O teste foi bem-sucedido. O DenialDesk alcançou o servidor, encontrou seu ponto de autenticação e recebeu um token de acesso. Nenhuma informação de pacientes foi solicitada.",
  "test.outcome.unreachable":
    "O DenialDesk não conseguiu alcançar o servidor. Verifique a URL base e se o servidor está aberto à internet e não bloqueado por um firewall. Tente novamente em alguns minutos.",
  "test.outcome.tls_failed":
    "Não foi possível verificar a conexão segura (TLS) do servidor. O certificado deve ser válido, emitido por uma autoridade pública e corresponder ao nome do host, e o servidor deve aceitar TLS 1.2 ou superior.",
  "test.outcome.not_fhir_r4":
    "O servidor não respondeu como FHIR R4 (versão 4.0.1). Verifique se a URL base é o endpoint FHIR R4.",
  "test.outcome.smart_config_invalid":
    "A configuração SMART do servidor está ausente ou inutilizável. O DenialDesk precisa de SMART Backend Services com JWT de chave privada assinado com ES384 ou RS384.",
  "test.outcome.auth_refused":
    "O servidor recusou as credenciais do DenialDesk. Verifique o ID de cliente e se o administrador do EHR/PM registrou a chave pública do DenialDesk para este cliente.",
  "test.outcome.capability_missing":
    "O servidor não consegue fazer o que o DenialDesk precisa: pesquisar Patient por data da última atualização, pesquisar Coverage por paciente e conceder acesso de leitura a Patient, Coverage e Organization.",
  "test.error.rateLimited": "Testes de conexão demais. Aguarde alguns minutos e tente novamente.",
  "test.error.keyNotConfigured":
    "A chave de assinatura do DenialDesk não está configurada neste ambiente, então as conexões não podem ser testadas. Peça ao operador da plataforma que a configure.",
  "test.error.keyUnavailable":
    "A chave de assinatura do DenialDesk não pode ser usada agora. Peça ao operador da plataforma que a verifique.",
  "test.error.sandboxUnavailable": "O ambiente de testes integrado ainda não pode ser testado.",
  "test.error.failed": "Não foi possível concluir o teste. Recarregue a página e tente novamente.",
  "test.title": "Testar conexão",
  "test.description":
    "Verifica se o DenialDesk consegue alcançar o servidor, ler sua configuração SMART e obter um token de acesso. Nenhuma informação de pacientes é solicitada.",
  "test.submit": "Testar conexão",
  "test.pending": "Testando…",
  "test.resultOk": "Teste bem-sucedido",
  "test.resultFailed": "Teste com falha",
  "submit.title": "Enviar conexão",
  "submit.descriptionReal":
    "Ao enviar, esta conexão vai para o DenialDesk aprovar. Nada é sincronizado até que seja aprovada, e você pode retirar o envio até lá. Ela exige um teste de conexão aprovado, sua confirmação abaixo e uma verificação de identidade recente.",
  "submit.descriptionSandbox":
    "O ambiente de testes integrado contém apenas dados sintéticos, então não precisa de aprovação: ao enviá-lo, ele é ativado. Exige um teste de conexão aprovado e uma verificação de identidade recente.",
  "submit.attestation": "Este endpoint de EHR/PM armazena e processa dados somente nos Estados Unidos",
  "submit.attestationHint": "Registrado no log de auditoria com seu nome e a data.",
  "submit.stepUpNotice":
    "Para enviar, você precisa antes verificar sua identidade com o aplicativo autenticador.",
  "submit.blocked.noPassingTest":
    "Não é possível enviar: esta conexão não tem um teste de conexão aprovado nas últimas 24 horas. Execute Testar conexão acima. Um teste que falhou, ou uma mudança na conexão ou na chave de assinatura do DenialDesk, exige uma nova aprovação no teste.",
  "submit.blocked.sandbox":
    "Não é possível enviar: exige um teste de conexão aprovado, e o ambiente de testes integrado ainda não pode ser testado.",
  "submit.submit": "Enviar para aprovação",
  "submit.submitSandbox": "Ativar ambiente de testes",
  "submit.pending": "Enviando…",
  "submit.awaitingTitle": "Aguardando a aprovação do DenialDesk",
  "submit.awaitingDescription":
    "O DenialDesk revisa cada conexão real antes de ela começar a sincronizar. Nada é sincronizado até que seja aprovada. Para alterar a conexão antes, retire o envio.",
  "error.testRequired":
    "O teste de conexão precisa ser aprovado primeiro. Uma aprovação vale por 24 horas, e só para a configuração e a chave de assinatura que testou. Execute-o de novo e depois envie.",
  "error.testRequiredToResume":
    "Esta conexão parou por causa de um erro. Execute Testar conexão e obtenha uma aprovação antes de retomar.",
  "error.attestationRequired":
    "Confirme que o endpoint armazena e processa dados somente nos Estados Unidos.",
  "error.registryConflict": "Este endpoint e este ID de cliente já estão conectados",
  "error.localeChanged":
    "O idioma da página mudou desde que você a abriu. Recarregue a página, leia a confirmação de novo e envie.",
  "error.submitRateLimited": "Muitas tentativas de envio. Aguarde alguns minutos e tente novamente.",
  "error.attestationChanged":
    "O texto da confirmação mudou desde que você abriu a página. Recarregue a página, leia a confirmação novamente e envie.",
  "error.anotherConnectionLive":
    "Já existe outra conexão em uso (enviada, ativa, pausada ou com erro). Retire-a ou revogue-a primeiro.",
  "rejected.notice.endpoint_not_verified":
    "O DenialDesk não aprovou esta conexão: não foi possível verificar o endpoint com o administrador de EHR/PM. Corrija-a, execute Testar conexão e envie novamente.",
  "rejected.notice.client_id_not_verified":
    "O DenialDesk não aprovou esta conexão: não foi possível verificar o ID do cliente com o administrador de EHR/PM. Corrija-a, execute Testar conexão e envie novamente.",
  "rejected.notice.contact_not_verified":
    "O DenialDesk não aprovou esta conexão: não foi possível contatar o administrador de EHR/PM para confirmá-la. Corrija-a se necessário, execute Testar conexão e envie novamente.",
  "rejected.notice.population_not_scoped":
    "O DenialDesk não aprovou esta conexão: os pacientes a sincronizar não foram limitados à sua clínica. Corrija-a, execute Testar conexão e envie novamente.",
  "rejected.notice.configuration_incorrect":
    "O DenialDesk não aprovou esta conexão: a configuração está incorreta. Corrija-a, execute Testar conexão e envie novamente.",
  "rejected.notice.other":
    "O DenialDesk não aprovou esta conexão. O DenialDesk entrará em contato para explicar o motivo. Depois de resolvido, execute Testar conexão e envie novamente.",
  "detail.moreTitle": "Pagadores e histórico de sincronização",
  "detail.moreDescription":
    "O que o DenialDesk leu desta conexão e como as seguradoras se associam aos seus pagadores.",
  "detail.payersLink": "Mapeamento de pagadores",
  "detail.payersHint": "Associe cada seguradora informada pelo seu EHR/PM a um dos seus pagadores.",
  "detail.runsLink": "Histórico de sincronização",
  "detail.runsHint": "Contagens e códigos de ocorrência de cada sincronização.",
  "payers.metaTitle": "Mapeamento de pagadores",
  "payers.title": "Mapeamento de pagadores",
  "payers.description":
    "Associe cada seguradora informada pelo seu EHR/PM a um dos seus pagadores. O DenialDesk nunca adivinha: a cobertura de um paciente sincronizado recebe um pagador somente por meio de um mapeamento que você salva aqui. Enquanto uma seguradora não estiver mapeada, seus pacientes não têm pagador nem prazos do pagador.",
  "payers.crumb": "Mapeamento de pagadores",
  "payers.tableCaption": "Seguradoras informadas pelo EHR/PM, com o pagador ao qual cada uma está associada",
  "payers.col.insurer": "Seguradora (chave do EHR/PM)",
  "payers.col.name": "Nome no EHR/PM",
  "payers.col.patients": "Pacientes",
  "payers.col.status": "Situação",
  "payers.col.payer": "Pagador do DenialDesk",
  "payers.status.mapped": "Mapeada",
  "payers.status.unmapped": "Não mapeada",
  "payers.notMapped": "Não mapeada",
  "payers.selectLabel": "Pagador da seguradora {insurer}",
  "payers.emptyTitle": "Ainda não há seguradoras para mapear",
  "payers.emptyDescription":
    "As seguradoras aparecem aqui depois que uma sincronização lê a cobertura dos pacientes no EHR/PM. Antes disso não há nada para mapear.",
  "payers.noPayersTitle": "Não há pagadores para associar",
  "payers.noPayersDescription":
    "Adicione seus pagadores em Configurações, Pagadores, e volte aqui para mapear as seguradoras.",
  "payers.stepUpNotice":
    "Salvar um mapeamento exige que você verifique sua identidade com o aplicativo autenticador primeiro.",
  "payers.save": "Salvar mapeamentos",
  "payers.saving": "Salvando…",
  "payers.saved":
    "{count, plural, one {# mapeamento salvo.} other {# mapeamentos salvos.}} A alteração fica registrada no registro de auditoria.",
  "payers.nothingChanged": "Nada mudou: nenhum mapeamento era diferente do que já está salvo.",
  "payers.revokedNotice": "Esta conexão foi revogada, então seus mapeamentos não podem mais mudar.",
  "payers.truncated": "Mostrando as primeiras {count} seguradoras.",
  "error.payerUnknown": "Escolha um dos seus próprios pagadores, ou deixe a seguradora sem mapeamento.",
  "error.payerKeyUnknown":
    "Esta conexão não informou essa seguradora. Recarregue a página e tente novamente.",
  "error.payersStale":
    "Um mapeamento mudou desde que você abriu esta página. Recarregue a página e tente novamente.",
  "error.payersTooMany":
    "Há seguradoras demais para salvar de uma vez. Recarregue a página e tente novamente.",
  "runs.metaTitle": "Histórico de sincronização",
  "runs.title": "Histórico de sincronização",
  "runs.description":
    "Cada sincronização desta conexão, da mais recente para a mais antiga, como contagens e códigos. Nenhuma informação de pacientes aparece aqui.",
  "runs.crumb": "Histórico de sincronização",
  "runs.tableCaption": "Sincronizações, da mais recente para a mais antiga",
  "runs.col.queued": "Na fila",
  "runs.col.trigger": "Iniciada por",
  "runs.col.status": "Situação",
  "runs.col.finished": "Concluída",
  "runs.col.created": "Criados",
  "runs.col.updated": "Atualizados",
  "runs.col.linked": "Vinculados",
  "runs.col.skipped": "Ignorados",
  "runs.col.codes": "Códigos de ocorrência",
  "runs.col.http": "Status HTTP",
  "runs.col.issues": "Ocorrências",
  "runs.trigger.manual": "Sincronizar agora",
  "runs.trigger.scheduled": "Agendamento",
  "runs.status.queued": "Na fila",
  "runs.status.running": "Em andamento",
  "runs.status.succeeded": "Concluída com sucesso",
  "runs.status.failed": "Falhou",
  "runs.status.abandoned": "Abandonada",
  "runs.notFinished": "Não concluída",
  "runs.noCodes": "Nenhum",
  "runs.emptyTitle": "Nenhuma sincronização foi executada ainda",
  "runs.emptyDescription": "As sincronizações aparecem aqui quando esta conexão está ativa e uma é iniciada.",
  "runs.viewIssues": "Ver {count, plural, one {# ocorrência} other {# ocorrências}}",
  "runs.noIssues": "Nenhuma",
  "runs.issues.title": "Ocorrências desta sincronização",
  "runs.issues.description":
    "Registros que a sincronização ignorou ou vinculou, por código. Abra um paciente para vê-lo no Registro de pacientes.",
  "runs.issues.caption": "Ocorrências registradas por esta sincronização",
  "runs.issues.code": "Código",
  "runs.issues.patient": "ID do paciente",
  "runs.issues.recorded": "Registrada",
  "runs.issues.openPatient": "Abrir paciente",
  "runs.issues.noPatient": "Sem paciente",
  "runs.issues.empty": "Esta sincronização não registrou ocorrências.",
  "runs.issues.truncated": "Mostrando as primeiras {count} ocorrências.",
  "runs.issues.notFound": "Essa sincronização não pertence a esta conexão.",
};
