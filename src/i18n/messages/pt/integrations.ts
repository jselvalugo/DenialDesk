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
  "test.error.sandboxUnavailable": "O ambiente de testes integrado não está disponível neste ambiente.",
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
    "Não é possível enviar: o ambiente de testes integrado também precisa de um teste de conexão aprovado nas últimas 24 horas. Execute Testar conexão acima. Um teste que falhou, ou uma mudança na chave de assinatura do DenialDesk, exige uma nova aprovação no teste.",
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
  "sync.title": "Sincronizar agora",
  "sync.description":
    "Busca agora as últimas alterações de pacientes do EHR/PM conectado. Ela é executada por completo nesta solicitação, então uma clínica grande deve aguardar a sincronização agendada. Os pacientes são cópias somente leitura: corrija os dados demográficos no EHR/PM.",
  "sync.submit": "Sincronizar agora",
  "sync.pending": "Sincronizando…",
  "sync.resultOk": "Sincronização concluída",
  "sync.resultFailed": "Sincronização interrompida",
  "sync.result.succeeded":
    "{created} novos, {updated} atualizados, {linked} vinculados a pacientes existentes, {skipped} ignorados. Os registros ignorados e seus motivos ficam guardados com a execução da sincronização.",
  "sync.result.abandoned":
    "A sincronização parou porque a conexão foi pausada, revogada ou entrou em erro enquanto era executada. Os pacientes já salvos foram mantidos.",
  "sync.error.notActive": "Somente uma conexão ativa pode sincronizar. Retome-a primeiro.",
  "sync.error.rateLimited":
    "Sincronizar agora pode ser executado uma vez por minuto. Aguarde um momento e tente novamente.",
  "sync.error.alreadyRunning": "Já há uma sincronização em andamento para esta conexão.",
  "sync.error.failed": "Não foi possível concluir a sincronização. Recarregue a página e tente novamente.",
  "sync.failure.auth_refused":
    "O EHR/PM recusou as credenciais do DenialDesk, então a conexão agora precisa de atenção. Quando o administrador do EHR/PM resolver, execute Testar conexão e retome.",
  "sync.failure.token_endpoint_changed":
    "O endpoint de login do EHR/PM mudou, então a conexão agora precisa de atenção. Um endpoint diferente é uma nova conexão.",
  "sync.failure.issuer_mismatch":
    "O servidor não se identifica mais como o sistema para o qual esta conexão foi aprovada, então nada foi sincronizado. Entre em contato com o suporte do DenialDesk.",
  "sync.failure.not_synthetic":
    "Os dados não tinham a marca sintética, e este ambiente só aceita dados sintéticos. Nada foi salvo.",
  "sync.failure.environment_refused": "Esta conexão não pode sincronizar neste ambiente.",
  "sync.failure.signing_key_unavailable":
    "A chave de assinatura do DenialDesk não pode ser usada agora. Peça ao operador da plataforma que a verifique.",
  "sync.failure.unreachable":
    "O DenialDesk não conseguiu acessar o EHR/PM, ou demorou demais. Nada foi perdido. Tente novamente em alguns minutos.",
  "sync.failure.bad_response":
    "O EHR/PM enviou uma resposta que o DenialDesk não conseguiu usar. Nada mais foi salvo. Execute Testar conexão para verificar a configuração.",
  "sync.failure.capability_missing":
    "O EHR/PM não consegue fazer uma busca de que o DenialDesk precisa. Execute Testar conexão para verificar a configuração.",
  "sync.failure.too_large":
    "O EHR/PM enviou mais dados do que uma sincronização aceita. Os pacientes salvos até agora foram mantidos; tente novamente.",
  "sync.failure.other":
    "A sincronização parou por um problema inesperado. Tente novamente e entre em contato com o suporte do DenialDesk se se repetir.",
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
    "Associe cada seguradora informada pelo seu EHR/PM a um dos seus pagadores. O DenialDesk nunca adivinha: a cobertura de um paciente sincronizado recebe um pagador somente por meio de um mapeamento que você salva aqui, e apenas quando a sincronização atualizar em seguida a cobertura desse paciente. Enquanto uma seguradora não estiver mapeada, seus pacientes não têm pagador nem prazos do pagador.",
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
    "{count, plural, one {# mapeamento salvo.} other {# mapeamentos salvos.}} Os pacientes recebem o pagador quando a sincronização atualizar em seguida a cobertura deles. A alteração fica registrada no registro de auditoria.",
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
    "Cada sincronização desta conexão, da mais recente para a mais antiga, como contagens e códigos. Nenhum nome nem identificador aparece aqui.",
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
  "runs.issues.patient": "Paciente",
  "runs.issues.recorded": "Registrada",
  "runs.issues.openPatient": "Abrir paciente",
  "runs.issues.noPatient": "Sem paciente",
  "runs.issues.empty": "Esta sincronização não registrou ocorrências.",
  "runs.issues.truncated": "Mostrando as primeiras {count} ocorrências.",
  "runs.issues.notFound": "Essa sincronização não pertence a esta conexão.",
  "runs.code.mrn_missing": "Sem número de prontuário",
  "runs.code.mrn_ambiguous": "Mais de um número de prontuário",
  "runs.code.mrn_looks_like_ssn": "O número parece um número de Seguro Social",
  "runs.code.mrn_looks_like_mbi": "O número parece um número do Medicare",
  "runs.code.name_incomplete": "Nome incompleto",
  "runs.code.birthdate_incomplete": "Data de nascimento incompleta",
  "runs.code.address_incomplete": "Endereço incompleto",
  "runs.code.mrn_conflict": "Mesmo número, data de nascimento diferente",
  "runs.code.needs_review": "A cobertura precisa de revisão",
  "runs.code.linked_to_source": "Vinculado a um paciente existente",
  "runs.code.issuer_mismatch": "O emissor do EHR/PM não corresponde mais a esta conexão",
  "runs.code.not_synthetic": "Um registro não estava marcado como dado sintético de teste",
  "runs.code.paging_loop": "As páginas de resultados do EHR/PM entraram em loop",
  "runs.code.token_endpoint_changed": "O endpoint de tokens do EHR/PM mudou",
  "runs.code.scope_insufficient": "O acesso concedido é restrito demais",
  "runs.code.invalid_client": "O EHR/PM não reconhece o ID do cliente",
  "runs.code.unreachable": "Não foi possível alcançar o EHR/PM",
  "runs.code.tls_failed": "Não foi possível verificar a conexão segura",
  "runs.code.smart_config_invalid": "A configuração SMART está ausente ou inutilizável",
  "runs.code.auth_refused": "O EHR/PM recusou as credenciais do DenialDesk",
  "runs.code.capability_missing": "O EHR/PM não tem uma capacidade de que o DenialDesk precisa",
  "runs.code.internal_error": "O DenialDesk teve um erro interno",
  "runs.code.invalid": "O EHR/PM informou conteúdo inválido",
  "runs.code.security": "O EHR/PM informou um problema de segurança",
  "runs.code.login": "O EHR/PM pediu login",
  "runs.code.forbidden": "O EHR/PM negou o acesso",
  "runs.code.expired": "O token de acesso expirou",
  "runs.code.processing": "O EHR/PM não conseguiu processar a solicitação",
  "runs.code.duplicate": "O EHR/PM informou uma duplicidade",
  "runs.code.conflict": "O EHR/PM informou um conflito",
  "runs.code.transient": "Um problema temporário do EHR/PM",
  "runs.code.timeout": "O EHR/PM demorou demais para responder",
  "runs.code.throttled": "O EHR/PM limitou a taxa de solicitações",
  "runs.code.exception": "O EHR/PM informou um erro",
  "runs.code.incomplete": "A resposta do EHR/PM estava incompleta",
  "runs.code.informational": "O EHR/PM enviou um aviso",
  "runs.code.unknown": "Um problema não especificado do EHR/PM",
  "runs.code.resource_invalid": "Um registro não era um paciente utilizável",
  "runs.code.id_invalid": "Um registro não tinha um identificador utilizável",
  "runs.code.mrn_invalid": "Número de registro não utilizável",
  "runs.code.mrn_government_identifier": "O número de registro é um identificador oficial",
  "runs.code.name_invalid": "Nome não utilizável",
  "runs.code.birthdate_invalid": "Data de nascimento não utilizável",
  "runs.code.review_required": "Revise este paciente",
  "runs.code.address_refused": "O endereço do EHR/PM foi recusado",
  "runs.code.redirect_refused": "O EHR/PM tentou redirecionar a solicitação",
  "runs.code.content_type_refused": "O EHR/PM respondeu em um formato inesperado",
  "runs.code.too_large": "O EHR/PM enviou mais dados do que uma sincronização aceita",
  "runs.code.bad_response": "O EHR/PM enviou uma resposta que o DenialDesk não conseguiu usar",
  "runs.code.not_fhir": "O servidor não respondeu como FHIR R4",
  "runs.code.environment_refused": "Esta conexão não pode sincronizar neste ambiente",
  "runs.code.signing_key_unavailable": "A chave de assinatura do DenialDesk não pôde ser usada",
  "runs.code.connection_not_active": "A conexão não estava ativa",
  "runs.code.issues_truncated": "Somente as primeiras ocorrências desta execução estão listadas",
  "runs.code.structure": "O EHR/PM informou um problema de estrutura",
  "runs.code.required": "O EHR/PM informou a falta de um elemento obrigatório",
  "runs.code.value": "O EHR/PM informou um valor incorreto",
  "runs.code.invariant": "O EHR/PM informou uma violação de regra",
  "runs.code.suppressed": "O EHR/PM omitiu parte do conteúdo",
  "runs.code.not_supported": "O EHR/PM não oferece suporte à solicitação",
  "runs.code.multiple_matches": "O EHR/PM encontrou mais de uma correspondência",
  "runs.code.not_found": "O EHR/PM não encontrou o que foi solicitado",
  "runs.code.deleted": "O EHR/PM informou um registro excluído",
  "runs.code.too_long": "O EHR/PM informou conteúdo longo demais",
  "runs.code.code_invalid": "O EHR/PM informou um código inválido",
  "runs.code.extension": "O EHR/PM informou uma extensão não suportada",
  "runs.code.too_costly": "O EHR/PM recusou uma solicitação por ser muito custosa",
  "runs.code.business_rule": "O EHR/PM recusou a solicitação por uma regra de negócio",
  "runs.code.lock_error": "O EHR/PM informou um problema de bloqueio",
  "runs.code.no_store": "O EHR/PM não conseguiu armazenar a solicitação",
  "runs.code.other": "Outro",
  "payers.keyUnsupported":
    "A chave desta seguradora é longa demais ou contém caracteres ocultos, por isso não pode ser mapeada aqui.",
  "runs.code.record_rejected": "Os próprios limites do armazenamento de dados recusaram um registro",
  "runs.code.population_scope_unenforced":
    "Ainda não é possível limitar a sincronização aos pacientes da sua clínica",
  "sync.failure.population_scope_unenforced":
    "Nada foi sincronizado. O DenialDesk ainda não consegue limitar uma conexão real de EHR/PM aos pacientes da sua clínica, então as conexões reais não sincronizam até que consiga. Nada foi solicitado ao EHR/PM.",
  "sync.error.populationScopeUnenforced":
    "As conexões reais de EHR/PM ainda não podem sincronizar: o DenialDesk ainda não consegue limitá-las aos pacientes da sua clínica. Nada foi solicitado.",
};
