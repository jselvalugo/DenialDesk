import type { Messages } from "../types";

export const insight: Messages["insight"] = {
  moduleName: "Análisis",
  "meta.listTitle": "Análisis — informes",

  "list.description":
    "Informes estándar sobre tendencias de denegaciones, recuperación y desempeño de los pagadores, calculados a partir de las reclamaciones y denegaciones de su propio consultorio.",
  "list.downloadAll": "Descargar todos los informes (Excel)",
  "list.open": "Abrir",

  "catalog.denialsByCategory.title": "Resumen de denegaciones por categoría y CARC",
  "catalog.denialsByCategory.purpose":
    "Dónde se concentran los dólares y el volumen de denegaciones, por causa raíz.",
  "catalog.denialsByPayer.title": "Resumen de denegaciones por pagador",
  "catalog.denialsByPayer.purpose":
    "Qué pagadores generan más dólares y volumen de denegaciones, y su categoría principal.",
  "catalog.denialRate.title": "Tasa de denegaciones",
  "catalog.denialRate.purpose":
    "La proporción de reclamaciones facturadas que recibieron al menos una denegación.",
  "catalog.denialsByDeadlineBucket.title": "Denegaciones abiertas por rango de vencimiento de apelación",
  "catalog.denialsByDeadlineBucket.purpose":
    "Un total en forma de informe de lo que la cola de denegaciones ya utiliza para ordenar.",
  "catalog.claimsByStatus.title": "Reclamaciones por estado / resumen de cuentas por cobrar",
  "catalog.claimsByStatus.purpose":
    "Cuánto está pendiente y en qué estado, directamente de la tabla de reclamaciones.",
  "catalog.appealOutcomes.title": "Resultados de apelación",
  "catalog.appealOutcomes.purpose": "Tasas de reversión frente a confirmación, por pagador y categoría.",
  "catalog.promptPayScorecard.title": "Panel de pago puntual",
  "catalog.promptPayScorecard.purpose":
    "Planificado; consulte la especificación (bloqueado por la corrección de clasificación de avisos, revisión de facturación F4).",
  "catalog.underpaymentVariance.title": "Variación por pago insuficiente",
  "catalog.underpaymentVariance.purpose":
    "Planificado; consulte la especificación (bloqueado por una tabla de payer_contracts / tarifario).",

  "report.noDataTitle": "Sin datos para este período",
  "report.noDataDescription": "Pruebe con un período más amplio o un pagador diferente.",
  "report.noRowsMatch": "Ninguna fila coincide con los filtros actuales.",
  "report.downloadExcel": "Descargar Excel",
  "report.exportRestrictedRoles":
    "La exportación de este informe está limitada a los roles de {admin}, {manager} y {compliance}.",

  "filters.from": "Desde",
  "filters.to": "Hasta",
  "filters.allPayers": "Todos los pagadores",
  "filters.selectedPayer": "Pagador seleccionado",
  "filters.payerNotApplicable": "El filtro de pagador no aplica: este informe es el desglose por pagador.",
  "filters.dateRange": "Intervalo de fechas: {from} a {to}",
  "filters.payerLine": "Pagador: {payer}",
  "filters.error.invalidStartDate": "Esa fecha de inicio no existe.",
  "filters.error.invalidEndDate": "Esa fecha de fin no existe.",
  "filters.error.endBeforeStart": "La fecha de fin debe ser igual o posterior a la fecha de inicio.",
  "filters.error.rangeTooLong": "El intervalo de fechas no puede superar los 3 años.",

  "error.forbidden": "Prohibido",
  "error.notFound": "No encontrado",

  "suppression.label": "Suprimido (<{threshold})",

  "columns.carc": "CARC",
  "columns.count": "Cantidad",
  "columns.deniedAmount": "Denegado ($)",
  "columns.averageDeniedAmount": "Denegado promedio ($)",
  "columns.verified": "Verificado",
  "columns.topCategory": "Categoría principal",
  "columns.claimsSubmittedInRange": "Reclamaciones presentadas en el período",
  "columns.claimsWithDenial": "Reclamaciones con una denegación (por fecha de aviso)",
  "columns.denialRate": "Tasa de denegaciones",
  "columns.deadlineBucket": "Rango de vencimiento",
  "columns.billedAmount": "Facturado ($)",
  "columns.paidAmount": "Pagado ($)",
  "columns.outstandingAmount": "Pendiente ($)",
  "columns.group": "Grupo",
  "columns.overturned": "Revertidas",
  "columns.upheld": "Confirmadas",
  "columns.overturnRate": "Tasa de reversión",
  "columns.deniedAmountReversed": "Monto denegado revertido ($)",

  "value.verified": "Verificado",
  "value.unverified": "No verificado",

  "sheet.denialsByCategory": "Denegaciones por categoría",
  "sheet.denialsByPayer": "Denegaciones por pagador",
  "sheet.denialRate": "Tasa de denegaciones",
  "sheet.denialsByDeadlineBucket": "Denegaciones abiertas (plazo)",
  "sheet.claimsByStatus": "Reclamaciones por estado",
  "sheet.appealOutcomesByPayer": "Resultados por pagador",
  "sheet.appealOutcomesByCategory": "Resultados por categoría",

  "bucket.pastDeadline": "Plazo vencido",
  "bucket.0to7": "0–7 días",
  "bucket.8to30": "8–30 días",
  "bucket.31plus": "31+ días",
  "bucket.noDeadline": "Sin plazo configurado",

  "empty.noClaimsSubmitted": "No se presentaron reclamaciones en este período",
  "empty.noDecidedAppeals": "No hay apelaciones resueltas en este período",

  "definitions.category":
    "La clasificación de la cola de trabajo de DenialDesk para el CARC de la denegación (REQUIREMENTS §8.3).",
  "definitions.deniedAmount": "Suma del monto denegado (denials.deniedCents) del grupo.",
  "definitions.averageDeniedAmount": "Denegado ($) dividido por la cantidad, para el grupo.",
  "definitions.verified": "Si el pagador tiene un ID de pagador EDI confirmado y un régimen regulatorio.",
  "definitions.topCategory":
    "La categoría con la mayor suma de dólares denegados para ese pagador; los empates se resuelven por el orden del enum de categorías.",
  "definitions.claimsSubmittedInRange":
    "Reclamaciones con un estado distinto de borrador, cuya fecha de presentación (o fecha de servicio, si aún no se presentó) cae dentro del período seleccionado.",
  "definitions.denialRate":
    "Reclamaciones distintas con al menos una denegación en el período, divididas por reclamaciones distintas presentadas en el período.",
  "definitions.deadlineBucket":
    "Días restantes hasta la fecha límite de apelación, calculados de la misma forma que en la cola de denegaciones (rules/deadlines.ts); nunca recalculados.",
  "definitions.noDeadlineConfigured":
    "El pagador no está verificado o no tiene una ventana de apelación configurada; nunca se estima.",
  "definitions.outstandingAmount": "Facturado ($) menos pagado ($) para el grupo.",
  "definitions.overturnRate":
    "Revertidas dividido por (revertidas + confirmadas) para el grupo; en blanco cuando no hay apelaciones resueltas en el período.",
  "definitions.deniedAmountReversed":
    "Suma de dólares denegados solo en las filas revertidas: un límite superior, no un pago registrado (aún no existe la tabla de remesas).",

  "caveats.unknownCarc":
    "Un código CARC fuera de la lista de referencia (src/domain/carc.ts) se muestra con su código sin procesar y sin descripción.",
  "caveats.payerFilterNotApplicable":
    "El filtro de pagador no aplica a este informe: este es el desglose por pagador.",
  "caveats.denialRateFallback":
    "El seguimiento de la fecha de presentación (C3 837P) aún no está implementado; se usa la fecha de servicio cuando submittedAt es nulo.",
  "caveats.noDeadlineConfiguredExplain":
    '"Sin plazo configurado" incluye pagadores no verificados y pagadores sin una ventana de apelación configurada.',
  "caveats.paidAmountsPartial":
    "Los montos pagados solo se registran cuando se capturan: la contabilización de remesas 835 aún no está implementada.",
  "caveats.latestOutcomeOnly":
    "Refleja únicamente el estado actual de la denegación; aún no existe una tabla de historial de apelaciones, por lo que una denegación que cambió de estado se muestra según su resultado más reciente.",
  "caveats.smallCellSuppression":
    'Supresión de celdas pequeñas (R-8.7): una fila que incluye una reclamación de un paciente con una etiqueta de sensibilidad (R-3.5.1) y cuya cantidad está por debajo del umbral de supresión muestra "Suprimido (<{threshold})" en lugar de su cantidad y sus montos/tasas en dólares, para evitar identificar a ese paciente. Cuando exactamente una fila de la hoja quedaría suprimida, también se suprime la siguiente fila más pequeña con una cantidad distinta de cero, para que el valor oculto no pueda inferirse a partir de las demás. Siempre que se suprime alguna fila de una hoja, la fila de totales de esa hoja también se suprime, ya que de lo contrario el total menos las filas visibles reconstruiría exactamente el valor oculto. Riesgo residual aceptado (⚠️ VERIFICAR con asesoría legal): esta supresión es por informe y por período; comparar dos períodos superpuestos del mismo informe, o dos informes distintos que cubran las mismas reclamaciones, aún podría permitir que un lector decidido deduzca por diferencia una celda suprimida; en esta versión no existe una protección contra la diferenciación entre informes o entre períodos. ⚠️ VERIFICAR: el umbral ({threshold}) sigue la convención de supresión por tamaño de celda de los archivos de uso público de CMS como referencia de política, no un estatuto de Florida; confirmar con asesoría legal.',
  "caveats.denialRateResidualRisk":
    "Este informe es una única tasa a nivel de todo el consultorio para el período completo, no un desglose fila por fila, por lo que la supresión de celdas pequeñas (R-8.7) no se aplica de la misma manera. Riesgo residual aceptado (⚠️ VERIFICAR con asesoría legal): la cantidad de reclamaciones denegadas es un total a nivel de todo el consultorio, no se suprime aunque sea pequeña, y un período o filtro de pagador suficientemente acotado aún podría identificar la reclamación de un único paciente con etiqueta de sensibilidad.",

  "about.sheetName": "Acerca de",
  "about.practice": "Consultorio",
  "about.generatedAt": "Generado el",
  "about.generatedBy": "Generado por (ID de usuario)",
  "about.filtersApplied": "Filtros aplicados",
  "about.definitionsHeading": "Definiciones",
  "about.caveatsHeading": "Advertencias sobre los datos",
  "about.confidentiality":
    "Contiene datos confidenciales del consultorio; manéjelos según la política de su consultorio.",
  "about.allReportsName": "Todos los informes de Análisis",
  "about.combinedPayerFilterCaveat":
    "El filtro de pagador se aplicó en los informes que lo admiten; el informe de denegaciones por pagador siempre muestra todos los pagadores.",
};
