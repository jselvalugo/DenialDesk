import type { Messages } from "../types";

export const university: Messages["university"] = {
  eyebrow: "Universidad DenialDesk",
  "nav.breadcrumb": "Ruta de navegación",
  "nav.lesson": "Navegación de la lección",
  "breadcrumb.university": "Universidad",

  // Catálogo de cursos (/university)
  "catalog.title": "Cursos",
  "catalog.description":
    "Cursos breves sobre el funcionamiento de DenialDesk, cómo leer una denegación, los plazos de Florida que aplica el producto y cómo se protegen los datos del paciente. Sus lecciones completadas se conservan en su cuenta.",
  "catalog.openWiki": "Abrir la Wiki",
  "catalog.lessonsCompleted": "{done} de {total} lecciones completadas",
  "catalog.audience": "Para: {audience}",
  "catalog.lessonsLabel": "Lecciones",
  "catalog.readingLabel": "Lectura",
  "catalog.readingMinutes": "{count} min",
  "catalog.progressLabel": "Progreso",
  "catalog.openCourse": "Abrir curso",
  "catalog.openCourseAria": "Abrir curso: {title}",
  "catalog.disclaimer":
    "Los cursos describen el comportamiento de DenialDesk y no constituyen asesoría legal ni de cumplimiento. Los plazos que se muestran en una lección se leen de las mismas reglas versionadas que usa el producto, con sus citas.",

  "progress.complete": "Completado",
  "progress.notStarted": "No iniciado",
  "progress.ofLessons": "{completed} de {total} lecciones",

  "course.startCourse": "Comenzar curso",
  "course.continueCourse": "Continuar curso",
  "course.complete": "Curso completado",
  "course.lessonsDescription": "Para: {audience} · {minutes} min de lectura · {progress}",
  "course.completedOn": "Completado el {date}",
  "course.openLesson": "Abrir",
  "course.openLessonAria": "Abrir lección: {title}",

  "lesson.eyebrow": "{course} · Lección {position} de {total}",
  "lesson.progressTitle": "Su progreso",
  "lesson.progressDescription":
    "Las lecciones completadas se conservan en su cuenta y no se pueden deshacer.",
  "lesson.previous": "Anterior: {title}",
  "lesson.next": "Siguiente: {title}",
  "lesson.backToCourse": "Volver al curso",

  "complete.completed": "Lección completada el {date}",
  "complete.action": "Marcar lección como completada",
  "complete.lessonGone": "Esta lección ya no existe.",

  "lessonBody.inDenialDesk": "En DenialDesk",
  "lessonBody.rule": "Regla",
  "lessonBody.appliesTo": "Aplica a",
  "lessonBody.countedFrom": "Se cuenta desde",
  "lessonBody.value": "Valor",
  "lessonBody.source": "Fuente",
  "lessonBody.noVersion": "Hoy no hay ninguna versión vigente de esta regla.",
  "lessonBody.referenceOnly": "Solo de referencia",
  "lessonBody.confirmedByCounsel": "Confirmado por asesoría legal el {date}",
  "lessonBody.pendingCounselVerification": "Pendiente de verificación por asesoría legal",
  "lessonBody.code": "Código",
  "lessonBody.summary": "Resumen",
  "lessonBody.category": "Categoría de DenialDesk",
  "lessonBody.carcFootnote":
    "Resúmenes, no el texto oficial de X12; las categorías son la clasificación propia de DenialDesk.",
  "lessonBody.groupCode": "Código de grupo",
  "lessonBody.groupCodeFootnote": "Resúmenes de los códigos de grupo X12 835, no el texto oficial.",

  "wiki.eyebrow": "Universidad DenialDesk · Wiki",
  "wiki.metaTitle": "Universidad — Wiki",
  "wiki.title": "Wiki",
  "wiki.description":
    "Artículos de referencia sobre cómo funcionan las denegaciones, las reclamaciones, las apelaciones y las reglas de pago de Florida en DenialDesk. Los valores legales se leen del motor de reglas y nunca se escriben manualmente.",
  "wiki.categoriesAria": "Categorías",
  "wiki.emptyCategoryTitle": "Todavía no hay artículos",
  "wiki.emptyCategoryDescription": "Los artículos de esta categoría todavía se están redactando.",

  "wikiCategory.gettingStarted.label": "Primeros pasos",
  "wikiCategory.gettingStarted.description": "Qué es DenialDesk y cómo encajan sus partes.",
  "wikiCategory.denialsAndAppeals.label": "Denegaciones y apelaciones",
  "wikiCategory.denialsAndAppeals.description": "Cómo leer, trabajar y apelar una denegación.",
  "wikiCategory.claimsAndPayments.label": "Reclamaciones y pagos",
  "wikiCategory.claimsAndPayments.description": "Reclamaciones, remesas y contabilización.",
  "wikiCategory.floridaAndMedicareRules.label": "Reglas de Florida y Medicare",
  "wikiCategory.floridaAndMedicareRules.description":
    "Los plazos legales que DenialDesk controla, con valores leídos en tiempo real del motor de reglas.",
  "wikiCategory.dataSafety.label": "Seguridad de los datos",
  "wikiCategory.dataSafety.description": "Salvaguardas que todo usuario debe conocer.",
  "wikiCategory.glossary.label": "Glosario",
  "wikiCategory.glossary.description": "Términos y nombres de archivo.",

  "article.metaTitle": "Wiki — {title}",
  "article.onThisPage": "En esta página",
  "article.rulesReferenced": "Reglas referenciadas",
  "article.rulesReferencedDescription": "Leídas del motor de reglas a la fecha de hoy.",
  "article.unconfirmedNote":
    "“Sin confirmar” significa que la asesoría legal de salud de Florida todavía no ha confirmado el valor; DenialDesk igualmente lo aplica.",
  "article.relatedArticles": "Artículos relacionados",
  "article.sources": "Fuentes",
  "article.opensNewTab": "(se abre en una pestaña nueva)",
  "article.lastReviewed": "Última revisión: {date}.",
  "article.notInForce": "valor no vigente hoy",
  "article.unconfirmedMarker": "; sin confirmar",

  "search.label": "Buscar en la wiki",
  "search.placeholder": "Título, término o código, por ejemplo pago puntual",
  "search.searching": "Buscando…",
  "search.hint": "Solo términos del producto, nunca datos del paciente.",
  "search.resultsAria": "Resultados de la búsqueda",
  "search.resultCount":
    "{count, plural, one {# artículo coincide} other {# artículos coinciden}} con “{query}”",
  "search.emptyTitle": "Ningún artículo coincide",
  "search.emptyDescription":
    "Pruebe con una palabra más corta o un tipo de código como CARC, o explore las categorías a continuación.",
  "search.roleDenied": "Su rol no puede leer la wiki.",

  // AccessPrompt.tsx (la oferta que se muestra en cada visita al catálogo)
  "access.title": "Obtenga acceso a la Universidad DenialDesk",
  "access.body":
    "Un programa de capacitación a su ritmo para el personal del consultorio: cómo funciona DenialDesk, cómo leer una denegación, los plazos de pago puntual y apelación de Florida que el producto aplica, y cómo se protegen los datos de los pacientes, además de la Wiki de referencia.",
  "access.coursesLabel": "Cursos",
  "access.lengthLabel": "Duración",
  "access.lengthMinutes": "unos {count, plural, one {# minuto} other {# minutos}}",
  "access.wikiLabel": "Artículos de la Wiki",
  "access.price": "Acceso desde {price}",
  "access.unlocks":
    "Cuando su consultorio tenga acceso, los cursos se desbloquean para todo su equipo. La Wiki sigue abierta para todos.",
  "access.request": "Solicitar acceso",
  "access.requested":
    "Solicitud registrada para su consultorio. Los cursos se desbloquean cuando DenialDesk confirme el acceso.",
  "access.requestedOn":
    "Acceso solicitado el {date}. Los cursos se desbloquean cuando DenialDesk confirme el acceso.",
  "access.failed": "No se pudo registrar la solicitud. Inténtelo de nuevo.",
  "access.locked":
    "Los cursos están bloqueados hasta que su consultorio tenga acceso a la Universidad DenialDesk.",
  "access.lockedBadge": "Bloqueado",
  "access.lockedDescription": "Bloqueado hasta que su consultorio tenga acceso a la Universidad DenialDesk.",
  "access.continue": "Ver el catálogo",
};
