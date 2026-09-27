import type { Messages } from "../types";

export const university: Messages["university"] = {
  eyebrow: "Universidade DenialDesk",
  "nav.breadcrumb": "Trilha de navegação",
  "nav.lesson": "Navegação da lição",
  "breadcrumb.university": "Universidade",

  // Catálogo de cursos (/university)
  "catalog.title": "Cursos",
  "catalog.description":
    "Cursos curtos sobre o funcionamento do DenialDesk, como ler uma negativa, os prazos da Flórida que o produto aplica e como os dados do paciente são protegidos. Suas lições concluídas são mantidas em sua conta.",
  "catalog.openWiki": "Abrir a Wiki",
  "catalog.lessonsCompleted": "{done} de {total} lições concluídas",
  "catalog.audience": "Para: {audience}",
  "catalog.lessonsLabel": "Lições",
  "catalog.readingLabel": "Leitura",
  "catalog.readingMinutes": "{count} min",
  "catalog.progressLabel": "Progresso",
  "catalog.openCourse": "Abrir curso",
  "catalog.openCourseAria": "Abrir curso: {title}",
  "catalog.disclaimer":
    "Os cursos descrevem o comportamento do DenialDesk e não constituem aconselhamento jurídico ou de conformidade. Os prazos exibidos em uma lição são lidos das mesmas regras versionadas que o produto usa, com suas citações.",

  "progress.complete": "Concluído",
  "progress.notStarted": "Não iniciado",
  "progress.ofLessons": "{completed} de {total} lições",

  "course.startCourse": "Iniciar curso",
  "course.continueCourse": "Continuar curso",
  "course.complete": "Curso concluído",
  "course.lessonsDescription": "Para: {audience} · {minutes} min de leitura · {progress}",
  "course.completedOn": "Concluído em {date}",
  "course.openLesson": "Abrir",
  "course.openLessonAria": "Abrir lição: {title}",

  "lesson.eyebrow": "{course} · Lição {position} de {total}",
  "lesson.progressTitle": "Seu progresso",
  "lesson.progressDescription": "As conclusões são mantidas em sua conta e não podem ser desfeitas.",
  "lesson.previous": "Anterior: {title}",
  "lesson.next": "Próxima: {title}",
  "lesson.backToCourse": "Voltar ao curso",

  "complete.completed": "Lição concluída em {date}",
  "complete.action": "Marcar lição como concluída",
  "complete.lessonGone": "Esta lição não existe mais.",

  "lessonBody.inDenialDesk": "No DenialDesk",
  "lessonBody.rule": "Regra",
  "lessonBody.appliesTo": "Aplica-se a",
  "lessonBody.countedFrom": "Contado a partir de",
  "lessonBody.value": "Valor",
  "lessonBody.source": "Fonte",
  "lessonBody.noVersion": "Hoje não há nenhuma versão vigente desta regra.",
  "lessonBody.referenceOnly": "Apenas para referência",
  "lessonBody.confirmedByCounsel": "Confirmado pela assessoria jurídica em {date}",
  "lessonBody.pendingCounselVerification": "Pendente de verificação jurídica",
  "lessonBody.code": "Código",
  "lessonBody.summary": "Resumo",
  "lessonBody.category": "Categoria do DenialDesk",
  "lessonBody.carcFootnote":
    "Resumos, não o texto oficial do X12; as categorias são a classificação própria do DenialDesk.",
  "lessonBody.groupCode": "Código de grupo",
  "lessonBody.groupCodeFootnote": "Resumos dos códigos de grupo X12 835, não o texto oficial.",

  "wiki.eyebrow": "Universidade DenialDesk · Wiki",
  "wiki.metaTitle": "Universidade — Wiki",
  "wiki.title": "Wiki",
  "wiki.description":
    "Artigos de referência sobre como funcionam as negativas, as reivindicações, os recursos e as regras de pagamento da Flórida no DenialDesk. Os valores jurídicos são lidos do mecanismo de regras e nunca digitados manualmente.",
  "wiki.categoriesAria": "Categorias",
  "wiki.emptyCategoryTitle": "Ainda não há artigos",
  "wiki.emptyCategoryDescription": "Os artigos desta categoria ainda estão sendo escritos.",

  "wikiCategory.gettingStarted.label": "Primeiros passos",
  "wikiCategory.gettingStarted.description": "O que é o DenialDesk e como suas partes se encaixam.",
  "wikiCategory.denialsAndAppeals.label": "Negativas e recursos",
  "wikiCategory.denialsAndAppeals.description": "Como ler, trabalhar e recorrer de uma negativa.",
  "wikiCategory.claimsAndPayments.label": "Reivindicações e pagamentos",
  "wikiCategory.claimsAndPayments.description": "Reivindicações, remessas e lançamento.",
  "wikiCategory.floridaAndMedicareRules.label": "Regras da Flórida e do Medicare",
  "wikiCategory.floridaAndMedicareRules.description":
    "Os prazos legais que o DenialDesk controla, com valores lidos em tempo real do mecanismo de regras.",
  "wikiCategory.dataSafety.label": "Segurança dos dados",
  "wikiCategory.dataSafety.description": "Salvaguardas que todo usuário deve conhecer.",
  "wikiCategory.glossary.label": "Glossário",
  "wikiCategory.glossary.description": "Termos e nomes de arquivo.",

  "article.metaTitle": "Wiki — {title}",
  "article.onThisPage": "Nesta página",
  "article.rulesReferenced": "Regras referenciadas",
  "article.rulesReferencedDescription": "Lidas do mecanismo de regras na data de hoje.",
  "article.unconfirmedNote":
    "“Não confirmado” significa que a assessoria jurídica de saúde da Flórida ainda não confirmou o valor; o DenialDesk ainda assim o aplica.",
  "article.relatedArticles": "Artigos relacionados",
  "article.sources": "Fontes",
  "article.opensNewTab": "(abre em uma nova aba)",
  "article.lastReviewed": "Última revisão: {date}.",
  "article.notInForce": "valor não vigente hoje",
  "article.unconfirmedMarker": "; não confirmado",

  "search.label": "Pesquisar na wiki",
  "search.placeholder": "Título, termo ou código, por exemplo pagamento pontual",
  "search.searching": "Pesquisando…",
  "search.hint": "Somente termos do produto, nunca dados do paciente.",
  "search.resultsAria": "Resultados da pesquisa",
  "search.resultCount":
    "{count, plural, one {# artigo corresponde} other {# artigos correspondem}} a “{query}”",
  "search.emptyTitle": "Nenhum artigo corresponde",
  "search.emptyDescription":
    "Tente uma palavra mais curta ou um tipo de código como CARC, ou explore as categorias abaixo.",
  "search.roleDenied": "Sua função não pode ler a wiki.",
};
