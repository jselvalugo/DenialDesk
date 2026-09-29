import type { Messages } from "../types";

export const operator: Messages["operator"] = {
  // Shared status words (practices list and practice detail)
  "status.active": "Activo",
  "status.suspended": "Suspendido",
  "status.archived": "Archivado",
  "status.demo": "Demostración",
  "status.customer": "Cliente",

  // Business Associate Agreement status for a practice (AgreementStatusBadge)
  "badge.missing": "Sin BAA",
  "badge.notYetEffective": "Aún no vigente",
  "badge.expiringSoon": "Por vencer",
  "badge.expired": "Vencido",

  // Status of one agreement record (practice detail table)
  "recordStatus.superseded": "Reemplazado",
  "recordStatus.historical": "Histórico",
  "recordStatus.voided": "Registrado por error",

  // Shared navigation
  "nav.allPractices": "Todos los consultorios",
  "nav.breadcrumbLabel": "Ruta de navegación",

  // Practices list (page.tsx)
  "list.title": "Consultorios",
  "list.description":
    "Todos los consultorios de este entorno de DenialDesk. Solo datos a nivel de consultorio; los datos de los pacientes permanecen dentro de cada consultorio.",
  "list.newPractice": "Nuevo consultorio",
  "list.totalsLabel": "Totales de la plataforma",
  "list.stat.customers": "Consultorios clientes",
  "list.stat.withoutBaa": "Sin un BAA vigente",
  "list.stat.openDenials": "Denegaciones abiertas (todos los consultorios)",
  "list.panelTitle": "Todos los consultorios",
  "list.tableCaption": "Todos los consultorios de este entorno",
  "list.columns.team": "Equipo",
  "list.columns.openDenials": "Denegaciones abiertas",
  "list.columns.baa": "BAA",
  "list.suspend": "Suspender",
  "list.reactivate": "Reactivar",
  "list.suspendAria": "Suspender {name}",
  "list.reactivateAria": "Reactivar {name}",

  // New practice (practices/new)
  "newPractice.title": "Nuevo consultorio",
  "newPractice.description":
    "Crea el consultorio y su primer administrador, quien luego podrá añadir a su equipo. A continuación, registre el BAA firmado en la página del consultorio.",
  "newPractice.sectionTitle": "Datos del consultorio",
  "newPractice.practiceNameLabel": "Nombre del consultorio",
  "newPractice.adminNameLabel": "Nombre completo del administrador",
  "newPractice.adminEmailLabel": "Correo electrónico laboral del administrador",
  "newPractice.submit": "Crear consultorio",
  "newPractice.creating": "Creando…",
  "newPractice.createdHeading": "{name} creado",
  "newPractice.sendDetails":
    "Envíe al administrador sus datos de acceso por un canal seguro. Esta contraseña se muestra una sola vez.",
  "newPractice.temporaryPasswordLabel": "Contraseña temporal",
  "newPractice.mfaHint": "Configurará la verificación en dos pasos en su primer inicio de sesión.",
  "newPractice.openPractice": "Abrir consultorio",
  "newPractice.createAnother": "Crear otro",

  // Practice detail (practices/[tenantId])
  "practice.metaTitle": "Consultorio",
  "practice.descriptionCustomer": "Consultorio cliente. Solo datos a nivel de consultorio.",
  "practice.descriptionDemo": "Consultorio de demostración con datos sintéticos.",
  "practice.panelTitle": "Consultorio",
  "practice.baaTitle": "Acuerdo de socio comercial (BAA)",
  "practice.baaDescription": "El acuerdo firmado registrado para este consultorio, y cada versión anterior.",
  "practice.noAgreement":
    "No hay ningún acuerdo registrado. Registre el BAA firmado a continuación antes de que este consultorio maneje datos de pacientes.",
  "practice.tableCaption": "Acuerdos registrados",
  "practice.columns.effective": "Vigencia",
  "practice.columns.expires": "Vence",
  "practice.columns.signed": "Firmado",
  "practice.columns.practiceSigner": "Firmante del consultorio",
  "practice.columns.ourSigner": "Firmante de DenialDesk",
  "practice.columns.recorded": "Registrado",
  "practice.columns.file": "Archivo",
  "practice.untilTerminated": "Hasta su terminación",
  "practice.voidedNote": "Registrado por error: {reason}",
  "practice.fileHashTitle": "SHA-256 {sha}",
  "practice.recordTitleRenew": "Registrar un acuerdo renovado",
  "practice.recordTitleNew": "Registrar el acuerdo firmado",
  "practice.recordDescription":
    "Se almacena junto con el consultorio durante el período de retención; los acuerdos nunca se editan ni se eliminan.",
  "practice.correctTitle": "Corregir el registro",
  "practice.correctDescription":
    "Una carga incorrecta o un error de escritura no se puede editar. Marque el acuerdo como registrado por error y luego registre el correcto; ambos permanecen archivados.",

  // Record agreement form
  "agreementForm.replacesActive":
    "Registrar un nuevo acuerdo reemplaza al que está activo actualmente. El actual permanece archivado como reemplazado.",
  "agreementForm.fileLabel": "Acuerdo firmado (PDF, hasta 5 MB)",
  "agreementForm.effectiveDateLabel": "Fecha de vigencia",
  "agreementForm.expiresOnLabel": "Vence el",
  "agreementForm.expiresOnHint": "Déjelo en blanco si rige hasta su terminación.",
  "agreementForm.signedOnLabel": "Fecha de firma",
  "agreementForm.practiceSignerLabel": "Firmado en nombre del consultorio por",
  "agreementForm.ourSignerLabel": "Firmado en nombre de DenialDesk por",
  "agreementForm.nameAndTitleHint": "Nombre y cargo.",
  "agreementForm.noteLabel": "Nota",
  "agreementForm.noteHint": "Opcional. Sin información de pacientes.",
  "agreementForm.syntheticAttestation":
    "Este es un documento de prueba sintético, no un acuerdo real. El nombre del archivo comienza con <code>{prefix}</code>; los acuerdos reales se rechazan en este entorno.",
  "agreementForm.submit": "Registrar acuerdo",
  "agreementForm.recording": "Registrando…",
  "agreementForm.recorded": "{filename} registrado como el acuerdo activo.",
  "agreementForm.recordedSuperseded":
    "{filename} registrado como el acuerdo activo; el acuerdo anterior permanece archivado como reemplazado.",

  // Void (record in error) agreement form
  "voidForm.recordedNotice":
    "El acuerdo está marcado como registrado por error. Permanece archivado y ya no cuenta.",
  "voidForm.agreementLabel": "Acuerdo",
  "voidForm.choosePlaceholder": "Elija un acuerdo",
  "voidForm.optionLabel": "{filename} · vigencia {date} · {status}",
  "voidForm.reasonLabel": "Por qué se registró por error",
  "voidForm.reasonHint":
    "Se conserva con el registro y en el registro de auditoría. Sin información de pacientes.",
  "voidForm.submit": "Marcar como registrado por error",
  "voidForm.marking": "Marcando…",

  // Server-action and domain errors
  "errors.createFormInvalid":
    "Ingrese el nombre del consultorio, el nombre del administrador y un correo electrónico válido.",
  "errors.invalidRequest": "Solicitud no válida.",
  "errors.agreementFormInvalid": "Ingrese las fechas de vigencia y de firma, y ambos firmantes.",
  "errors.voidFormInvalid": "Elija el acuerdo y explique por qué se registró por error.",
  "errors.chooseFile": "Elija el acuerdo firmado como un archivo PDF.",
  "errors.fileTooLarge": "El archivo supera los 5 MB. Exporte el PDF firmado con una resolución más baja.",
  "errors.fileNameInvalid":
    "El nombre del archivo es demasiado largo o contiene caracteres inusuales. Cambie el nombre del archivo.",
  "errors.fileNotPdf": "El archivo no es un PDF. Cargue el acuerdo firmado como un PDF.",
  "errors.syntheticPrefixRequired":
    "Este entorno solo admite consultorios sintéticos. Nombre los archivos de prueba con {prefix}… y nunca cargue un acuerdo real aquí.",
  "errors.attestSyntheticRequired": "Confirme que el archivo es un documento de prueba sintético.",
  "errors.expiresBeforeEffective": "La fecha de vencimiento no puede ser anterior a la fecha de vigencia.",
  "errors.signedInFuture": "La fecha de firma no puede estar en el futuro.",
  "errors.practiceNotFound": "Ese consultorio ya no existe o no es un consultorio cliente.",
  "errors.agreementRace":
    "Se acaba de registrar otro acuerdo para este consultorio. Vuelva a cargar la página para verlo.",
  "errors.voidReasonTooShort": "Explique por qué se registró el acuerdo por error (al menos unas palabras).",
  "errors.agreementNotFound":
    "Ese acuerdo no está registrado para este consultorio, o ya está marcado como registrado por error.",
  "errors.emailExists": "Ya existe una cuenta con ese correo electrónico.",

  // Panel de acceso a la Universidad (página del consultorio)
  "university.title": "Universidad DenialDesk",
  "university.description":
    "El acceso a los cursos de la Universidad se registra aquí cuando el consultorio lo ha comprado. Los cursos permanecen bloqueados hasta entonces; la Wiki siempre está abierta.",
  "university.status.none": "No solicitado",
  "university.status.requested": "Solicitado",
  "university.status.granted": "Acceso otorgado",
  "university.status.revoked": "Revocado",
  "university.requestedOn": "Solicitado por el consultorio el {date}",
  "university.grantedOn": "Otorgado el {date}",
  "university.revokedOn": "Revocado el {date}: {reason}",
  "university.noteLabel": "Referencia de pedido o factura",
  "university.noteHint": "Opcional. Sin información de pacientes.",
  "university.grant": "Otorgar acceso",
  "university.granting": "Otorgando…",
  "university.granted": "Acceso otorgado. Los cursos del consultorio están desbloqueados.",
  "university.revokeReasonLabel": "Por qué se revoca el acceso",
  "university.revokeReasonHint": "Se conserva con el registro y en el rastro de auditoría.",
  "university.revoke": "Revocar acceso",
  "university.revoking": "Revocando…",
  "university.revoked": "Acceso revocado. Los cursos del consultorio vuelven a estar bloqueados.",
  "errors.universityFormInvalid": "Revise el formulario e inténtelo de nuevo.",
  "errors.universityRevokeReasonTooShort": "Indique un motivo de al menos cinco caracteres.",
  "errors.universityNotGranted": "Este consultorio no tiene acceso que revocar.",
  "errors.universityAlreadyGranted":
    "Este consultorio ya tiene acceso. Vuelva a cargar la página para verlo.",
  "integrations.link": "Aprobación de integraciones",
  "integrations.metaTitle": "Aprobación de integraciones",
  "integrations.title": "Aprobación de integraciones",
  "integrations.description":
    "Conexiones reales de EHR/PM que enviaron los consultorios. Verifique cada una con el administrador de EHR del consultorio, fuera de DenialDesk, antes de aprobarla. Solo configuración; sin datos de pacientes.",
  "integrations.panelTitle": "Pendientes de aprobación",
  "integrations.tableCaption": "Conexiones pendientes de aprobación",
  "integrations.empty": "No hay conexiones pendientes de aprobación.",
  "integrations.columns.name": "Conexión",
  "integrations.columns.baseUrl": "URL base",
  "integrations.columns.clientId": "ID de cliente",
  "integrations.columns.submitted": "Enviada",
  "integrations.review": "Revisar",
  "integrations.practiceTitle": "Conexiones de EHR/PM pendientes de aprobación",
  "integrations.practiceDescription":
    "Enviadas por los administradores de este consultorio. Revise la configuración, verifíquela fuera de DenialDesk y luego apruébela o recházela.",
  "integrations.practiceEmpty": "Ninguna conexión de este consultorio está pendiente de aprobación.",
  "integrations.reviewMetaTitle": "Revisar conexión",
  "integrations.reviewTitle": "Revisar conexión",
  "integrations.reviewDescription": "Consultorio: {practice}. No se sincroniza nada hasta que apruebe.",
  "integrations.config.title": "Configuración",
  "integrations.config.description":
    "Exactamente lo que envió el consultorio. Compruebe cada valor con el administrador de EHR del consultorio.",
  "integrations.field.name": "Nombre de la conexión",
  "integrations.field.baseUrl": "URL base",
  "integrations.field.tokenEndpoint": "Punto de conexión de tokens",
  "integrations.field.issuer": "Emisor",
  "integrations.field.clientId": "ID de cliente",
  "integrations.field.mrnSystem": "Sistema de identificadores de MRN",
  "integrations.field.jwks": "Dirección de la clave pública (JWKS)",
  "integrations.field.jwksHint":
    "Es una ruta en este sitio. Dé la dirección completa al administrador de EHR del consultorio.",
  "integrations.field.keyMode": "Modo de clave",
  "integrations.field.scope": "Alcance de la población",
  "integrations.field.submitted": "Enviada",
  "integrations.field.attested": "Residencia en EE. UU. confirmada",
  "integrations.field.notDiscovered": "No detectado",
  "integrations.keyMode.unassigned": "Aún sin asignar",
  "integrations.keyMode.per_connection": "Una clave por conexión",
  "integrations.keyMode.shared_vendor_exception": "Clave compartida (excepción del proveedor)",
  "integrations.keyMode.preprod_shared": "Clave compartida de preproducción",
  "integrations.scope.unset": "Lo define usted al aprobar",
  "integrations.approve.title": "Aprobar",
  "integrations.approve.description":
    "Al aprobar, se sincronizan los pacientes de este consultorio. Apruebe solo después de verificar la configuración con el administrador de EHR del consultorio, fuera de DenialDesk.",
  "integrations.choose": "Elija…",
  "integrations.approve.methodLabel": "Cómo lo verificó",
  "integrations.approve.dateLabel": "Fecha de la verificación",
  "integrations.approve.dateHint":
    "No puede ser futura ni anterior al día en que el consultorio envió la conexión.",
  "integrations.approve.roleLabel": "Cargo del contacto en el consultorio",
  "integrations.approve.roleHint": "Solo el cargo, nunca un nombre.",
  "integrations.approve.scopeLabel": "Alcance de la población",
  "integrations.approve.scopeHint":
    "Limita la sincronización a los pacientes propios de este consultorio. Por ahora solo se puede aprobar una exportación de Group: un filtro de búsqueda verificado aún no tiene dónde registrarse.",
  "integrations.approve.nineDigitsLabel": "Los MRN contienen un número de nueve dígitos (verificado)",
  "integrations.approve.nineDigitsHint":
    "Opcional. Márquelo solo si el consultorio confirmó que sus MRN reales contienen un número de nueve dígitos; de lo contrario, esos MRN se rechazan por parecerse a un número de Seguro Social.",
  "integrations.approve.ownershipLabel":
    "Verifiqué, fuera de DenialDesk, que este consultorio es titular del ID de cliente {clientId}",
  "integrations.approve.ownershipHint":
    "El consultorio lo registró en su propio EHR/PM, no otra organización. La clave de firma por sí sola no lo demuestra.",
  "integrations.approve.submit": "Aprobar conexión",
  "integrations.approve.pending": "Aprobando…",
  "integrations.approve.done": "Aprobada. La conexión está activa.",
  "integrations.reject.title": "Rechazar",
  "integrations.reject.description":
    "Devuelve la conexión al consultorio como borrador y libera su reserva del punto de conexión. El consultorio ve el motivo y puede corregirla y enviarla de nuevo.",
  "integrations.reject.reasonLabel": "Motivo",
  "integrations.reject.submit": "Rechazar conexión",
  "integrations.reject.pending": "Rechazando…",
  "integrations.reject.done": "Rechazada. La conexión vuelve a ser un borrador.",
  "integrations.method.phone_callback": "Llamada a un número registrado",
  "integrations.method.video_call": "Videollamada con el administrador de EHR/PM",
  "integrations.method.written_confirmation":
    "Confirmación escrita desde la dirección verificada del administrador",
  "integrations.method.vendor_portal": "Confirmado en el registro de aplicaciones del proveedor de EHR/PM",
  "integrations.role.ehr_administrator": "Administrador de EHR/PM",
  "integrations.role.practice_administrator": "Administrador del consultorio",
  "integrations.role.it_contact": "Contacto de TI del consultorio",
  "integrations.role.vendor_representative": "Representante del proveedor de EHR/PM",
  "integrations.role.other": "Otro",
  "integrations.scope.group_export": "Exportación de Group (el Group del propio consultorio)",
  "integrations.scope.verified_filter": "Filtro de búsqueda verificado",
  "errors.integrationNotOperator": "Solo el operador de la plataforma puede decidir sobre una conexión.",
  "errors.approvalFormInvalid": "Elija cómo se verificó, el cargo del contacto y el alcance de la población.",
  "errors.approvalDateInvalid": "Indique la fecha en que lo verificó. No puede ser futura.",
  "errors.approvalOwnershipRequired":
    "Confirme que verificó, fuera de DenialDesk, que el consultorio es titular de este ID de cliente.",
  "errors.rejectReasonRequired": "Elija un motivo.",
  "errors.integrationNotFound": "Esta conexión no está pendiente de aprobación para este consultorio.",
  "errors.integrationNotPending":
    "Esta conexión ya no está pendiente de aprobación. Vuelva a cargar la página.",
  "errors.integrationStale":
    "Esta conexión cambió desde que la abrió. Vuelva a cargar la página y revise de nuevo la configuración.",
  "errors.integrationNotClaimed":
    "El registro del punto de conexión de esta conexión ya no coincide con su configuración. No se puede aprobar; rechácela.",
  "errors.integrationPracticeSuspended":
    "Este consultorio está suspendido. Reactívelo antes de aprobar una conexión.",
  "integrations.scope.verified_filter_unavailable": "Filtro de búsqueda verificado (aún no disponible)",
  "errors.approvalScopeUnsupported":
    "Un filtro de búsqueda verificado aún no tiene dónde registrarse, así que solo se puede aprobar una exportación de Group.",
  "errors.integrationRealEndpointRefused":
    "En este entorno no se pueden aprobar conexiones reales de EHR: solo contiene datos sintéticos.",
  "errors.approvalDateBeforeSubmission":
    "La fecha de verificación no puede ser anterior al día en que el consultorio envió la conexión ({date}).",
  "errors.approvalBaaRequired":
    "Este consultorio no tiene un Acuerdo de Asociado Comercial (BAA) vigente. Registre el acuerdo firmado en la página del consultorio antes de aprobar una conexión.",
  "integrations.rejectReason.endpoint_not_verified":
    "Punto de conexión no verificado con el administrador de EHR/PM",
  "integrations.rejectReason.client_id_not_verified":
    "ID de cliente no verificado con el administrador de EHR/PM",
  "integrations.rejectReason.contact_not_verified": "No se pudo contactar al administrador de EHR/PM",
  "integrations.rejectReason.population_not_scoped": "Población de pacientes no limitada al consultorio",
  "integrations.rejectReason.configuration_incorrect": "La configuración es incorrecta",
  "integrations.rejectReason.other": "Otro motivo",
};
