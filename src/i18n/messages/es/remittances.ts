import type { Messages } from "../types";

export const remittances: Messages["remittances"] = {
  "nav.breadcrumb": "Ruta de navegación",
  "list.stat.sectionLabel": "Totales de remesas",

  // Estado de la remesa, método y códigos CLP02 (domain/remittances/status.ts)
  "status.received": "Lista para aplicar",
  "status.posted": "Aplicada",
  "status.void": "Anulada",
  "method.check": "Cheque",
  "method.eft": "Transferencia (EFT)",
  "method.non_payment": "Sin pago",
  "clpStatus.1": "Procesada como primaria",
  "clpStatus.2": "Procesada como secundaria",
  "clpStatus.3": "Procesada como terciaria",
  "clpStatus.4": "Denegada",
  "clpStatus.19": "Primaria, reenviada",
  "clpStatus.20": "Secundaria, reenviada",
  "clpStatus.21": "Terciaria, reenviada",
  "clpStatus.22": "Reversión",
  "clpStatus.23": "No es nuestra reclamación, reenviada",
  "clpStatus.25": "Solo predeterminación",
  "clpStatus.other": "Otro",

  // Lista de remesas (app/(app)/remittances/page.tsx)
  "list.title": "Remesas",
  "list.description":
    "Pagos de pagadores de archivos de remesa 835. Verifique que un archivo cuadre y luego aplíquelo a sus reclamaciones.",
  "list.newRemittance": "Nueva remesa",
  "list.stat.readyToPost": "Listas para aplicar",
  "list.stat.readyDetail": "Cargadas, aún no aplicadas a reclamaciones",
  "list.stat.readyPaid": "Listas para aplicar, pagado",
  "list.stat.posted": "Aplicadas",
  "list.stat.postedPaid": "Aplicadas, pagado",
  "list.filter.allPayers": "Todos los pagadores",
  "list.empty.titleFiltered": "Ninguna remesa coincide con estos filtros",
  "list.empty.title": "Todavía no hay remesas",
  "list.empty.description":
    "Cargue un archivo de remesa 835 del pagador o la cámara de compensación para verlo aquí.",
  "list.table.traceNumber": "Número de rastreo",
  "list.table.method": "Método",
  "list.table.paymentDate": "Fecha de pago",
  "list.table.claims": "Reclamaciones",
  "list.table.paid": "Pagado",

  // Nueva remesa (app/(app)/remittances/new/page.tsx)
  "new.breadcrumbRemittances": "Remesas",
  "new.breadcrumbNew": "Nueva",
  "new.title": "Nueva remesa",
  "new.description":
    "Cargue un 835 del pagador o la cámara de compensación. DenialDesk verifica que cuadre y coincida con sus reclamaciones antes de aplicar nada.",
  "new.backToRemittances": "Volver a remesas",

  // Formulario de carga (app/(app)/remittances/new/UploadRemittanceForm.tsx)
  "upload.fileLabel": "Archivo de remesa 835 (un pago, hasta 5 MB)",
  "upload.fileHint":
    "El pagador debe tener configurado su ID de pagador EDI, y toda reclamación del archivo debe existir ya en DenialDesk. Nada cambia en una reclamación hasta que aplique la remesa.",
  "upload.syntheticAttestation":
    "Este archivo contiene solo datos sintéticos. No se permiten remesas reales en este entorno.",
  "upload.submit": "Cargar y verificar",
  "upload.checking": "Verificando…",

  // Detalle de la remesa (app/(app)/remittances/[id]/page.tsx)
  "detail.pageTitle": "Remesa",
  "detail.breadcrumbRemittances": "Remesas",
  "detail.totalPaid": "Total pagado",
  "detail.payment.title": "Pago",
  "detail.field.ediId": "EDI {ediId}",
  "detail.field.method": "Método",
  "detail.field.traceNumber": "Número de rastreo",
  "detail.field.paymentDate": "Fecha de pago",
  "detail.field.claimsPaid": "Reclamaciones pagadas",
  "detail.field.providerAdjustments": "Ajustes del proveedor",
  "detail.field.balanceCheck": "Verificación de cuadre",
  "detail.field.loadedBy": "Cargada por",
  "detail.balances": "Cuadra",
  "detail.doesNotBalance": "No cuadra",
  "detail.claimPayments.title": "Pagos de reclamaciones",
  "detail.claimPayments.description": "Una fila por reclamación en esta remesa (bucle CLP del 835).",
  "detail.table.payerStatus": "Estado del pagador",
  "detail.table.charge": "Cargo",
  "detail.table.paid": "Pagado",
  "detail.table.patientOwes": "Debe el paciente",
  "detail.table.adjustments": "Ajustes",
  "detail.icn": "ICN {number}",
  "detail.formerTeamMember": "Exmiembro del equipo",
  "detail.system": "Sistema",
  "detail.actions.title": "Acciones",
  "detail.actions.forbidden": "Su rol puede ver las remesas, pero no aplicarlas.",
  "detail.denialsCaptured.title": "Denegaciones capturadas",
  "detail.denialsCaptured.description":
    "Agregadas a la cola de denegaciones al aplicar esta remesa. Las categorías provienen del propio mapeo de códigos de DenialDesk, pendiente de revisión.",
  "detail.history.title": "Historial",
  "detail.history.listLabel": "Historial de la remesa",
  "detail.history.description":
    "Cada cambio de esta remesa: quién, cuándo y por qué. El historial no se puede editar.",
  "event.received": "Cargada",
  "event.posted": "Aplicada",
  "event.void": "Anulada",

  // Acciones de aplicar / anular (app/(app)/remittances/[id]/RemittanceActions.tsx)
  "actions.postExplain":
    "Aplicar actualiza el monto pagado y el estado de cada reclamación (una nueva versión) y registra el pago o la denegación en su reloj de pago puntual. No se puede deshacer aquí.",
  "actions.postSubmit": "Aplicar pagos",
  "actions.posting": "Aplicando…",
  "actions.notBalanced": "Este archivo no cuadra, así que no se puede aplicar.",
  "actions.voidPrompt": "¿Por qué se anula esta remesa?",
  "actions.voidSubmit": "Anular remesa",
  "actions.voiding": "Anulando…",
  "actions.voidButton": "Anular…",

  // Errores y resultados de la acción del servidor (app/(app)/remittances/actions.ts)
  "action.error.forbiddenUpload": "Su rol puede ver las remesas, pero no cargarlas.",
  "action.error.forbiddenPost": "Su rol puede ver las remesas, pero no aplicarlas.",
  "action.error.forbiddenVoid": "Solo los administradores y gerentes pueden anular una remesa.",
  "action.error.chooseFile": "Elija un archivo 835 para cargar.",
  "action.error.fileTooLarge": "El archivo supera los 5 MB. Cargue una remesa por archivo.",
  "action.error.confirmSynthetic": "Confirme que el archivo contiene solo datos sintéticos.",
  "action.error.notPlainText": "El archivo no es texto plano. Cargue el 835 tal como lo envió el pagador.",
  "action.error.reload": "Recargue la página e inténtelo de nuevo.",
  "action.done.postedNoDenials": "Aplicada a {count, plural, one {# reclamación} other {# reclamaciones}}.",
  "action.done.postedWithDenials":
    "Aplicada a {claims, plural, one {# reclamación} other {# reclamaciones}}; se agregaron {denials, plural, one {# denegación} other {# denegaciones}} a la cola.",
  "action.done.voided": "Anulada.",

  // Errores del dominio de remesas (domain/remittances/records.ts RemittanceError)
  "error.andMore": "{shown} y {count} más",
  "error.noPayerId":
    "El archivo no identifica al pagador (ID de pagador N1*PR). Pida al pagador un archivo corregido.",
  "error.duplicatePayerId":
    "Más de un pagador tiene el ID de pagador EDI {ediPayerId}. Corrija la configuración de pagadores y vuelva a cargar.",
  "error.unknownPayerId":
    "Ningún pagador de este consultorio tiene el ID de pagador EDI {ediPayerId}. Agregue primero el pagador y vuelva a cargar.",
  "error.emptyReversals": "Las reversiones deben recuperar un pago: {claims} revierten $0.",
  "error.badReversals":
    "Los pagos negativos deben ser reversiones (CLP02 22) y las reversiones deben ser negativas: {claims}.",
  "error.duplicateClaims": "Hay reclamaciones repetidas en este archivo: {claims}.",
  "error.duplicateTrace": "El número de rastreo {traceNumber} de este pagador ya está registrado.",
  "error.noMatchingClaims": "Ninguna reclamación de este pagador coincide con {claims}. No se cargó nada.",
  "error.notPayable":
    "Estas reclamaciones están en borrador, rechazadas o cerradas y no pueden recibir un pago: {claims}.",
  "error.notFound": "Remesa no encontrada.",
  "error.alreadyVoid": "Esta remesa ya está anulada.",
  "error.alreadyPosted": "Esta remesa ya está aplicada.",
  "error.notBalanced": "Esta remesa no cuadra, así que no se puede aplicar.",
  "error.payerUnavailable": "El pagador de esta remesa ya no está disponible.",
  "error.claimUnavailable": "Una reclamación de esta remesa ya no está disponible.",
  "error.claimNotPayable": "La reclamación {claimNumber} está {status} y no puede recibir un pago.",
  "error.reversalExceedsPaid":
    "Reclamación {claimNumber}: la reversión recupera más de lo pagado. No se aplicó nada.",
  "error.voidReasonRequired": "Indique por qué se anula esta remesa.",
  "error.reasonTooLong": "Mantenga el motivo por debajo de {max} caracteres.",
  "error.onlyUnposted": "Solo se puede anular una remesa que aún no se haya aplicado.",
  "error.reversalMismatch":
    "Una reversión de esta remesa no coincide con ningún pago anterior por el mismo monto. Aplíquela manualmente después de consultar con el pagador.",
};
