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
  "detail.eyebrow": "Registro de reclamación",
  "detail.details.title": "Detalles de la reclamación",
  "detail.lines.title": "Líneas de la reclamación",
  "detail.filing.rolledNote":
    "(pendiente de asesoría legal: {date}; la extensión por fin de semana o feriado aún no está confirmada, así que presente antes de la fecha indicada arriba)",
  "detail.breadcrumbClaims": "Reclamaciones",
  "detail.field.dateOfService": "Fecha de servicio",
  "detail.field.version": "Versión",
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
  "detail.filing.awaitingReceipt":
    "Enviada; la reclamación es oportuna si se presentó a más tardar en la fecha límite, según el acuse de recibo de la cámara de compensación.",
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
  "detail.patient.memberIdNone": "Ninguno en archivo",
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

  // Importación de cargos (app/(app)/claims/import, docs/specs/claims.md C2)
  "detail.history.createdByImport": "Creada por la importación de cargos",
  "import.button": "Importar cargos",
  "import.title": "Importar cargos",
  "import.description":
    "Suba un CSV de cargos y DenialDesk crea reclamaciones en borrador. Si alguna fila necesita corrección, no se importa nada.",
  "import.breadcrumbClaims": "Reclamaciones",
  "import.forbidden": "Su rol puede ver las reclamaciones, pero no importar cargos.",
  "import.backToClaims": "Volver a las reclamaciones",
  "import.file.title": "Archivo de cargos",
  "import.file.description":
    "Un CSV de hasta {size} MB y {rows} filas. Se lee una sola vez y nunca se guarda.",
  "import.file.label": "Archivo CSV",
  "import.file.hint": "Una fila por línea de reclamación, con las columnas que se indican abajo.",
  "import.defaults.title": "Proveedor y ubicación",
  "import.defaults.description":
    "Se usan para las reclamaciones cuyas filas no tienen NPI del proveedor ni ubicación. Una fila que indica su propio proveedor o ubicación la conserva.",
  "import.defaults.provider": "Proveedor predeterminado",
  "import.defaults.location": "Ubicación predeterminada",
  "import.defaults.choose": "Elegir",
  "import.synthetic.title": "Confirmación",
  "import.synthetic.description": "Este entorno solo acepta datos sintéticos.",
  "import.synthetic.attestation":
    "Confirmo que este archivo contiene solo datos sintéticos. Los números de reclamación empiezan con SYN- y los MRN con SYN.",
  "import.submit": "Importar cargos",
  "import.submitting": "Importando…",
  "import.auditNote":
    "Cada importación y cada reclamación que crea queda registrada en el registro de auditoría.",
  "import.format.title": "Formato del archivo",
  "import.format.description":
    "Las filas con el mismo número de reclamación son las líneas de una sola reclamación; las columnas de la reclamación se repiten en cada línea y deben coincidir. Los códigos se guardan tal como están escritos: la importación nunca cambia, agrega ni corrige un código.",
  "import.format.column": "Columna",
  "import.format.rule": "Qué va en ella",
  "import.format.required": "Obligatoria",
  "import.format.optional": "Opcional",
  "import.format.template": "Descargar la plantilla (solo la fila de encabezado)",
  "import.format.tableCaption": "Columnas del archivo de cargos",
  "import.column.claimNumber":
    "El número de reclamación o de cargo propio de su práctica: hasta 30 letras, dígitos, puntos, guiones o guiones bajos. Nunca un ID de miembro.",
  "import.column.mrn":
    "Número de historia clínica de un paciente que ya está en DenialDesk. La importación nunca crea ni modifica pacientes.",
  "import.column.payer": "Nombre del pagador tal como aparece en la lista de pagadores de esta práctica.",
  "import.column.serviceDate": "AAAA-MM-DD o M/D/AAAA, no en el futuro.",
  "import.column.diagnosisCodes": "De 1 a 12 códigos ICD-10-CM separados por espacios o comas.",
  "import.column.procedureCode": "Código CPT o HCPCS: cinco letras o dígitos.",
  "import.column.modifiers": "Hasta cuatro modificadores de dos caracteres.",
  "import.column.units": "Número entero de 1 a 999.",
  "import.column.charge": "Cargo total de la línea en dólares, de $0.01 a $99,999.99.",
  "import.column.providerNpi":
    "NPI de diez dígitos de un proveedor de esta práctica. En blanco usa el proveedor predeterminado.",
  "import.column.location":
    "Nombre de la ubicación tal como aparece en esta práctica. En blanco usa la ubicación predeterminada.",

  // Verificaciones de la carga y fallos (devueltos por la acción de importación)
  "import.error.chooseFile": "Elija un archivo CSV para importar.",
  "import.error.notCsv": "El archivo debe ser un archivo .csv.",
  "import.error.tooLarge": "El archivo supera los {size} MB.",
  "import.error.confirmSynthetic": "Confirme que el archivo contiene solo datos sintéticos.",
  "import.error.notUtf8": "El archivo no es texto UTF-8. Guárdelo como CSV (UTF-8) e inténtelo de nuevo.",
  "import.error.forbidden": "Su rol puede ver las reclamaciones, pero no importar cargos.",
  "import.error.defaults": "Elija un proveedor y una ubicación predeterminados de esta práctica.",
  "import.error.notImported": "No se importó nada. Corrija las filas de abajo y suba el archivo de nuevo.",
  "import.error.conflict":
    "Se creó una reclamación con uno de estos números mientras se leía el archivo. No se importó nada; inténtelo de nuevo.",

  // Informe de problemas
  "import.problems.aria": "Filas por corregir",
  "import.problems.row": "Fila {row}: {message}",
  "import.problems.showing": "Se muestran los primeros {shown} de {total} problemas.",
  "import.problems.download": "Descargar informe (CSV)",
  "import.problems.truncated":
    "El informe enumera los primeros {limit} problemas; {more} más no se enumeraron.",

  // Problemas (domain/claims/charge-file.ts PROBLEM_MESSAGE_KEYS); nunca citan el valor de una celda
  "import.problem.noDataRows": "El archivo tiene encabezado, pero no filas de cargos.",
  "import.problem.missingColumns": "Al encabezado le faltan columnas obligatorias: {columns}.",
  "import.problem.ambiguousColumns": "Más de una columna coincide con: {columns}. Deje solo una.",
  "import.problem.csvTooManyColumns": "Una fila tiene más de {max} columnas.",
  "import.problem.csvTooManyRows": "El archivo tiene más de {max} filas.",
  "import.problem.csvTextAfterQuote": "Hay texto después de unas comillas de cierre.",
  "import.problem.csvQuoteInField": "Hay unas comillas dentro de un campo sin comillas.",
  "import.problem.csvUnclosedQuote": "Un campo entre comillas nunca se cierra.",
  "import.problem.alreadyImported":
    "Todos los números de reclamación de este archivo ya existen, así que este archivo parece haberse importado antes.",
  "import.problem.tooLong": "{column} tiene más de {max} caracteres.",
  "import.problem.claimNumberBlank": "El número de reclamación está en blanco.",
  "import.problem.claimNumberFormat":
    "El número de reclamación debe tener de 1 a 30 letras, dígitos, puntos, guiones o guiones bajos.",
  "import.problem.claimNumberNotSynthetic":
    "En este entorno (solo datos sintéticos) el número de reclamación debe empezar con {prefix}.",
  "import.problem.mrnBlank": "El MRN está en blanco.",
  "import.problem.mrnNotSynthetic":
    "En este entorno (solo datos sintéticos) el MRN debe empezar con {prefix}.",
  "import.problem.payerBlank": "El pagador está en blanco.",
  "import.problem.serviceDateInvalid":
    "La fecha de servicio no es una fecha real. Use AAAA-MM-DD o M/D/AAAA.",
  "import.problem.serviceDateTooOld": "La fecha de servicio es anterior al 2000-01-01.",
  "import.problem.serviceDateFuture": "La fecha de servicio está en el futuro.",
  "import.problem.diagnosisBlank": "Los códigos de diagnóstico están en blanco.",
  "import.problem.diagnosisFormat":
    "Un código de diagnóstico no tiene formato ICD-10-CM (por ejemplo, E11.9). La importación nunca cambia los códigos.",
  "import.problem.diagnosisTooMany": "Más de {max} códigos de diagnóstico.",
  "import.problem.procedureCodeFormat":
    "El código de procedimiento debe tener cinco letras o dígitos (CPT/HCPCS). La importación nunca cambia los códigos.",
  "import.problem.modifierFormat": "Un modificador debe tener dos letras o dígitos.",
  "import.problem.modifierTooMany": "Más de {max} modificadores.",
  "import.problem.unitsInvalid": "Las unidades deben ser un número entero de 1 a 999.",
  "import.problem.chargeInvalid": "El cargo no es un importe en dólares válido.",
  "import.problem.chargeRange": "El cargo debe ser de $0.01 a $99,999.99 por línea.",
  "import.problem.providerNpiFormat": "El NPI del proveedor debe tener 10 dígitos.",
  "import.problem.claimFieldsDiffer":
    "{column} difiere de la primera línea de esta reclamación. Las columnas de la reclamación deben coincidir en todas las líneas.",
  "import.problem.tooManyLines": "Una reclamación puede tener como máximo {max} líneas.",
  "import.problem.patientNotFound":
    "Ningún paciente de esta práctica tiene este MRN. La importación nunca crea pacientes.",
  "import.problem.payerNotFound": "Ningún pagador de la lista de esta práctica tiene este nombre.",
  "import.problem.payerAmbiguous": "Dos pagadores tienen este nombre y no se pueden distinguir.",
  "import.problem.providerNotFound": "Ningún proveedor de esta práctica tiene este NPI.",
  "import.problem.locationNotFound": "Ninguna ubicación de esta práctica tiene este nombre.",
  "import.problem.locationAmbiguous": "Más de una ubicación tiene este nombre.",
  "import.problem.claimNumberExists":
    "Ya existe una reclamación con este número. Corrija las reclamaciones existentes desde la página de la reclamación.",
  "import.problem.matchesExistingClaim":
    "Una reclamación existente tiene el mismo paciente, pagador, fecha de servicio y un código de procedimiento con los mismos modificadores. Posible duplicado.",
  "import.problem.matchesClaimInFile":
    "Otra reclamación de este archivo tiene el mismo paciente, pagador, fecha de servicio y un código de procedimiento con los mismos modificadores. Posible duplicado.",

  "import.problem.duplicateLine":
    "Esta línea repite una línea anterior de la misma reclamación (mismo código de procedimiento y modificadores). Si el archivo se pegó dos veces, elimine la copia.",
  "import.problem.claimRowsNotContiguous":
    "Las líneas de una reclamación deben estar juntas, pero este número de reclamación aparece de nuevo después de otras reclamaciones.",
  "import.error.rateLimited":
    "Demasiadas importaciones en poco tiempo para esta práctica. Espere unos minutos e inténtelo de nuevo.",
  "import.file.claimNumberNotice":
    "El número de reclamación se guarda sin cifrado a nivel de campo. Nunca escriba en él un ID de miembro, un número de Seguro Social ni ningún otro identificador.",

  // Resultado
  "import.result.title": "Importación completa",
  "import.result.summary":
    "{claims, plural, one {Se creó # reclamación en borrador} other {Se crearon # reclamaciones en borrador}} a partir de {lines, plural, one {# línea} other {# líneas}}, {billed} facturados.",
  "import.result.warningsTitle": "Conviene revisar",
  "import.result.noWarnings": "Sin advertencias.",
  "import.result.pastDeadline":
    "{count, plural, one {# reclamación superó su plazo de presentación} other {# reclamaciones superaron su plazo de presentación}}.",
  "import.result.dueSoon":
    "{count, plural, one {# reclamación vence en {days} días o menos} other {# reclamaciones vencen en {days} días o menos}}.",
  "import.result.notConfigured":
    "{count, plural, one {# reclamación no tiene regla de presentación configurada para su pagador} other {# reclamaciones no tienen regla de presentación configurada para su pagador}}.",
  "import.result.payerUnverified":
    "{count, plural, one {# reclamación es de un pagador sin verificar, por lo que aún no se puede enviar} other {# reclamaciones son de pagadores sin verificar, por lo que aún no se pueden enviar}}.",
  "import.result.noCoverage":
    "{count, plural, one {# reclamación es de un paciente sin cobertura registrada} other {# reclamaciones son de pacientes sin cobertura registrada}}.",
  "import.result.patientInactive":
    "{count, plural, one {# reclamación es de un paciente marcado como inactivo o combinado en el registro de origen} other {# reclamaciones son de pacientes marcados como inactivos o combinados en el registro de origen}}.",
  "import.result.viewClaims": "Ver reclamaciones sin enviar",
  "import.result.viewPastDeadline": "Ver reclamaciones fuera de plazo",
  "import.result.another": "Importar otro archivo",

  // 837P generation (claims C3a): app/(app)/claims/[id]/Claim837Form.tsx
  "edi.title": "Reclamación electrónica (837P)",
  "edi.description":
    "Genera esta reclamación como un archivo X12 837P que puede ver y descargar. No se envía nada a un pagador ni a una cámara de compensación.",
  "edi.testNotice":
    "Solo archivo de prueba. Este entorno solo contiene datos sintéticos, así que el archivo se marca como prueba y usa identificadores de remitente y receptor de marcador de posición.",
  "edi.pointers.title": "Punteros de diagnóstico",
  "edi.pointers.description":
    "Esta reclamación tiene más de un diagnóstico. Para cada línea, elija los diagnósticos que la respaldan, hasta cuatro. No se elige nada por usted.",
  "edi.pointers.line": "Línea {line}: {code}",
  "edi.pointers.option": "{position}. {code}",
  "edi.generate": "Generar 837P",
  "edi.generating": "Generando…",
  "edi.result.summary":
    "Archivo {controlNumber} generado: {segments} segmentos, {lines, plural, one {# línea de servicio} other {# líneas de servicio}}.",
  "edi.result.testFile": "Archivo de prueba (ISA15 = T). No se envía a ningún lugar.",
  "edi.result.previewLabel": "Vista previa del 837P con el ID de miembro y el ID fiscal enmascarados",
  "edi.result.masked":
    "El ID de miembro y el ID fiscal están enmascarados aquí. El archivo descargado los contiene completos.",
  "edi.result.download": "Descargar archivo",
  "edi.result.pastDeadline":
    "Esta reclamación está fuera de su plazo de presentación. Revise el panel de plazos antes de enviar este archivo a cualquier parte.",
  "edi.error.forbidden": "Su rol puede ver las reclamaciones, pero no generar archivos de reclamación.",
  "edi.error.rateLimited":
    "Se generaron demasiados archivos en poco tiempo. Espere unos minutos e inténtelo de nuevo.",
  "edi.error.notFound": "No se encontró esta reclamación.",
  "edi.error.reload": "Recargue la página e inténtelo de nuevo.",
  "edi.error.notGenerated": "No se generó el 837P. Corrija los puntos siguientes e inténtelo de nuevo.",
  "edi.issue.status_not_generatable": "Solo se pueden generar reclamaciones en borrador o rechazadas.",
  "edi.issue.not_synthetic_environment":
    "Todavía no se pueden generar archivos de reclamación en producción: los identificadores de remitente y receptor para el envío real no están configurados.",
  "edi.issue.no_member_id":
    "No hay cobertura de pagador registrada para este paciente. Agregue o asigne primero el ID de miembro.",
  "edi.issue.coverage_payer_mismatch":
    "El pagador de esta reclamación no es el pagador principal del paciente, al que pertenece el ID de miembro registrado.",
  "edi.issue.payer_not_verified": "El pagador aún no tiene un ID de pagador EDI ni un régimen verificados.",
  "edi.issue.claim_filing_indicator_unmapped":
    "El indicador de presentación de reclamaciones para este tipo de pagador aún no está confirmado, así que no se puede generar un archivo.",
  "edi.issue.billing_npi": "Falta el NPI del proveedor o no es un NPI válido.",
  "edi.issue.billing_name": "Faltan el nombre y el apellido del proveedor para la facturación.",
  "edi.issue.billing_taxonomy": "Falta el código de taxonomía del proveedor o no tiene el formato correcto.",
  "edi.issue.billing_tin":
    "Falta el ID fiscal del proveedor o su tipo, o el ID fiscal no tiene nueve dígitos.",
  "edi.issue.billing_address":
    "La dirección de facturación del proveedor está incompleta: necesita calle, ciudad, estado y código postal de nueve dígitos.",
  "edi.issue.billing_address_po_box":
    "La dirección de facturación debe ser una dirección física, no un apartado postal.",
  "edi.issue.subscriber_name": "Faltan el nombre y el apellido del paciente.",
  "edi.issue.subscriber_birth_date": "Falta la fecha de nacimiento del paciente o no es una fecha real.",
  "edi.issue.subscriber_address":
    "La dirección del paciente está incompleta: necesita calle, ciudad, estado y código postal.",
  "edi.issue.missing_place_of_service":
    "La ubicación de la reclamación no tiene código de lugar de servicio.",
  "edi.issue.diagnosis_invalid":
    "La reclamación necesita de uno a doce códigos de diagnóstico en formato ICD-10-CM.",
  "edi.issue.diagnosis_pointers_required": "Línea {line}: elija qué diagnósticos respaldan esta línea.",
  "edi.issue.diagnosis_pointer_invalid":
    "Línea {line}: elija de uno a cuatro diagnósticos distintos de esta reclamación.",
  "edi.issue.lines_missing": "La reclamación no tiene líneas de servicio.",
  "edi.issue.lines_too_many": "La reclamación tiene más de {max} líneas de servicio.",
  "edi.issue.line_invalid":
    "Línea {line}: el código de procedimiento, los modificadores, las unidades o el cargo no tienen el formato esperado.",
  "edi.issue.line_invalid_general": "Las líneas de servicio tienen un número de línea repetido.",
  "edi.issue.billed_mismatch": "El importe facturado no es la suma de los cargos de las líneas.",
  "edi.issue.claim_number_invalid":
    "El número de reclamación no se puede usar como número de control del paciente.",
  "edi.issue.service_date_invalid": "La fecha de servicio no es una fecha real.",
  "edi.issue.invalid_character":
    "{field}: tiene un carácter, o una longitud, que un 837P no puede transportar.",
  "edi.issue.control_number_exhausted":
    "Se agotaron los números de control de la práctica. Comuníquese con soporte.",
  "edi.field.billing_last_name": "Apellido del proveedor",
  "edi.field.billing_first_name": "Nombre del proveedor",
  "edi.field.billing_address": "Dirección del proveedor",
  "edi.field.billing_city": "Ciudad del proveedor",
  "edi.field.subscriber_last_name": "Apellido del paciente",
  "edi.field.subscriber_first_name": "Nombre del paciente",
  "edi.field.subscriber_address": "Dirección del paciente",
  "edi.field.subscriber_city": "Ciudad del paciente",
  "edi.field.subscriber_member_id": "ID de miembro",
  "edi.field.payer_name": "Nombre del pagador",
  "edi.result.title": "Archivo generado",
  "edi.field.envelope_id": "ID de remitente o receptor",
};
