import type { Messages } from "../types";

export const settings: Messages["settings"] = {
  // Estructura de Configuración (diseño, pestañas)
  "page.title": "Configuración",
  "page.description":
    "Cómo está configurado DenialDesk para su consultorio: su perfil, los campos de sus registros y quién puede hacer qué.",
  "tabs.general": "General",
  "tabs.customFields": "Campos personalizados",
  "tabs.payers": "Pagadores",
  "tabs.usersAndRoles": "Usuarios y roles",
  "tabs.security": "Seguridad",
  "tabs.notifications": "Notificaciones",
  "tabs.integrations": "Integraciones",
  "tabs.sectionsLabel": "Secciones de configuración",
  "nav.breadcrumb": "Ruta de navegación",

  // Página de configuración general
  "general.profileTitle": "Perfil del consultorio",
  "general.profileDescription": "Definido cuando DenialDesk creó su consultorio.",
  "general.practiceName": "Nombre del consultorio",
  "general.environment": "Entorno",
  "general.production": "Producción",
  "general.preProduction": "Preproducción",
  "general.syntheticDataOnly": "solo datos sintéticos",
  "general.dataResidency": "Residencia de los datos",
  "general.dataResidencyValue": "Solo Estados Unidos",
  "general.contactSupport": "Para cambiar el nombre del consultorio, contacte al soporte de DenialDesk.",
  "general.accountTitle": "Su cuenta",
  "general.accountDescription": "El usuario con el que inició sesión.",
  "general.canChangeSettings": "Puede cambiar la configuración",
  "general.viewOnly": "No: solo lectura",

  // Lista de campos personalizados
  "fields.metaTitle": "Campos personalizados",
  "fields.recordTypesLabel": "Tipos de registro",
  "fields.recordsHeading": "Registros",
  "fields.panelTitle": "Campos de {entity}",
  "fields.panelDescription":
    "Campos que su consultorio agrega a {entity}, en el orden del formulario. Los campos desactivados se ocultan de los formularios y conservan su historial.",
  "fields.addField": "Agregar campo",
  "fields.emptyTitle": "Todavía no hay campos personalizados en {entity}",
  "fields.emptyDescriptionCanEdit":
    "Agregue un campo para registrar algo que DenialDesk no rastrea de forma predeterminada, como una clínica de referencia o un nivel de cuenta interno.",
  "fields.emptyDescriptionReadOnly":
    "Un administrador puede agregar campos para registrar lo que su consultorio rastrea más allá del registro estándar.",
  "fields.tableCaption": "Campos personalizados de {entity}",
  "fields.label": "Etiqueta",
  "fields.key": "Clave",
  "fields.sensitivity": "Sensibilidad",
  "fields.locked": "Bloqueado · {category}",
  "fields.notSensitive": "No sensible",
  "fields.active": "Activo",
  "fields.inactive": "Inactivo",
  "fields.editAria": "Editar {label}",
  "fields.deactivate": "Desactivar",
  "fields.reactivate": "Reactivar",
  "fields.toggleAria": "{action} {label}",

  "fields.newMetaTitle": "Agregar campo personalizado",
  "fields.newTitle": "Agregar un campo personalizado",
  "fields.newDescription": "El campo aparece en todo registro del tipo elegido.",
  "fields.editMetaTitle": "Editar campo personalizado",
  "fields.editTitle": "Editar “{label}”",
  "fields.editDescription":
    "El tipo de registro, la clave y el tipo de campo quedan fijos una vez creado el campo.",

  // Tipos de registro a los que puede pertenecer un campo personalizado
  "entity.patient": "Pacientes",
  "entity.claim": "Reclamaciones",
  "entity.denial": "Denegaciones",
  "entity.payer": "Pagadores",

  // Tipos de campo personalizado
  "type.text": "Texto breve",
  "type.longText": "Texto largo",
  "type.number": "Número",
  "type.date": "Fecha",
  "type.checkbox": "Casilla (sí / no)",
  "type.select": "Lista de opciones",
  "fields.choicesCount": "{count, plural, one {# opción} other {# opciones}}",

  // Formulario para agregar o editar un campo personalizado
  "form.addTo": "Agregar a",
  "form.fieldType": "Tipo de campo",
  "form.labelHint":
    "Lo que la gente ve en el formulario, por ejemplo “Clínica de referencia”. Nunca ponga información del paciente en una etiqueta.",
  "form.keyHintEditing": "La clave no puede cambiar una vez que el campo existe.",
  "form.keyHintNew":
    "Se usa en exportaciones e integraciones. Déjelo en blanco para usar la sugerencia. No podrá cambiarse después.",
  "form.choices": "Opciones",
  "form.choicesHint": "Una opción por línea, en el orden en que se mostrarán (hasta 50).",
  "form.helpText": "Texto de ayuda (opcional)",
  "form.helpTextHint": "Se muestra debajo del campo en el formulario.",
  "form.sensitiveOption": "Sensible: {name}",
  "form.sensitivityHint":
    "Un campo sensible queda bloqueado en todo registro: su valor permanece oculto hasta que alguien lo abre con un motivo, y cada apertura queda registrada en el registro de auditoría.",
  "form.requiredLabel": "Obligatorio: el registro no se puede guardar sin este campo",
  "form.showInListLabel": "Mostrar en la lista: agrega una columna para este campo en la lista de registros",
  "form.showInListDisabledHint": "Los campos sensibles nunca aparecen en listas, búsquedas ni exportaciones.",
  "form.saveField": "Guardar campo",
  "form.adding": "Agregando…",

  // Acciones del servidor para campos personalizados (app/(app)/settings/fields/actions.ts)
  "error.notAdmin": "Solo los administradores pueden cambiar los campos personalizados.",
  "error.duplicateKey": "Otro campo de estos registros ya usa esta clave.",
  "error.fieldNotFound": "Campo no encontrado.",

  // Definiciones de campos personalizados (domain/settings/custom-fields.ts)
  "validation.enterLabel": "Ingrese una etiqueta.",
  "validation.labelMaxLength": "La etiqueta debe tener 60 caracteres o menos.",
  "validation.helpTextMaxLength": "El texto de ayuda debe tener 200 caracteres o menos.",
  "validation.choiceMaxLength": "Cada opción debe tener 60 caracteres o menos.",
  "validation.choicesMax": "Una lista de opciones puede tener como máximo {max} opciones.",
  "validation.chooseSensitivity": "Elija una categoría de sensibilidad de la lista.",
  "validation.needOneChoice": "Agregue al menos una opción, una por línea.",
  "validation.chooseEntity": "Elija qué registros reciben este campo.",
  "validation.keyFormat":
    "Use una clave en minúsculas que empiece con una letra: letras, números y guiones bajos.",
  "validation.chooseFieldType": "Elija un tipo de campo.",

  // Almacenamiento de campos personalizados (domain/settings/queries.ts)
  "error.tooManyFields": "Este tipo de registro ya tiene {max} campos activos. Desactive uno que ya no use.",
  "error.staleField": "Este campo cambió desde que lo abrió. Recargue e intente de nuevo.",
  "error.tooManyListColumns":
    "Como máximo {max} campos por tipo de registro pueden mostrarse en la lista. Desactive uno primero.",

  // Valores de los campos personalizados (domain/custom-fields/values.ts)
  "error.required": "{field} es obligatorio.",
  "error.maxLength": "{field} debe tener {max} caracteres o menos.",
  "error.mustBeNumber": "{field} debe ser un número.",
  "error.tooManyDigits": "{field} tiene demasiados dígitos.",
  "error.mustBeDate": "{field} debe ser una fecha válida.",
  "error.chooseCurrentOption": "Elija una opción vigente para {field}.",
  "error.unknownFieldType": "Tipo de campo desconocido para {field}.",
  "error.cantChangeField": "Su rol no puede cambiar {field}.",
  "error.cantReveal": "Su rol no puede revelar valores de campos personalizados.",
  "error.notLocked": "Este valor no está bloqueado.",
  "error.noValueOnFile": "No hay ningún valor en archivo.",
  "error.valueUnavailable": "Valor no disponible.",
  "error.staleValues": "Estos campos cambiaron desde que los abrió. Recargue e intente de nuevo.",
  "error.reload": "Recargue la página e intente de nuevo.",

  // Pagadores en Configuración (docs/specs/settings-and-custom-fields.md S2 PR4; registro de
  // solo lectura; payer-catalog P2 agregará verificación y edición).
  "payers.metaTitle": "Pagadores",
  "payers.listTitle": "Pagadores",
  "payers.listDescription": "Los pagadores de su consultorio, cargados desde el catálogo inicial de Florida.",
  "payers.count": "{count, plural, one {# pagador} other {# pagadores}}",
  "payers.tableCaption": "Pagadores",
  "payers.ediPayerId": "ID de pagador EDI",
  "payers.notVerified": "No verificado",
  "payers.source": "Fuente",
  "payers.sourceNotRecorded": "No registrado",
  "payers.sourceOir": "Lista de aseguradoras autorizadas de la OIR de Florida",
  "payers.sourceSmmc": "Lista de planes de atención administrada de Medicaid (AHCA)",
  "payers.sourceCms": "CMS",
  "payers.sourceReference": "Lista de referencia (aún no verificada)",
  "payers.emptyTitle": "Todavía no hay pagadores",
  "payers.emptyDescription": "Los pagadores aparecen cuando se carga el catálogo inicial de su consultorio.",

  "payers.detailMetaTitle": "Pagador",
  "payers.detailEyebrow": "Registro de pagador",
  "payers.breadcrumbList": "Pagadores",
  "payers.badgeUnverified": "No verificado",
  "payers.detailsTitle": "Datos del pagador",
  "payers.detailsDescription":
    "El nombre, el ID de pagador EDI y el régimen regulatorio se verifican en una fase posterior y no se pueden cambiar aquí.",
  "payers.field.ediPayerId": "ID de pagador EDI",
  "payers.field.regime": "Régimen regulatorio",
  "payers.field.source": "Fuente",
  "payers.field.added": "Agregado",
  "payers.editCustomFields": "Editar campos personalizados",

  "payers.fieldsMetaTitle": "Editar campos personalizados del pagador",
  "payers.fieldsPageTitle": "Editar campos personalizados",
  "payers.fieldsDescription": "Campos que su consultorio agregó a los pagadores.",
  "payers.fieldsBreadcrumb": "Campos personalizados",

  "error.notPayerEditor":
    "Solo los administradores y gerentes pueden cambiar los campos personalizados de un pagador.",
};
