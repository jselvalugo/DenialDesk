import type { Messages } from "../types";

export const claims: Messages["claims"] = {
  "nav.breadcrumb": "Ruta de navegación",
  "list.stat.sectionLabel": "Totales de reclamaciones sin enviar",

  // Lista de reclamaciones (app/(app)/claims/page.tsx)
  "list.title": "Reclamaciones",
  "list.description":
    "Primero las reclamaciones sin enviar, con las más cercanas a perder su plazo de envío arriba.",
  "list.stat.unsubmitted": "Sin enviar",
  "list.stat.unsubmittedDetail": "Borrador o rechazadas por el pagador",
  "list.stat.unsubmittedBilled": "Facturado sin enviar",
  "list.stat.dueSoon": "Plazo de envío en {days} días",
  "list.stat.dueSoonDetail": "Cierra la ventana de presentación oportuna",
  "list.stat.pastDeadline": "Plazo de envío vencido",
  "list.stat.pastDeadlineDetail": "Probablemente denegada por extemporánea",
  "list.stat.notConfiguredDetail": "{count} sin regla de envío configurada",
  "list.stat.payerUnverifiedDetail": "{count} con un pagador sin verificar",
  "list.filter.claims": "Reclamaciones",
  "list.filter.unsubmitted": "Sin enviar",
  "list.filter.inProcess": "Enviadas al pagador",
  "list.filter.allPayers": "Todos los pagadores",
  "list.filter.filingDeadline": "Plazo de envío",
  "list.filter.dueSoon": "Vence en {days} días",
  "list.truncated":
    "Más de {limit} reclamaciones sin enviar: la lista, los filtros y los totales cubren solo las {limit} más antiguas por fecha de servicio.",
  "list.empty.title.unsubmitted": "No hay reclamaciones sin enviar",
  "list.empty.title.unsubmittedFiltered": "Ninguna reclamación sin enviar coincide con estos filtros",
  "list.empty.title.inProcess": "No hay reclamaciones enviadas al pagador",
  "list.empty.title.inProcessFiltered": "Ninguna reclamación enviada al pagador coincide con estos filtros",
  "list.empty.title.all": "No hay reclamaciones",
  "list.empty.title.allFiltered": "Ninguna reclamación coincide con estos filtros",
  "list.empty.descriptionUnsubmitted":
    "Las reclamaciones en borrador y rechazadas aparecen aquí hasta que el pagador las acepte.",
  "list.empty.descriptionOther": "Las reclamaciones aparecen aquí una vez creadas o importadas.",
  "list.table.captionUnsubmitted": "Reclamaciones sin enviar",
  "list.table.captionInProcess": "Reclamaciones enviadas al pagador",
  "list.table.captionAll": "Todas las reclamaciones",
  "list.table.dateOfService": "Fecha de servicio",
  "list.table.filingDeadline": "Plazo de envío",
  "list.table.noDeadlinePayerUnverified": "Sin plazo — pagador no verificado",

  // Estado del plazo de envío (domain/claims/status.ts FILING_STATE_LABEL_KEYS)
  "filing.state.pastDeadline": "Plazo vencido",
  "filing.state.notConfigured": "No configurado",
  "filing.state.payerUnverified": "Pagador no verificado",

  // Detalle de la reclamación (app/(app)/claims/[id]/page.tsx)
  "detail.pageTitle": "Reclamación",
  "detail.filing.rolledNote":
    "(pendiente de asesoría legal: {date}; la extensión por fin de semana o feriado aún no está confirmada, así que presente antes de la fecha indicada arriba)",
  "detail.breadcrumbClaims": "Reclamaciones",
  "detail.subtitle": "fecha de servicio {date} · versión {version}",
  "detail.field.dateOfService": "Fecha de servicio",
  "detail.field.provider": "Proveedor",
  "detail.field.npi": "NPI {npi}",
  "detail.field.location": "Ubicación",
  "detail.field.payer": "Pagador",
  "detail.field.billed": "Facturado",
  "detail.field.paid": "Pagado",
  "detail.field.payerReceived": "Recibido por el pagador",
  "detail.field.diagnosis": "Diagnóstico",
  "detail.table.line": "Línea",
  "detail.table.procedure": "Procedimiento",
  "detail.table.modifiers": "Modificadores",
  "detail.table.units": "Unidades",
  "detail.table.charge": "Cargo",
  "detail.table.claimLinesCaption": "Líneas de la reclamación",
  "detail.readOnlyNote": "Su rol tiene acceso de solo lectura a las reclamaciones.",
  "detail.history.title": "Historial de versiones",
  "detail.history.listLabel": "Versiones de la reclamación",
  "detail.history.description":
    "Cada cambio de esta reclamación: quién, cuándo y por qué. El historial no se puede editar.",
  "detail.history.version": "Versión {version}",
  "detail.history.formerTeamMember": "Exmiembro del equipo",
  "detail.history.system": "Sistema",
  "detail.history.changedTo": "cambió a",
  "detail.filing.title": "Presentación oportuna",
  "detail.filing.receivedNoLongerApplies":
    "Recibido por el pagador el {date}. La presentación oportuna ya no aplica.",
  "detail.filing.acceptedNoLongerApplies": "Aceptado por el pagador. La presentación oportuna ya no aplica.",
  "detail.filing.awaitingReceipt": "Enviada; el plazo se cumple en cuanto el pagador confirme su recepción.",
  "detail.filing.pastDeadlineWarning":
    "El plazo de envío se ha cerrado. Es probable que el pagador deniegue esta reclamación por extemporánea, salvo que aplique una excepción.",
  "detail.filing.fromServiceDate": "Desde la fecha de servicio ({citation}).",
  "detail.filing.pendingVerification": "Pendiente de verificación legal",
  "detail.filing.payerUnverified":
    "Sin plazo — pagador no verificado. Una vez verificado el régimen regulatorio de este pagador, confirme el plazo de envío manualmente con el contrato del pagador o la ley aplicable; DenialDesk no puede calcularlo hasta entonces.",
  "detail.filing.notConfigured":
    "DenialDesk no tiene una regla de envío configurada para reclamaciones de {regime}. Confirme el plazo de envío con el contrato del pagador o la ley aplicable antes de que venza.",
  "detail.patient.title": "Paciente",
  "detail.patient.dob": "Fecha de nacimiento",
  "detail.patient.mrn": "Número de expediente (MRN)",
  "detail.patient.memberId": "ID de miembro",
  "detail.payments.title": "Pagos",
  "detail.payments.none": "Ninguna remesa ha pagado ni denegado aún esta reclamación.",
  "detail.payments.paidOn": "pagado el {date}",
  "detail.payments.promptPayLink": "Reloj de pago puntual",
  "detail.denials.title": "Denegaciones",
  "detail.denials.none": "Esta reclamación no tiene denegaciones.",
  "detail.denials.notice": "aviso {date}",
  "detail.editCustomFields": "Editar campos personalizados",

  // Página de edición de campos personalizados (app/(app)/claims/[id]/fields/page.tsx)
  "fields.pageTitle": "Campos personalizados",
  "fields.breadcrumb": "Campos personalizados",
  "fields.description":
    "Campos definidos por el consultorio en esta reclamación. No forman parte de la reclamación facturada y guardarlos nunca crea una nueva versión.",

  // Formulario de corrección (app/(app)/claims/[id]/CorrectionForm.tsx)
  "correction.button": "Corregir reclamación",
  "correction.savedAs": "Guardado como versión {version}.",
  "correction.form.dateOfService": "Fecha de servicio",
  "correction.form.diagnosisCodes": "Códigos de diagnóstico (ICD-10-CM, separados por comas)",
  "correction.form.linesCaption": "Líneas de la reclamación a corregir",
  "correction.form.lineProcedureAria": "Código de procedimiento de la línea {number}",
  "correction.form.lineModifiersAria": "Modificadores de la línea {number}",
  "correction.form.lineUnitsAria": "Unidades de la línea {number}",
  "correction.form.lineChargeAria": "Cargo de la línea {number}",
  "correction.form.chargeHeader": "Cargo ($)",
  "correction.form.reason": "Motivo de la corrección (obligatorio, se guarda en el historial)",
  "correction.form.reasonHint":
    "No incluya datos del paciente en el motivo. Los cambios de código deben estar respaldados por el expediente médico.",
  "correction.form.save": "Guardar nueva versión",
  "correction.form.saving": "Guardando…",

  // Etiquetas de campos modificados (domain/claims/correction.ts describeChange)
  "correction.field.serviceDate": "fecha de servicio",
  "correction.field.diagnosisCodes": "códigos de diagnóstico",
  "correction.field.procedureCode": "procedimiento",
  "correction.field.modifiers": "modificadores",
  "correction.field.units": "unidades",
  "correction.field.chargeCents": "cargo",
  "correction.field.status": "estado",
  "correction.field.paidCents": "pagado",
  "correction.field.line": "línea {number}",
  "correction.field.lineSub": "línea {number} {field}",

  // Validación del formulario de corrección (domain/claims/correction.ts correctionIssueMessage)
  "correction.error.line": "Línea {number}: {message}",
  "correction.error.serviceDate": "Ingrese una fecha de servicio válida.",
  "correction.error.diagnosisRequired": "Ingrese al menos un código de diagnóstico.",
  "correction.error.diagnosisMax": "Como máximo {max} códigos de diagnóstico.",
  "correction.error.diagnosisFormat":
    "Los códigos de diagnóstico deben tener formato ICD-10-CM (p. ej., E11.9).",
  "correction.error.procedureCode": "Los códigos de procedimiento tienen 5 letras o dígitos (CPT/HCPCS).",
  "correction.error.modifierFormat": "Los modificadores tienen 2 letras o dígitos.",
  "correction.error.modifierMax": "Como máximo {max} modificadores por línea.",
  "correction.error.unitsInvalid": "Las unidades deben ser un número entero.",
  "correction.error.unitsRange": "Las unidades deben estar entre 1 y 999.",
  "correction.error.chargeInvalid": "Ingrese los cargos en dólares y centavos.",
  "correction.error.chargeMin": "Los cargos deben ser de al menos $0.01.",
  "correction.error.chargeMax": "Los cargos deben ser menores de $100,000 por línea.",
  "correction.error.linesRequired": "Ingrese al menos una línea de reclamación.",
  "correction.error.reasonRequired": "Indique por qué se corrige la reclamación.",
  "correction.error.reasonMax": "Mantenga el motivo por debajo de {max} caracteres.",
  "correction.error.generic": "Revise los campos resaltados e inténtelo de nuevo.",

  // Errores de corrección de reclamaciones (domain/claims/versions.ts ClaimCorrectionError)
  "correction.error.claimNotFound": "Reclamación no encontrada.",
  "correction.error.notCorrectable": "Solo se pueden corregir reclamaciones en borrador o rechazadas.",
  "correction.error.staleVersion":
    "Esta reclamación cambió desde que la abrió. Recargue e inténtelo de nuevo.",
  "correction.error.futureServiceDate": "La fecha de servicio no puede ser futura.",
  "correction.error.linesChanged": "Las líneas se pueden corregir, pero no agregar ni quitar.",
  "correction.error.noChanges": "No hubo cambios.",

  // Errores de la acción del servidor (app/(app)/claims/[id]/actions.ts)
  "action.error.forbiddenCorrect": "Su rol puede ver las reclamaciones, pero no corregirlas.",
  "action.error.reload": "Recargue la página e inténtelo de nuevo.",
};
