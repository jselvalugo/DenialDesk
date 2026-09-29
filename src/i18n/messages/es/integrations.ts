import type { Messages } from "../types";

export const integrations: Messages["integrations"] = {
  "meta.title": "Integraciones",
  "list.panelTitle": "Conexiones con EHR/PM",
  "list.panelDescription":
    "Conecte su sistema EHR o de gestión de consultorio para que el Registro de pacientes se sincronice desde él. Solo configuración: aquí no aparece información de pacientes.",
  "list.newConnection": "Nueva conexión",
  "list.emptyTitle": "Todavía no hay conexión con un EHR/PM",
  "list.emptyDescriptionAdmin":
    "Cree una conexión para sincronizar el Registro de pacientes desde su EHR/PM. Hasta entonces, el personal registra a los pacientes a mano.",
  "list.emptyDescriptionReadOnly":
    "Un administrador puede conectar su EHR/PM. Hasta entonces, el personal registra a los pacientes a mano.",
  "list.tableCaption": "Conexiones con EHR/PM",
  "list.name": "Nombre",
  "list.source": "Origen",
  "list.lastSync": "Última sincronización correcta",
  "list.created": "Creada",
  "list.never": "Nunca",
  "source.sandbox": "Entorno de prueba integrado",
  "source.fhir": "EHR/PM (FHIR R4)",
  "target.patients": "Registro de pacientes",
  "status.draft": "Borrador",
  "status.pending_approval": "Pendiente de aprobación",
  "status.active": "Activa",
  "status.paused": "En pausa",
  "status.error": "Requiere atención",
  "status.revoked": "Revocada",
  "new.metaTitle": "Nueva conexión",
  "new.title": "Nueva conexión con EHR/PM",
  "new.description":
    "Una conexión nueva empieza como borrador. Guardarla no contacta al EHR/PM ni sincroniza ningún paciente.",
  "new.sandboxNotice":
    "Este entorno usa solo datos sintéticos, así que se conecta al entorno de prueba integrado, nunca a un EHR/PM real.",
  "new.create": "Crear conexión",
  "new.creating": "Creando…",
  "form.displayName": "Nombre de la conexión",
  "form.displayNameHint": "Se muestra junto a la pestaña Pacientes. No incluya información de pacientes.",
  "form.baseUrl": "URL base de FHIR",
  "form.baseUrlHint":
    "Tomada de la documentación FHIR de su EHR/PM, por ejemplo https://fhir.example.com/r4.",
  "form.clientId": "ID de cliente",
  "form.clientIdHint": "El ID que el administrador de su EHR/PM registró para DenialDesk.",
  "form.mrnSystem": "Sistema de identificadores de MRN",
  "form.mrnSystemHint":
    "El sistema de identificadores que usa su EHR/PM para los números de historia clínica, como URL o urn:oid. Nunca un sistema de Seguro Social, Medicare, licencia de conducir o pasaporte.",
  "form.endpointLockedHint":
    "La URL, el ID de cliente y el sistema de identificadores quedan fijos una vez que la conexión se envía o se sincroniza. Para usar otro extremo, revoque esta conexión y cree una nueva.",
  "form.save": "Guardar cambios",
  "form.saving": "Guardando…",
  "detail.metaTitle": "Conexión",
  "detail.configurationTitle": "Configuración",
  "detail.configurationDescription": "Lo que DenialDesk usa para llegar a su EHR/PM.",
  "detail.status": "Estado",
  "detail.source": "Origen",
  "detail.target": "Sincroniza con",
  "detail.tokenEndpoint": "Extremo de token",
  "detail.issuer": "Emisor",
  "detail.notDiscovered": "Se obtiene al probar la conexión",
  "detail.created": "Creada",
  "detail.submitted": "Enviada",
  "detail.approved": "Aprobada",
  "detail.revokedAt": "Revocada",
  "detail.lastSync": "Última sincronización correcta",
  "detail.editTitle": "Editar conexión",
  "detail.editDescription": "Los cambios quedan registrados en el registro de auditoría.",
  "revoke.title": "Revocar conexión",
  "revoke.description":
    "Revocar es permanente: DenialDesk deja de usar esta conexión y no se puede reactivar. Para conectarse de nuevo, cree una conexión nueva.",
  "revoke.reason": "Motivo",
  "revoke.reasonHint":
    "Queda registrado en el registro de auditoría. No incluya información de pacientes en ningún campo.",
  "revoke.reasonPlaceholder": "Elija un motivo",
  "revoke.reason.no_longer_used": "Ya no usamos esta conexión",
  "revoke.reason.switching_systems": "Estamos cambiando de sistema EHR/PM",
  "revoke.reason.configured_in_error": "Se configuró por error",
  "revoke.reason.security_concern": "Preocupación de seguridad",
  "revoke.reason.other": "Otro",
  "revoke.confirm": "Entiendo que revocar esta conexión es permanente.",
  "revoke.submit": "Revocar conexión",
  "revoke.pending": "Revocando…",
  "lifecycle.title": "Sincronización",
  "lifecycle.active":
    "Pausar detiene la sincronización de pacientes desde esta conexión. No se elimina nada y puede reanudarla más tarde.",
  "lifecycle.paused":
    "La sincronización está en pausa. Reanudarla la reinicia y requiere que antes verifique su identidad con su aplicación autenticadora.",
  "lifecycle.error":
    "DenialDesk dejó de sincronizar por un error. Cuando el administrador de su EHR/PM lo haya resuelto, ejecute Probar conexión y obtenga una prueba exitosa, y luego reanude. Reanudar también requiere que antes verifique su identidad con su aplicación autenticadora.",
  "detail.repeatedFailuresNotice":
    "Las últimas tres sincronizaciones seguidas fallaron, por lo que DenialDesk dejó de sincronizar esta conexión. Abra el Historial de sincronización para ver el motivo, corrija la causa, ejecute Probar conexión y obtenga una prueba exitosa, y luego reanude.",
  "lifecycle.pending_approval":
    "Esta conexión está esperando aprobación. Retirarla la devuelve a un borrador que puede editar y volver a enviar.",
  "pause.submit": "Pausar sincronización",
  "pause.pending": "Pausando…",
  "resume.submit": "Reanudar sincronización",
  "resume.pending": "Reanudando…",
  "withdraw.submit": "Retirar envío",
  "withdraw.pending": "Retirando…",
  "stepUp.link": "Verificar mi identidad",
  "offboarding.title": "Pasos de desconexión",
  "offboarding.description": "Complételos con el administrador de su EHR/PM después de revocar:",
  "offboarding.step1":
    "Elimine o desactive el registro de cliente de DenialDesk (ID de cliente {clientId}) en el EHR/PM.",
  "offboarding.step2": "Elimine cualquier clave pública de DenialDesk registrada en el EHR/PM.",
  "offboarding.step3":
    "Los pacientes ya sincronizados se quedan en DenialDesk como registros de solo lectura y dejan de actualizarse: las correcciones hechas en el EHR/PM no llegarán a DenialDesk.",
  "offboarding.step4": "Anote quién en el consultorio confirmó que se eliminó el registro, y cuándo.",
  "offboarding.revokedNotice":
    "Revocada el {date}. Complete los pasos de desconexión de abajo si aún no lo ha hecho.",
  "error.saveFailed": "No se pudo guardar la conexión. Vuelva a cargar la página e inténtelo de nuevo.",
  "error.confirmRevoke": "Marque la casilla para confirmar que entiende que revocar es permanente.",
  "error.revokeReasonRequired": "Elija por qué revoca esta conexión.",
  "error.stepUpRequired":
    "Esto requiere una verificación en dos pasos reciente. Verifique su identidad e inténtelo de nuevo.",
  "error.invalidTransition": "Esta conexión no está en un estado que lo permita. Recargue la página.",
  "error.notAdmin": "Solo un administrador puede gestionar las integraciones.",
  "error.notFound": "No se encontró la integración.",
  "error.stale": "Esta conexión cambió desde que la abrió. Vuelva a cargar la página e inténtelo de nuevo.",
  "error.revoked": "Esta conexión está revocada y ya no puede cambiar.",
  "error.unexpectedField":
    "El formulario envió un campo no permitido. Vuelva a cargar la página e inténtelo de nuevo.",
  "error.displayNameRequired": "Escriba un nombre para esta conexión.",
  "error.displayNameTooLong": "El nombre debe tener 80 caracteres o menos.",
  "error.displayNameInvalid": "El nombre no puede contener caracteres de control.",
  "error.clientIdRequired": "Escriba el ID de cliente que el EHR/PM asignó a DenialDesk.",
  "error.clientIdInvalid": "El ID de cliente solo admite caracteres visibles sin espacios, hasta 255.",
  "error.url.invalid": "Escriba la URL base de FHIR, por ejemplo https://fhir.example.com/r4.",
  "error.url.too_long": "La URL es demasiado larga.",
  "error.url.not_https": "La URL debe empezar por https://.",
  "error.url.credentials": "Quite el usuario o la contraseña de la URL.",
  "error.url.query_or_fragment": "Quite de la URL la parte que sigue a ? o #.",
  "error.url.ip_literal": "Use el nombre de host del servidor, no una dirección IP.",
  "error.url.reserved_host":
    "Este nombre de host solo funciona en una red privada. Use el nombre de host público del EHR/PM.",
  "error.url.single_label": "Use el nombre de host completo, con su dominio (por ejemplo fhir.example.com).",
  "error.url.trailing_dot": "Quite el punto al final del nombre de host.",
  "error.url.port_not_allowed": "Este puerto no está permitido. Use el puerto HTTPS estándar (443).",
  "error.url.path_characters":
    "La ruta de la URL solo admite letras, dígitos y - . _ ~ /. Copie la URL base tal como la documenta el EHR/PM.",
  "error.url.sandbox": "Para usar el entorno de prueba integrado, elíjalo al crear la conexión.",
  "error.realEndpointRefused":
    "Este entorno usa solo datos sintéticos, así que no puede conectarse a un EHR/PM real. Use el entorno de prueba integrado.",
  "error.sandboxRefused": "El entorno de prueba integrado no está disponible en producción.",
  "error.mrnSystem.invalid":
    "Escriba el sistema de identificadores que usa el EHR/PM para los números de historia clínica, como URL o urn:oid.",
  "error.mrnSystem.too_long": "El sistema de identificadores es demasiado largo.",
  "error.mrnSystem.government_identifier":
    "Ese sistema es un número de Seguro Social, Medicare, licencia de conducir o pasaporte, no un número de historia clínica.",
  "error.endpointLocked":
    "La URL, el ID de cliente y el sistema de identificadores solo pueden cambiar mientras la conexión sea un borrador que nunca se ha sincronizado.",
  "test.outcome.ok":
    "La prueba fue exitosa. DenialDesk llegó al servidor, encontró su punto de inicio de sesión y recibió un token de acceso. No se solicitó información de pacientes.",
  "test.outcome.unreachable":
    "DenialDesk no pudo comunicarse con el servidor. Revise la URL base y que el servidor esté abierto a internet y no bloqueado por un firewall. Inténtelo de nuevo en unos minutos.",
  "test.outcome.tls_failed":
    "No se pudo verificar la conexión segura (TLS) del servidor. Su certificado debe ser válido, emitido por una autoridad pública y coincidir con el nombre del host, y el servidor debe admitir TLS 1.2 o posterior.",
  "test.outcome.not_fhir_r4":
    "El servidor no respondió como FHIR R4 (versión 4.0.1). Compruebe que la URL base sea el punto de acceso FHIR R4.",
  "test.outcome.smart_config_invalid":
    "La configuración SMART del servidor falta o no se puede usar. DenialDesk necesita SMART Backend Services con JWT de clave privada firmado con ES384 o RS384.",
  "test.outcome.auth_refused":
    "El servidor rechazó las credenciales de DenialDesk. Revise el ID de cliente y que el administrador del EHR/PM haya registrado la clave pública de DenialDesk para este cliente.",
  "test.outcome.capability_missing":
    "El servidor no puede hacer lo que DenialDesk necesita: buscar Patient por fecha de última actualización, buscar Coverage por paciente y conceder acceso de lectura a Patient, Coverage y Organization.",
  "test.error.rateLimited": "Demasiadas pruebas de conexión. Espere unos minutos e inténtelo de nuevo.",
  "test.error.keyNotConfigured":
    "La clave de firma de DenialDesk no está configurada en este entorno, por lo que no se pueden probar las conexiones. Pida al operador de la plataforma que la configure.",
  "test.error.keyUnavailable":
    "La clave de firma de DenialDesk no se puede usar en este momento. Pida al operador de la plataforma que la revise.",
  "test.error.sandboxUnavailable": "El entorno de pruebas integrado no está disponible en este entorno.",
  "test.error.failed": "No se pudo completar la prueba. Recargue la página e inténtelo de nuevo.",
  "test.title": "Probar conexión",
  "test.description":
    "Comprueba que DenialDesk puede comunicarse con el servidor, leer su configuración SMART y obtener un token de acceso. No se solicita información de pacientes.",
  "test.submit": "Probar conexión",
  "test.pending": "Probando…",
  "test.resultOk": "Prueba exitosa",
  "test.resultFailed": "Prueba fallida",
  "submit.title": "Enviar conexión",
  "submit.descriptionReal":
    "Al enviar, esta conexión llega a DenialDesk para su aprobación. Nada se sincroniza hasta que se apruebe, y puede retirar el envío hasta entonces. Requiere una prueba de conexión exitosa, su confirmación a continuación y una verificación de identidad reciente.",
  "submit.descriptionSandbox":
    "El entorno de pruebas integrado solo contiene datos sintéticos, por lo que no requiere aprobación: al enviarlo se activa. Requiere una prueba de conexión exitosa y una verificación de identidad reciente.",
  "submit.attestation":
    "Este punto de conexión de EHR/PM almacena y procesa los datos únicamente en Estados Unidos",
  "submit.attestationHint": "Se registra en el registro de auditoría con su nombre y la fecha.",
  "submit.stepUpNotice": "Para enviar, primero debe verificar su identidad con su aplicación autenticadora.",
  "submit.blocked.noPassingTest":
    "No se puede enviar: esta conexión no tiene una prueba de conexión exitosa de las últimas 24 horas. Ejecute Probar conexión arriba. Una prueba fallida, o un cambio en la conexión o en la clave de firma de DenialDesk, requiere una nueva prueba exitosa.",
  "submit.blocked.sandbox":
    "No se puede enviar: el entorno de pruebas integrado también necesita una prueba de conexión exitosa de las últimas 24 horas. Ejecute Probar conexión arriba. Una prueba fallida, o un cambio en la clave de firma de DenialDesk, requiere una nueva prueba exitosa.",
  "submit.submit": "Enviar para aprobación",
  "submit.submitSandbox": "Activar entorno de pruebas",
  "submit.pending": "Enviando…",
  "submit.awaitingTitle": "Esperando la aprobación de DenialDesk",
  "submit.awaitingDescription":
    "DenialDesk revisa cada conexión real antes de que empiece a sincronizar. Nada se sincroniza hasta que se apruebe. Para cambiar la conexión antes, retire el envío.",
  "error.testRequired":
    "Primero debe pasar la prueba de conexión. Una prueba exitosa vale 24 horas, y solo para la configuración y la clave de firma que probó. Ejecútela de nuevo y luego envíe.",
  "error.testRequiredToResume":
    "Esta conexión se detuvo por un error. Ejecute Probar conexión y obtenga una prueba exitosa antes de reanudar.",
  "error.attestationRequired":
    "Confirme que el punto de conexión almacena y procesa los datos únicamente en Estados Unidos.",
  "error.registryConflict": "Este punto de conexión y este ID de cliente ya están conectados",
  "error.localeChanged":
    "El idioma de la página cambió desde que la abrió. Recargue la página, lea de nuevo la confirmación y envíe.",
  "error.submitRateLimited": "Demasiados intentos de envío. Espere unos minutos e inténtelo de nuevo.",
  "error.attestationChanged":
    "El texto de la confirmación cambió desde que abrió la página. Recargue la página, lea la confirmación de nuevo y envíe.",
  "error.anotherConnectionLive":
    "Ya hay otra conexión en uso (enviada, activa, en pausa o con error). Retírela o revóquela primero.",
  "rejected.notice.endpoint_not_verified":
    "DenialDesk no aprobó esta conexión: no se pudo verificar el punto de conexión con su administrador de EHR/PM. Corríjala, ejecute Probar conexión y envíela de nuevo.",
  "rejected.notice.client_id_not_verified":
    "DenialDesk no aprobó esta conexión: no se pudo verificar el ID de cliente con su administrador de EHR/PM. Corríjala, ejecute Probar conexión y envíela de nuevo.",
  "rejected.notice.contact_not_verified":
    "DenialDesk no aprobó esta conexión: no se pudo contactar a su administrador de EHR/PM para confirmarla. Corríjala si hace falta, ejecute Probar conexión y envíela de nuevo.",
  "rejected.notice.population_not_scoped":
    "DenialDesk no aprobó esta conexión: los pacientes a sincronizar no se limitaron a su consultorio. Corríjala, ejecute Probar conexión y envíela de nuevo.",
  "rejected.notice.configuration_incorrect":
    "DenialDesk no aprobó esta conexión: la configuración es incorrecta. Corríjala, ejecute Probar conexión y envíela de nuevo.",
  "rejected.notice.other":
    "DenialDesk no aprobó esta conexión. DenialDesk se pondrá en contacto con usted para explicar el motivo. Cuando se resuelva, ejecute Probar conexión y envíela de nuevo.",
  "sync.title": "Sincronizar ahora",
  "sync.description":
    "Trae ahora los últimos cambios de pacientes del EHR/PM conectado. Cuando la sincronización en segundo plano está configurada en este entorno, también se ejecuta sola según un horario (aproximadamente cada 15 minutos). El resultado aparece aquí o, cuando la sincronización se ejecuta en segundo plano, en el historial de sincronización. Los pacientes son copias de solo lectura: corrija los datos demográficos en el EHR/PM.",
  "sync.submit": "Sincronizar ahora",
  "sync.pending": "Sincronizando…",
  "sync.resultOk": "Sincronización terminada",
  "sync.resultFailed": "Sincronización detenida",
  "sync.result.succeeded":
    "{created} nuevos, {updated} actualizados, {linked} vinculados a pacientes existentes, {skipped} omitidos. Los registros omitidos y sus motivos se conservan con la ejecución de la sincronización.",
  "sync.result.abandoned":
    "La sincronización se detuvo porque la conexión se pausó, se revocó o pasó a error mientras se ejecutaba. Los pacientes ya guardados se conservaron.",
  "sync.resultQueued": "Sincronización en cola",
  "sync.result.queued":
    "La sincronización quedó en cola y se ejecuta en segundo plano. Su resultado aparecerá en el historial de sincronización en un momento.",
  "sync.error.notActive": "Solo una conexión activa puede sincronizar. Reanúdela primero.",
  "sync.error.rateLimited":
    "Sincronizar ahora se puede ejecutar una vez por minuto. Espere un momento e inténtelo de nuevo.",
  "sync.error.alreadyRunning": "Ya hay una sincronización en curso para esta conexión.",
  "sync.error.failed": "No se pudo completar la sincronización. Recargue la página e inténtelo de nuevo.",
  "sync.error.notQueued": "No se pudo iniciar la sincronización. Inténtelo de nuevo en un momento.",
  "sync.failure.auth_refused":
    "El EHR/PM rechazó las credenciales de DenialDesk, por lo que la conexión ahora requiere atención. Cuando el administrador del EHR/PM lo haya resuelto, ejecute Probar conexión y reanude.",
  "sync.failure.token_endpoint_changed":
    "El endpoint de inicio de sesión del EHR/PM cambió, por lo que la conexión ahora requiere atención. Un endpoint distinto es una conexión nueva.",
  "sync.failure.issuer_mismatch":
    "El servidor ya no se identifica como el sistema para el que se aprobó esta conexión, por lo que no se sincronizó nada. Comuníquese con el soporte de DenialDesk.",
  "sync.failure.not_synthetic":
    "Los datos no llevaban la marca sintética, y este entorno solo acepta datos sintéticos. No se guardó nada.",
  "sync.failure.environment_refused": "Esta conexión no puede sincronizar en este entorno.",
  "sync.failure.signing_key_unavailable":
    "La clave de firma de DenialDesk no se puede usar en este momento. Pida al operador de la plataforma que la revise.",
  "sync.failure.unreachable":
    "DenialDesk no pudo comunicarse con el EHR/PM, o tardó demasiado. No se perdió nada. Inténtelo de nuevo en unos minutos.",
  "sync.failure.bad_response":
    "El EHR/PM envió una respuesta que DenialDesk no pudo usar. No se guardó nada más. Ejecute Probar conexión para revisar la configuración.",
  "sync.failure.capability_missing":
    "El EHR/PM no puede hacer una búsqueda que DenialDesk necesita. Ejecute Probar conexión para revisar la configuración.",
  "sync.failure.too_large":
    "El EHR/PM envió más datos de los que acepta una sincronización. Los pacientes guardados hasta ahora se conservaron; inténtelo de nuevo.",
  "sync.failure.other":
    "La sincronización se detuvo por un problema inesperado. Inténtelo de nuevo y comuníquese con el soporte de DenialDesk si se repite.",
  "detail.moreTitle": "Pagadores e historial de sincronización",
  "detail.moreDescription":
    "Lo que DenialDesk leyó de esta conexión y cómo se asocian las aseguradoras con sus pagadores.",
  "detail.payersLink": "Asignación de pagadores",
  "detail.payersHint": "Asocie cada aseguradora que informa su EHR/PM con uno de sus pagadores.",
  "detail.runsLink": "Historial de sincronización",
  "detail.runsHint": "Recuentos y códigos de incidencia de cada sincronización.",
  "payers.metaTitle": "Asignación de pagadores",
  "payers.title": "Asignación de pagadores",
  "payers.description":
    "Asocie cada aseguradora que informa su EHR/PM con uno de sus pagadores. DenialDesk nunca lo adivina: la cobertura de un paciente sincronizado recibe un pagador solo mediante una asignación que usted guarde aquí, y solo cuando la sincronización actualice a continuación la cobertura de ese paciente. Mientras una aseguradora no esté asignada, sus pacientes no tienen pagador ni plazos del pagador.",
  "payers.crumb": "Asignación de pagadores",
  "payers.tableCaption": "Aseguradoras informadas por el EHR/PM, con el pagador al que se asocia cada una",
  "payers.col.insurer": "Aseguradora (clave del EHR/PM)",
  "payers.col.name": "Nombre en el EHR/PM",
  "payers.col.patients": "Pacientes",
  "payers.col.status": "Estado",
  "payers.col.payer": "Pagador de DenialDesk",
  "payers.status.mapped": "Asignada",
  "payers.status.unmapped": "Sin asignar",
  "payers.notMapped": "Sin asignar",
  "payers.selectLabel": "Pagador para la aseguradora {insurer}",
  "payers.emptyTitle": "Aún no hay aseguradoras que asignar",
  "payers.emptyDescription":
    "Las aseguradoras aparecen aquí cuando una sincronización lee la cobertura de los pacientes desde el EHR/PM. Antes de eso no hay nada que asignar.",
  "payers.noPayersTitle": "No hay pagadores a los que asignar",
  "payers.noPayersDescription":
    "Agregue sus pagadores en Configuración, Pagadores, y vuelva aquí para asignar las aseguradoras.",
  "payers.stepUpNotice":
    "Guardar una asignación requiere que primero verifique su identidad con su aplicación de autenticación.",
  "payers.save": "Guardar asignaciones",
  "payers.saving": "Guardando…",
  "payers.saved":
    "{count, plural, one {Se guardó # asignación.} other {Se guardaron # asignaciones.}} Los pacientes reciben el pagador cuando la sincronización actualice a continuación su cobertura. El cambio queda registrado en el registro de auditoría.",
  "payers.nothingChanged": "Nada cambió: ninguna asignación era distinta de la guardada.",
  "payers.revokedNotice": "Esta conexión está revocada, por lo que sus asignaciones ya no pueden cambiar.",
  "payers.truncated": "Se muestran las primeras {count} aseguradoras.",
  "error.payerUnknown": "Elija uno de sus propios pagadores, o deje la aseguradora sin asignar.",
  "error.payerKeyUnknown":
    "Esta conexión no ha informado esa aseguradora. Vuelva a cargar la página e inténtelo de nuevo.",
  "error.payersStale":
    "Una asignación cambió desde que abrió esta página. Vuelva a cargar la página e inténtelo de nuevo.",
  "error.payersTooMany":
    "Hay demasiadas aseguradoras para guardar a la vez. Vuelva a cargar la página e inténtelo de nuevo.",
  "runs.metaTitle": "Historial de sincronización",
  "runs.title": "Historial de sincronización",
  "runs.description":
    "Cada sincronización de esta conexión, la más reciente primero, como recuentos y códigos. Aquí no aparecen nombres ni identificadores.",
  "runs.crumb": "Historial de sincronización",
  "runs.tableCaption": "Sincronizaciones, la más reciente primero",
  "runs.col.queued": "En cola",
  "runs.col.trigger": "Iniciada por",
  "runs.col.status": "Estado",
  "runs.col.finished": "Finalizada",
  "runs.col.created": "Creados",
  "runs.col.updated": "Actualizados",
  "runs.col.linked": "Vinculados",
  "runs.col.skipped": "Omitidos",
  "runs.col.codes": "Códigos de incidencia",
  "runs.col.http": "Estado HTTP",
  "runs.col.issues": "Incidencias",
  "runs.trigger.manual": "Sincronizar ahora",
  "runs.trigger.scheduled": "Programación",
  "runs.status.queued": "En cola",
  "runs.status.running": "En curso",
  "runs.status.succeeded": "Correcta",
  "runs.status.failed": "Fallida",
  "runs.status.abandoned": "Abandonada",
  "runs.notFinished": "Sin finalizar",
  "runs.noCodes": "Ninguno",
  "runs.emptyTitle": "Aún no se ha ejecutado ninguna sincronización",
  "runs.emptyDescription":
    "Las sincronizaciones aparecen aquí cuando esta conexión está activa y se inicia una.",
  "runs.viewIssues": "Ver {count, plural, one {# incidencia} other {# incidencias}}",
  "runs.noIssues": "Ninguna",
  "runs.issues.title": "Incidencias de esta sincronización",
  "runs.issues.description":
    "Registros que la sincronización omitió o vinculó, por código. Abra un paciente para verlo en el Registro de pacientes.",
  "runs.issues.caption": "Incidencias registradas por esta sincronización",
  "runs.issues.code": "Código",
  "runs.issues.patient": "Paciente",
  "runs.issues.recorded": "Registrada",
  "runs.issues.openPatient": "Abrir paciente",
  "runs.issues.noPatient": "Sin paciente",
  "runs.issues.empty": "Esta sincronización no registró incidencias.",
  "runs.issues.truncated": "Se muestran las primeras {count} incidencias.",
  "runs.issues.notFound": "Esa sincronización no pertenece a esta conexión.",
  "runs.code.mrn_missing": "Sin número de historia clínica",
  "runs.code.mrn_ambiguous": "Más de un número de historia clínica",
  "runs.code.mrn_looks_like_ssn": "El número parece un número de Seguro Social",
  "runs.code.mrn_looks_like_mbi": "El número parece un número de Medicare",
  "runs.code.name_incomplete": "Nombre incompleto",
  "runs.code.birthdate_incomplete": "Fecha de nacimiento incompleta",
  "runs.code.address_incomplete": "Dirección incompleta",
  "runs.code.mrn_conflict": "Mismo número, distinta fecha de nacimiento",
  "runs.code.needs_review": "La cobertura necesita revisión",
  "runs.code.linked_to_source": "Vinculado a un paciente existente",
  "runs.code.issuer_mismatch": "El emisor del EHR/PM ya no coincide con esta conexión",
  "runs.code.not_synthetic": "Un registro no estaba marcado como dato sintético de prueba",
  "runs.code.paging_loop": "Las páginas de resultados del EHR/PM entraron en bucle",
  "runs.code.token_endpoint_changed": "Cambió el punto de acceso de tokens del EHR/PM",
  "runs.code.scope_insufficient": "El acceso concedido es demasiado limitado",
  "runs.code.invalid_client": "El EHR/PM no reconoce el ID de cliente",
  "runs.code.unreachable": "No se pudo contactar con el EHR/PM",
  "runs.code.tls_failed": "No se pudo verificar la conexión segura",
  "runs.code.smart_config_invalid": "La configuración SMART falta o no se puede usar",
  "runs.code.auth_refused": "El EHR/PM rechazó las credenciales de DenialDesk",
  "runs.code.capability_missing": "Al EHR/PM le falta una capacidad que DenialDesk necesita",
  "runs.code.internal_error": "DenialDesk tuvo un error interno",
  "runs.code.invalid": "El EHR/PM informó contenido no válido",
  "runs.code.security": "El EHR/PM informó un problema de seguridad",
  "runs.code.login": "El EHR/PM pidió iniciar sesión",
  "runs.code.forbidden": "El EHR/PM negó el acceso",
  "runs.code.expired": "El token de acceso venció",
  "runs.code.processing": "El EHR/PM no pudo procesar la solicitud",
  "runs.code.duplicate": "El EHR/PM informó un duplicado",
  "runs.code.conflict": "El EHR/PM informó un conflicto",
  "runs.code.transient": "Un problema temporal del EHR/PM",
  "runs.code.timeout": "El EHR/PM tardó demasiado en responder",
  "runs.code.throttled": "El EHR/PM limitó la frecuencia de solicitudes",
  "runs.code.exception": "El EHR/PM informó un error",
  "runs.code.incomplete": "La respuesta del EHR/PM estaba incompleta",
  "runs.code.informational": "El EHR/PM envió un aviso",
  "runs.code.unknown": "Un problema no especificado del EHR/PM",
  "runs.code.resource_invalid": "Un registro no era un paciente utilizable",
  "runs.code.id_invalid": "Un registro no tenía un identificador utilizable",
  "runs.code.mrn_invalid": "Número de registro no utilizable",
  "runs.code.mrn_government_identifier": "El número de registro es un identificador oficial",
  "runs.code.name_invalid": "Nombre no utilizable",
  "runs.code.birthdate_invalid": "Fecha de nacimiento no utilizable",
  "runs.code.review_required": "Revise a este paciente",
  "runs.code.address_refused": "Se rechazó la dirección del EHR/PM",
  "runs.code.redirect_refused": "El EHR/PM intentó redirigir la solicitud",
  "runs.code.content_type_refused": "El EHR/PM respondió en un formato inesperado",
  "runs.code.too_large": "El EHR/PM envió más datos de los que acepta una sincronización",
  "runs.code.bad_response": "El EHR/PM envió una respuesta que DenialDesk no pudo usar",
  "runs.code.not_fhir": "El servidor no respondió como FHIR R4",
  "runs.code.environment_refused": "Esta conexión no puede sincronizar en este entorno",
  "runs.code.signing_key_unavailable": "La clave de firma de DenialDesk no se pudo usar",
  "runs.code.connection_not_active": "La conexión no estaba activa",
  "runs.code.issues_truncated": "Solo se enumeran las primeras incidencias de esta ejecución",
  "runs.code.structure": "El EHR/PM informó un problema de estructura",
  "runs.code.required": "El EHR/PM informó que falta un elemento obligatorio",
  "runs.code.value": "El EHR/PM informó un valor incorrecto",
  "runs.code.invariant": "El EHR/PM informó una infracción de regla",
  "runs.code.suppressed": "El EHR/PM omitió parte del contenido",
  "runs.code.not_supported": "El EHR/PM no admite la solicitud",
  "runs.code.multiple_matches": "El EHR/PM encontró más de una coincidencia",
  "runs.code.not_found": "El EHR/PM no encontró lo solicitado",
  "runs.code.deleted": "El EHR/PM informó un registro eliminado",
  "runs.code.too_long": "El EHR/PM informó contenido demasiado largo",
  "runs.code.code_invalid": "El EHR/PM informó un código no válido",
  "runs.code.extension": "El EHR/PM informó una extensión no admitida",
  "runs.code.too_costly": "El EHR/PM rechazó una solicitud por ser demasiado costosa",
  "runs.code.business_rule": "El EHR/PM rechazó la solicitud por una regla de negocio",
  "runs.code.lock_error": "El EHR/PM informó un problema de bloqueo",
  "runs.code.no_store": "El EHR/PM no pudo almacenar la solicitud",
  "runs.code.other": "Otro",
  "payers.keyUnsupported":
    "La clave de esta aseguradora es demasiado larga o contiene caracteres ocultos, por lo que no se puede asignar aquí.",
  "runs.code.record_rejected": "Los propios límites del almacén de datos rechazaron un registro",
  "runs.code.population_scope_unenforced":
    "Todavía no se puede limitar la sincronización a los pacientes de su clínica",
  "sync.failure.population_scope_unenforced":
    "No se sincronizó nada. DenialDesk todavía no puede limitar una conexión real de EHR/PM a los pacientes de su clínica, por lo que las conexiones reales no sincronizan hasta que pueda. No se solicitó nada al EHR/PM.",
  "sync.error.populationScopeUnenforced":
    "Las conexiones reales de EHR/PM todavía no pueden sincronizar: DenialDesk todavía no puede limitarlas a los pacientes de su clínica. No se solicitó nada.",
};
