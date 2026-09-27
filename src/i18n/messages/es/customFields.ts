/** Messages for rendering and storing custom field values on record forms and detail pages
 * (docs/specs/settings-and-custom-fields.md S2). Shared across patients, claims, denials, payers. */
export const customFields = {
  "section.title": "Campos adicionales",
  "input.locked": "Bloqueado",
  "input.change": "Cambiar",
  "input.cancelChange": "Cancelar",
  "input.checkboxYes": "Sí",
  "input.required": "Obligatorio",

  "value.locked": "Bloqueado",
  "value.open": "Abrir",
  "value.hide": "Ocultar",
  "value.unavailable": "Valor no disponible",
  "value.notOnFile": "Sin registrar",
  "value.reasonLabel": "Motivo para ver",
  "value.reasonAppeal": "Preparando apelación",
  "value.reasonEligibility": "Verificando elegibilidad",
  "value.reasonPayerCall": "Llamada con el pagador",
  "value.reasonOther": "Otro",
  "value.error": "No se pudo abrir.",

  "error.cantView": "No tiene permiso para ver este campo.",
  "error.chooseReason": "Elija un motivo.",
} as const;
