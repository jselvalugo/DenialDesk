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
  "test.error.sandboxUnavailable": "El entorno de pruebas integrado todavía no se puede probar.",
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
    "No se puede enviar: requiere una prueba de conexión exitosa, y el entorno de pruebas integrado aún no se puede probar.",
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
};
