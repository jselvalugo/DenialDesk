import type { Messages } from "../types";

export const welcome: Messages["welcome"] = {
  "meta.title": "Bienvenida",
  heading: "Bienvenido, {name}",
  intro:
    "DenialDesk sigue cada reclamación desde su presentación hasta el pago: clasifica las denegaciones, las prioriza por valor y plazo, y mantiene los plazos de Florida que determinan qué se puede recuperar todavía.",
  openQueue: "Abrir la cola de denegaciones",

  "howItWorks.title": "Cómo funciona DenialDesk",
  "howItWorks.description": "El recorrido de una reclamación por la plataforma",

  "step1.title": "Registrar la reclamación",
  "step1.body":
    "Las reclamaciones se guardan con sus líneas de servicio, códigos de diagnóstico y procedimiento, el pagador y el plazo de presentación que les corresponde.",
  "step1.link": "Reclamaciones",
  "step2.title": "Clasificar la denegación",
  "step2.body":
    "Cada denegación se interpreta por sus códigos de motivo CARC y RARC y se agrupa en una categoría que señala la solución más probable.",
  "step2.link": "Denegaciones",
  "step3.title": "Trabajar primero lo que más importa",
  "step3.body":
    "La cola ordena las denegaciones abiertas por plazo de apelación o monto en juego, con plazos calculados a partir de reglas de Florida y del pagador con control de versión.",
  "step3.link": "Cola de denegaciones",
  "step4.title": "Apelar con aprobación",
  "step4.body":
    "Las apelaciones se redactan a partir de la denegación y el registro de la reclamación. Ningún código de procedimiento o diagnóstico cambia sin una aprobación humana registrada.",
  "step5.title": "Dar seguimiento al resultado",
  "step5.body":
    "Las recuperaciones, las bajas y los tiempos de respuesta de los pagadores se reportan para que el consultorio vea qué pagadores y motivos le cuestan más.",

  "recordFlow.title": "Del expediente del paciente a la reclamación y la denegación",
  "recordFlow.description":
    "Cómo el expediente del paciente alimenta cada reclamación, y adónde regresa cada denegación",

  "record1.title": "Expediente del paciente",
  "record1.body":
    "El registro guarda los datos demográficos y la cobertura principal: pagador, plan e ID de miembro (cifrado). Cada reclamación se vincula al paciente y al pagador facturado, de modo que el expediente detrás de cada reclamación está a un clic de distancia.",
  "record1.link": "Pacientes",
  "record2.title": "Los cargos se convierten en reclamaciones",
  "record2.body":
    "Los cargos de su sistema de gestión de consultorio o EHR llegarán por archivo CSV y se convertirán en reclamaciones en borrador vinculadas al paciente y al pagador. No se planean conexiones directas con el EHR para el lanzamiento.",
  "record3.title": "Reclamación presentada y respondida",
  "record3.body":
    "Las reclamaciones se enviarán a la cámara de compensación como archivos 837P; las confirmaciones y las remesas 835 regresarán y se emparejarán con la reclamación.",
  "record4.title": "La denegación vuelve al expediente",
  "record4.body":
    "Cada denegación se vincula a su reclamación y a su paciente. El expediente del paciente enumera todas sus reclamaciones y denegaciones, para que un error de cobertura o de registro pueda encontrarse y corregirse ahí mismo.",
  "record4.link": "Expedientes de pacientes",

  "modules.title": "Sus módulos",
  "modules.description": "También disponibles desde el selector de módulos (Ctrl K)",

  "safeguards.title": "Salvaguardas",
  "safeguards.description": "Controles de seguridad y cumplimiento vigentes hoy",

  "safeguard1.title": "Los datos del consultorio se mantienen separados",
  "safeguard1.body": "Cada registro está delimitado a su consultorio en la capa de base de datos.",
  "safeguard2.title": "Cada acceso queda registrado",
  "safeguard2.body":
    "Las lecturas y los cambios a los datos del paciente se escriben en un registro de auditoría: quién, qué y cuándo.",
  "safeguard3.title": "Los plazos provienen de reglas citadas",
  "safeguard3.body":
    "Los plazos de presentación, pago puntual y apelación son reglas con control de versión y fecha de vigencia, con su fuente legal.",
  "safeguard4.title": "Las personas aprueban los cambios de codificación",
  "safeguard4.body":
    "Ningún código de procedimiento o diagnóstico se cambiará sin una aprobación humana registrada.",
  "safeguard5.title": "El inicio de sesión requiere un segundo factor",
  "safeguard5.body":
    "Cada cuenta del consultorio usa un código de autenticación, y las sesiones inactivas terminan a los 15 minutos.",
  "safeguard6.title": "Los identificadores están cifrados",
  "safeguard6.body":
    "Los ID de miembro se cifran campo por campo, y los nombres de los pacientes se mantienen fuera de las direcciones de página.",
  "safeguard7.title": "Acuerdos de asociado comercial en archivo",
  "safeguard7.body":
    "El acuerdo firmado de cada consultorio se registra con sus fechas y firmantes; se señala cuando falta uno.",
};
