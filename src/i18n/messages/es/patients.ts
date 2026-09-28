import type { Messages } from "../types";

export const patients: Messages["patients"] = {
  // Lista de pacientes
  "list.title": "Pacientes",
  "list.description":
    "Toda reclamación y denegación pertenece a un paciente. Abra un paciente para ver su cobertura, reclamaciones y denegaciones en un solo lugar.",
  "list.register": "Registrar paciente",
  "list.emptyTitle": "Todavía no hay pacientes",
  "list.emptyDescriptionCanEdit":
    "Registre un paciente para iniciar su expediente. Las reclamaciones y denegaciones se vinculan a él.",
  "list.emptyDescriptionReadOnly": "Los pacientes aparecerán aquí cuando su equipo los registre.",

  "notice.syncedFromConnection": "Los pacientes se sincronizan desde {name}; edítelos en su EHR/PM.",
  "detail.syncedFrom": "Sincronizado desde {name} · última actualización {date}",

  // Tabla de pacientes (lista y resultados de búsqueda) e insignias
  "badge.restricted": "Restringido",
  "badge.selfPay": "Pago particular",

  // Búsqueda
  "search.label": "Buscar un paciente",
  "search.placeholder": "Apellido, Nombre · nombre · MRN",
  "search.searching": "Buscando…",
  "search.resultsLabel": "Resultados de la búsqueda",
  "search.noMatches": "Ningún paciente coincide.",
  "search.matchCount": "{count, plural, one {# coincidencia} other {# coincidencias}}",
  "search.truncatedHint": "(primeras 25; afine la búsqueda)",
  "search.resultsCaption": "Resultados de la búsqueda de pacientes",

  // Nombres de campos, compartidos por las etiquetas del formulario, los encabezados de tabla y los
  // mensajes de validación
  "field.mrn": "MRN",
  "field.firstName": "Nombre",
  "field.lastName": "Apellido",
  "field.birthDate": "Fecha de nacimiento",
  "field.sex": "Sexo",
  "field.address": "Dirección",
  "field.city": "Ciudad",
  "field.state": "Estado",
  "field.zip": "Código postal",
  "field.phone": "Teléfono",
  "field.primaryPayer": "Pagador principal",
  "field.memberId": "ID de miembro",
  "field.sensitivityTags": "Etiquetas de sensibilidad",

  // Sexo
  "sex.female": "Femenino",
  "sex.male": "Masculino",
  "sex.unknown": "Desconocido",

  // Etiquetas de sensibilidad del registro (R-3.5.1)
  "sensitivity.hiv": "VIH",
  "sensitivity.mentalHealth": "Salud mental",
  "sensitivity.sud": "Consumo de sustancias (42 CFR Part 2)",
  "sensitivity.genetic": "Pruebas genéticas",
  "sensitivity.minor": "Menor de edad",
  "sensitivity.reproductiveHealth": "Salud reproductiva",

  // Formulario de registro y edición
  "form.mrnHint": "Déjelo en blanco para asignar el siguiente número.",
  "form.payerPlaceholder": "Sin seguro en archivo (pago particular)",
  "form.payerNoMatch":
    "Ningún pagador coincide con “{query}”. Elija uno de la lista o borre el campo para pago particular.",
  "form.payerUnverifiedOption": "{name} (no verificado)",
  "form.payerUnverifiedHint":
    "Pagador no verificado — todavía no hay ID de pagador ni régimen regulatorio en archivo.",
  "form.memberIdHintOnFile": "En archivo: •••• {last4}. Déjelo en blanco para conservarlo.",
  "form.memberIdHintNew": "Se guarda cifrado; solo se muestran los últimos 4 dígitos.",
  "form.reasonLabel": "Motivo del cambio (obligatorio, se guarda en el registro de auditoría)",
  "form.reasonHint": "No incluya datos del paciente en el motivo.",
  "form.syntheticNotice":
    "Solo datos sintéticos. Nunca registre aquí a un paciente real; los MRN y los ID de miembro deben comenzar con SYN.",
  "form.syntheticAttestation":
    "Confirmo que este registro es un dato de prueba sintético, no un paciente real.",
  "form.saveChanges": "Guardar cambios",

  // Validación (patientSchema)
  "validation.enterFirstName": "Ingrese el nombre.",
  "validation.firstNameMaxLength": "El nombre puede tener como máximo {max} caracteres.",
  "validation.firstNameFormat": "El nombre solo puede tener letras, espacios, puntos, apóstrofos y guiones.",
  "validation.enterLastName": "Ingrese el apellido.",
  "validation.lastNameMaxLength": "El apellido puede tener como máximo {max} caracteres.",
  "validation.lastNameFormat": "El apellido solo puede tener letras, espacios, puntos, apóstrofos y guiones.",
  "validation.mrnMaxLength": "El MRN puede tener como máximo {max} caracteres.",
  "validation.mrnFormat": "El MRN solo puede tener letras, números y guiones.",
  "validation.birthDateInvalid": "Ingrese una fecha de nacimiento válida.",
  "validation.birthDateTooOld": "Ingrese una fecha de nacimiento posterior a 1900.",
  "validation.birthDateFuture": "La fecha de nacimiento no puede ser futura.",
  "validation.chooseSex": "Elija el sexo del paciente.",
  "validation.addressMaxLength": "La dirección puede tener como máximo {max} caracteres.",
  "validation.cityMaxLength": "La ciudad puede tener como máximo {max} caracteres.",
  "validation.stateFormat": "Ingrese el estado con dos letras.",
  "validation.postalFormat": "Ingrese un código postal de 5 dígitos o ZIP+4.",
  "validation.phoneFormat": "Ingrese un número de teléfono de 10 dígitos.",
  "validation.memberIdMinLength": "El ID de miembro debe tener al menos {min} caracteres.",
  "validation.memberIdMaxLength": "El ID de miembro puede tener como máximo {max} caracteres.",
  "validation.memberIdFormat": "El ID de miembro solo puede tener letras, números y guiones.",
  "validation.syntheticPrefix": "{field} debe comenzar con {marker} (solo datos sintéticos).",
  "validation.memberIdNeedsPayer": "Elija el pagador al que pertenece este ID de miembro.",

  // Errores del registro de paciente (domain/patients/queries.ts)
  "error.choosePayer": "Elija un pagador de la lista.",
  "error.enterMemberIdForPayer": "Ingrese el ID de miembro para este pagador.",
  "error.duplicateMrn": "Otro paciente ya tiene este MRN.",
  "error.patientNotFound": "Paciente no encontrado.",
  "error.staleRecord": "Este paciente cambió desde que abrió el formulario. Recargue e intente de nuevo.",
  "error.notFound": "No encontrado.",
  "error.noMemberIdOnFile": "No hay ID de miembro en archivo.",
  "error.syncedReadOnly":
    "Este paciente se sincroniza desde el EHR/PM conectado y no se puede editar aquí. Corrija los datos demográficos en el EHR/PM.",
  "error.integrationConnected":
    "Registrar o editar pacientes manualmente está desactivado mientras se configura una conexión con el EHR/PM.",
  "error.roleCannotTag": "Su rol puede ver las etiquetas de sensibilidad, pero no modificarlas.",
  "error.invalidSensitivityTag": "Esa no es una etiqueta de sensibilidad reconocida.",

  // Errores de las acciones del servidor (app/(app)/patients/actions.ts)
  "error.roleReadOnly": "Su rol puede ver pacientes, pero no modificarlos.",
  "error.syntheticRequired":
    "Confirme que este paciente es sintético. Aquí no se permiten datos reales de pacientes.",
  "error.reload": "Recargue la página e intente de nuevo.",
  "error.reasonLength": "Indique por qué cambia el registro (de 5 a 500 caracteres).",
  "error.searchTooShort": "Ingrese al menos 2 caracteres de un nombre o MRN.",
  "error.cantViewMemberId": "Su rol no puede ver los ID de miembro completos.",
  "error.chooseReason": "Elija un motivo.",

  // Navegación
  "nav.breadcrumb": "Ruta de navegación",
  "nav.edit": "Editar",
  "nav.register": "Registrar",

  // Expediente del paciente (página de detalle)
  "detail.totalsLabel": "Totales del paciente",
  "detail.bornOn": "nació el {date}",
  "detail.noInsurance": "Sin seguro en archivo (pago particular).",
  "detail.editRecord": "Editar registro",
  "detail.claims": "Reclamaciones",
  "detail.billed": "Facturado",
  "detail.paid": "Pagado",
  "detail.openDenied": "Denegado abierto",
  "detail.openDenialsCount": "{count, plural, one {# denegación abierta} other {# denegaciones abiertas}}",
  "detail.denials": "Denegaciones",
  "detail.noClaimsTitle": "Sin reclamaciones para este paciente",
  "detail.claimsCaption": "Reclamaciones de este paciente",
  "detail.denialsCaption": "Denegaciones de este paciente",
  "detail.noClaimsDescription":
    "Las reclamaciones aparecerán aquí cuando se creen o se importen para este paciente.",
  "detail.noDenialsTitle": "Sin denegaciones para este paciente",
  "detail.noDenialsDescription": "Las denegaciones de las reclamaciones de este paciente aparecen aquí.",
  "detail.dateOfService": "Fecha de servicio",
  "detail.notice": "Aviso",
  "detail.appealBy": "Apelar antes de",
  "detail.denied": "Denegado",
  "detail.demographics": "Datos demográficos",
  "detail.notOnFile": "No hay dato en archivo",
  "detail.primaryInsurance": "Seguro principal",

  // Página de edición
  "edit.title": "Editar paciente",
  "edit.description":
    "Los cambios se guardan con su motivo en el registro de auditoría. Las reclamaciones ya enviadas conservan lo facturado.",

  // Página de registro (nuevo paciente)
  "new.title": "Registrar paciente",
  "new.description":
    "Datos demográficos y seguro principal. Las reclamaciones de este paciente se vincularán a este registro.",
  "new.readOnlyNotice": "Su rol puede ver pacientes, pero no registrarlos.",
  "new.backToPatients": "Volver a pacientes",

  // Revelar el ID de miembro enmascarado (components/patients/MaskedMemberId)
  "reveal.hide": "Ocultar",
  "reveal.endingIn": "ID de miembro terminado en {last4}",
  "reveal.reasonLabel": "Motivo para verlo",
  "reveal.reasonAppeal": "Preparando apelación",
  "reveal.reasonEligibility": "Verificando elegibilidad",
  "reveal.reasonPayerCall": "Llamada al pagador",
  "reveal.reasonOther": "Otro",
  "reveal.reveal": "Revelar",
  "reveal.error": "No se pudo revelar.",

  // Patrón de registro (docs/specs/record-pages.md): barra de la lista, encabezado del expediente, secciones del formulario
  "list.count": "{count, plural, one {# paciente registrado} other {# pacientes registrados}}",
  "list.searchHint": "Escriba al menos 2 letras de un nombre, “Apellido, Nombre” o un MRN.",
  "field.age": "{years, plural, one {# año} other {# años}}",
  "field.location": "Ubicación",
  "field.coverage": "Cobertura",
  "detail.eyebrow": "Expediente del paciente",
  "detail.claimsCount": "{count, plural, one {# reclamación} other {# reclamaciones}}",
  "detail.denialsCount": "{count, plural, one {# denegación} other {# denegaciones}}",
  "detail.record": "Registro",
  "detail.recordDescription": "Cuándo se registró y se modificó por última vez este expediente.",
  "form.demographicsHint":
    "Nombre y fecha de nacimiento tal como aparecen en la tarjeta del seguro, más los datos de contacto.",
  "form.insuranceHint":
    "El pagador principal y el ID de miembro de la tarjeta. Deje el pagador en blanco para pago particular.",
  "form.auditTitle": "Pista de auditoría",
  "form.auditHint": "Cada cambio se guarda con quién lo hizo y por qué.",
  "form.confirmTitle": "Confirmación",
  "form.confirmHint": "Obligatoria antes de guardar el expediente.",
  "form.actionsNote": "Al guardar se registran su nombre y la hora en la pista de auditoría.",
};
