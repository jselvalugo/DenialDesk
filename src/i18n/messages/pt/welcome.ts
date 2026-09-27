import type { Messages } from "../types";

export const welcome: Messages["welcome"] = {
  "meta.title": "Bem-vindo",
  heading: "Bem-vindo, {name}",
  intro:
    "O DenialDesk acompanha cada reivindicação do envio ao pagamento: classifica as negativas, as prioriza por valor e prazo, e mantém os prazos da Flórida que determinam o que ainda pode ser recuperado.",
  openQueue: "Abrir a fila de negativas",

  "howItWorks.title": "Como o DenialDesk funciona",
  "howItWorks.description": "O caminho que uma reivindicação percorre na plataforma",

  "step1.title": "Registrar a reivindicação",
  "step1.body":
    "As reivindicações são mantidas com suas linhas de serviço, códigos de diagnóstico e procedimento, o pagador e o prazo de envio que se aplica a elas.",
  "step1.link": "Reivindicações",
  "step2.title": "Classificar a negativa",
  "step2.body":
    "Cada negativa é interpretada pelos seus códigos de motivo CARC e RARC e agrupada em uma categoria que aponta a solução mais provável.",
  "step2.link": "Negativas",
  "step3.title": "Trabalhar primeiro o que mais importa",
  "step3.body":
    "A fila ordena as negativas em aberto por prazo de recurso ou valor em jogo, com prazos calculados a partir de regras da Flórida e do pagador com controle de versão.",
  "step3.link": "Fila de negativas",
  "step4.title": "Recorrer com aprovação",
  "step4.body":
    "Os recursos são redigidos a partir da negativa e do registro da reivindicação. Nenhum código de procedimento ou diagnóstico muda sem uma aprovação humana registrada.",
  "step5.title": "Acompanhar o resultado",
  "step5.body":
    "As recuperações, as baixas e os tempos de resposta dos pagadores são relatados para que a clínica veja quais pagadores e motivos mais lhe custam.",

  "recordFlow.title": "Do prontuário do paciente à reivindicação e à negativa",
  "recordFlow.description":
    "Como o prontuário do paciente alimenta cada reivindicação, e para onde volta cada negativa",

  "record1.title": "Prontuário do paciente",
  "record1.body":
    "O cadastro mantém os dados demográficos e a cobertura principal: pagador, plano e ID do beneficiário (criptografado). Cada reivindicação é vinculada ao paciente e ao pagador cobrado, de modo que o prontuário por trás de cada reivindicação fica a um clique de distância.",
  "record1.link": "Pacientes",
  "record2.title": "As cobranças viram reivindicações",
  "record2.body":
    "As cobranças do seu sistema de gestão da clínica ou EHR chegarão por arquivo CSV e se tornarão reivindicações em rascunho vinculadas ao paciente e ao pagador. Conexões diretas com o EHR não estão previstas para o lançamento.",
  "record3.title": "Reivindicação enviada e respondida",
  "record3.body":
    "As reivindicações serão enviadas à clearinghouse como arquivos 837P; as confirmações e as remessas 835 voltarão e serão associadas à reivindicação.",
  "record4.title": "A negativa volta ao prontuário",
  "record4.body":
    "Cada negativa é vinculada à sua reivindicação e ao seu paciente. O prontuário do paciente lista todas as suas reivindicações e negativas, para que um erro de cobertura ou de cadastro possa ser encontrado e corrigido ali mesmo.",
  "record4.link": "Prontuários dos pacientes",

  "modules.title": "Seus módulos",
  "modules.description": "Também disponíveis no seletor de módulos (Ctrl K)",

  "safeguards.title": "Salvaguardas",
  "safeguards.description": "Controles de segurança e conformidade em vigor hoje",

  "safeguard1.title": "Os dados da clínica ficam separados",
  "safeguard1.body": "Cada registro é delimitado à sua clínica na camada de banco de dados.",
  "safeguard2.title": "Todo acesso é registrado",
  "safeguard2.body":
    "As leituras e alterações nos dados do paciente são gravadas em uma trilha de auditoria: quem, o quê e quando.",
  "safeguard3.title": "Os prazos vêm de regras citadas",
  "safeguard3.body":
    "Os prazos de envio, pagamento pontual e recurso são regras com controle de versão e data de vigência, com sua fonte legal.",
  "safeguard4.title": "Pessoas aprovam as mudanças de codificação",
  "safeguard4.body":
    "Nenhum código de procedimento ou diagnóstico será alterado sem uma aprovação humana registrada.",
  "safeguard5.title": "O login exige um segundo fator",
  "safeguard5.body":
    "Cada conta da clínica usa um código de autenticação, e as sessões inativas terminam após {minutes} minutos.",
  "safeguard6.title": "Os identificadores são criptografados",
  "safeguard6.body":
    "Os IDs de beneficiário são criptografados campo a campo, e os nomes dos pacientes ficam fora dos endereços de página.",
  "safeguard7.title": "Acordos de associado comercial arquivados",
  "safeguard7.body":
    "O acordo assinado de cada clínica é registrado com suas datas e signatários; a falta de um é sinalizada.",
};
