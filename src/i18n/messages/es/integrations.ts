import type { Messages } from "../types";

export const integrations: Messages["integrations"] = {
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
};
