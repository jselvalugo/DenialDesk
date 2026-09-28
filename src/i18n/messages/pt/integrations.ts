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
  "revoke.confirm": "Entendo que revogar esta conexão é permanente.",
  "revoke.submit": "Revogar conexão",
  "revoke.pending": "Revogando…",
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
};
