import type { Messages } from "../types";

export const promptPay: Messages["promptPay"] = {
  "nav.breadcrumb": "Ruta de navegación",
  "list.stat.sectionLabel": "Totales de pago puntual",

  // Estado del reloj y tipos de respuesta (domain/prompt-pay/clock.ts)
  "clockState.open": "Abierto",
  "clockState.met": "Cumplido",
  "clockState.late": "Pagador atrasado",
  "clockState.uncontestable": "Incontestable",
  "responseKind.payment": "Pago",
  "responseKind.denial": "Denegación",
  "responseKind.contest": "Objeción o solicitud de información",

  // Estados de los hitos (app/(app)/prompt-pay/[claimId]/page.tsx MILESTONE_STATES)
  "milestoneState.met": "Cumplido",
  "milestoneState.late": "Cumplido tarde",
  "milestoneState.open": "Abierto",
  "milestoneState.overdue": "Incumplido",

  // Encabezados de tabla compartidos entre la lista y el detalle
  "table.received": "Recibido",
  "table.clockDay": "Día del reloj",
  "table.nextMilestone": "Próximo hito",
  "table.paid": "Pagado",
  "table.interest": "Interés",
  "table.state": "Estado",
  "table.milestone": "Hito",
  "table.due": "Vence",
  "table.metOn": "Cumplido el",
  "table.daysLate": "Días de atraso",
  "table.paymentDate": "Fecha de pago",
  "table.dueDate": "Fecha de vencimiento",
  "table.rate": "Tasa",

  // Lista de pago puntual (app/(app)/prompt-pay/page.tsx)
  "list.title": "Pago puntual",
  "list.description":
    "Relojes de pago puntual de Florida desde la fecha de recepción del pagador: qué debe el pagador y cuándo, hitos incumplidos e intereses.",
  "list.stat.open": "Relojes abiertos",
  "list.stat.openDetail": "En espera de pago o denegación",
  "list.dueSoonLabel": "Vence en {days} días",
  "list.stat.dueSoonDetail": "Próximo hito del pagador",
  "list.stat.late": "Pagador atrasado",
  "list.stat.lateDetail": "Incumplió un hito",
  "list.stat.uncontestable": "Incontestable",
  "list.stat.uncontestableDetail": "No pagado ni denegado a tiempo",
  "list.stat.interestOwed": "Interés adeudado",
  "list.stat.interestDetail": "Por pagos atrasados",
  "list.filter.clock": "Reloj",
  "list.filter.allPayers": "Todos los pagadores",
  "list.truncated":
    "Más de {limit} reclamaciones recibidas: la lista y los totales cubren solo las recibidas más recientemente.",
  "list.empty.titleFiltered": "Ningún reloj coincide con estos filtros",
  "list.empty.title": "No hay relojes de pago puntual",
  "list.empty.description":
    "Un reloj comienza cuando un pagador cubierto por el pago puntual de Florida confirma que recibió una reclamación.",
  "list.table.electronic": "Electrónica",
  "list.table.paper": "Papel",
  "list.table.day": "Día {day}",
  "list.table.dayAlert": "Alerta del día {day}",
  "list.footnote":
    "Los hitos y la tasa de interés provienen del motor de reglas y están pendientes de verificación legal en Florida. Los días de alerta ({days}) son una configuración del consultorio.",

  // Detalle del reloj de pago puntual (app/(app)/prompt-pay/[claimId]/page.tsx)
  "detail.pageTitle": "Reloj de pago puntual",
  "detail.breadcrumbPromptPay": "Pago puntual",
  "detail.kind.electronic": "electrónica",
  "detail.kind.paper": "en papel",
  "detail.claimLabel": "reclamación {kind}",
  "detail.received": "recibida el {date}",
  "detail.day": "día {day}",
  "detail.openClaim": "Abrir reclamación",
  "detail.recordContest": "Registrar objeción",
  "detail.noRegime":
    "El régimen regulatorio de este pagador no se ha verificado, así que DenialDesk no ejecuta un reloj de pago puntual para él. Un administrador puede verificar el pagador.",
  "detail.notCovered":
    "El pago puntual de Florida no cubre reclamaciones de {regime}, por lo que esta reclamación no tiene reloj.",
  "detail.notReceived":
    "El pagador aún no ha confirmado la recepción de esta reclamación, así que su reloj de pago puntual no ha comenzado.",
  "detail.uncontestableAlert":
    "El pagador no pagó ni denegó esta reclamación para el hito de incontestabilidad. El pago podría ahora ser una obligación incontestable (R-3.1.4). Confirme con un abogado antes de enviar un requerimiento de pago.",
  "detail.milestones.title": "Hitos",
  "detail.milestones.caption": "Hitos del pago puntual",
  "detail.milestones.description": "Contados en días calendario desde la fecha de recepción del pagador.",
  "detail.milestones.pendingVerification": "Pendiente de verificación legal",
  "detail.interest.title": "Hoja de cálculo de interés",
  "detail.interest.description":
    "Interés simple sobre cada pago realizado después de la fecha de vencimiento (R-3.1.3).",
  "detail.interest.noneWithDue": "Sin pagos atrasados. El pago vence el {date}.",
  "detail.interest.noneNoDue": "Todavía no hay pagos.",
  "detail.interest.totalOwed": "Interés total adeudado",
  "detail.interest.ratePerYear": "{rate}% anual",
  "detail.interest.footnote":
    "El interés comienza el día después del vencimiento del pago (la fecha de pagar u objetar, o la de pagar o denegar una vez que el pagador objeta). Pendiente de verificación legal.",
  "detail.claim.title": "Reclamación",
  "detail.claim.billedPaid": "Facturado / pagado",
  "detail.claim.contestResponseDue": "Su respuesta a la objeción vence el",
  "detail.responses.title": "Respuestas del pagador",
  "detail.responses.description":
    "Cada respuesta de este reloj. Las entradas nunca se editan ni se eliminan.",
  "detail.responses.none": "Aún no se ha registrado ningún pago, denegación u objeción.",
  "detail.responses.recordedInError": "Registrado por error: ",
  "detail.responses.fromRemittance": "De la remesa",
  "detail.responses.formerTeamMember": "Exmiembro del equipo",
  "detail.responses.system": "Sistema",

  // Formulario de anulación (registrado por error) (app/(app)/prompt-pay/[claimId]/VoidResponseForm.tsx)
  "void.button": "Registrado por error…",
  "void.prompt": "¿Por qué esta entrada es incorrecta?",
  "void.submit": "Marcar como error",
  "void.saving": "Guardando…",

  // Página y formulario de nueva objeción
  "newContest.title": "Registrar objeción del pagador",
  "newContest.description":
    "El pagador objetó esta reclamación o solicitó más información. Esto cumple solo el hito de pagar u objetar; el reloj de pagar o denegar sigue corriendo.",
  "newContest.breadcrumbRecordContest": "Registrar objeción",
  "contestForm.dateLabel": "Fecha del aviso del pagador",
  "contestForm.dateHint": "La fecha en que el pagador objetó la reclamación o solicitó información.",
  "contestForm.noteLabel": "¿Qué solicitó el pagador?",
  "contestForm.submit": "Registrar objeción",
  "contestForm.saving": "Guardando…",

  // Errores y resultados de la acción del servidor (app/(app)/prompt-pay/actions.ts)
  "action.error.forbiddenRecord":
    "Su rol puede ver los relojes de pago puntual, pero no registrar respuestas.",
  "action.error.forbiddenChange": "Su rol puede ver los relojes de pago puntual, pero no modificarlos.",
  "action.error.reload": "Recargue la página e inténtelo de nuevo.",
  "action.error.invalidDate": "Ingrese la fecha del aviso del pagador.",
  "action.done.voided": "Marcado como registrado por error.",

  // Errores del dominio de pago puntual (domain/prompt-pay/responses.ts PromptPayError)
  "error.sayWhatPayerAsked": "Indique qué solicitó el pagador.",
  "error.sayWhyWrong": "Indique por qué esta entrada es incorrecta.",
  "error.noteTooLong": "Manténgalo por debajo de {max} caracteres.",
  "error.claimNotFound": "Reclamación no encontrada.",
  "error.notReceived": "El pagador aún no ha recibido esta reclamación.",
  "error.noticeBeforeReceived":
    "El aviso del pagador no puede tener fecha anterior a cuando el pagador recibió la reclamación.",
  "error.noticeInFuture": "La fecha del aviso no puede ser futura.",
  "error.entryNotFound": "Entrada no encontrada.",
  "error.notVoidable": "Los pagos y denegaciones provienen de remesas y no se pueden marcar como error aquí.",
  "error.alreadyVoided": "Esta entrada ya está marcada como registrada por error.",
};
