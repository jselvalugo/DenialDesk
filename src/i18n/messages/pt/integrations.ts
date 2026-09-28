import type { Messages } from "../types";

export const integrations: Messages["integrations"] = {
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
};
