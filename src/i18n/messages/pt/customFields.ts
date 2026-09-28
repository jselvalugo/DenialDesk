/** Messages for rendering and storing custom field values on record forms and detail pages
 * (docs/specs/settings-and-custom-fields.md S2). Shared across patients, claims, denials, payers. */
export const customFields = {
  "section.title": "Campos personalizados",
  "input.locked": "Bloqueado",
  "input.change": "Alterar",
  "input.cancelChange": "Cancelar",
  "input.checkboxYes": "Sim",
  "input.required": "Obrigatório",

  "value.locked": "Bloqueado",
  "value.open": "Abrir",
  "value.hide": "Ocultar",
  "value.unavailable": "Valor indisponível",
  "value.notOnFile": "Não registrado",
  "value.reasonLabel": "Motivo da visualização",
  "value.reasonAppeal": "Preparando recurso",
  "value.reasonEligibility": "Verificando elegibilidade",
  "value.reasonPayerCall": "Ligação com a operadora",
  "value.reasonOther": "Outro",
  "value.error": "Não foi possível abrir.",

  "error.cantView": "Você não tem permissão para ver este campo.",
  "error.chooseReason": "Escolha um motivo.",

  "form.actionsNote": "Ao salvar, seu nome e o horário são registrados na trilha de auditoria.",
} as const;
