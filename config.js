/* =========================================================================
   CONFIG — AECODE Stand · AI Construction Summit 2026
   Edita SOLO este archivo para cambiar links, textos y opciones.
   No necesitas tocar el resto del código.
   ========================================================================= */

window.AECODE_CONFIG = {

  /* --- 1. A dónde se envían los datos del formulario -------------------
     Pega aquí la URL del Apps Script (Implementar → Aplicación web).
     Mientras esté vacía, el sitio funciona en "modo demo" (no guarda). */
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbxIW5FA02hyz474ooYSGsCR3ixGzH9Rdcw6I592sSSqINPVROA4ZIO90m3_DRMppWTpBA/exec",

  /* --- 2. Links de redes (los usa la pantalla final y el correo) ------- */
  LINKS: {
    beacons:     "https://beacons.ai/aecode.ai",
    instagram:   "https://www.instagram.com/aecode.ai/",
    wa_channel:  "https://whatsapp.com/channel/0029Vau1xW19mrGTLp43sU3o",
    wa_direct:   "https://wa.me/51900121245",
    linkedin:    "https://www.linkedin.com/company/aecode-ai",
    tiktok:      "https://www.tiktok.com/@aecode.ai",
    youtube:     "https://www.youtube.com/@aecode_ai",
    facebook:    "https://www.facebook.com/aecodeai/"
  },

  /* --- 3. Redirección automática al Beacons tras enviar ---------------- */
  REDIRECT: {
    enabled: true,          // true = redirige solo al Beacons
    delay_seconds: 6        // segundos que ve la pantalla de "¡Listo!" antes de redirigir
  },

  /* --- 4. Cargo o condición (select del formulario) ------------------- */
  CARGOS: [
    "Estudiante",
    "Docente",
    "Ingeniero(a)",
    "Emprendedor(a)",
    "Otro"
  ],

  /* --- 5. Intereses (casillas, mínimo 1) ------------------------------
     Edita libremente. Marca "grupo" para separarlos visualmente. */
  INTERESES: [
    { grupo: "Diplomados", items: [
      "Diplomado de IA aplicada a la Ingeniería y Construcción",
      "Diplomado BIM en Infraestructura Vial",
      "Diplomado BIM en Obras con LEAN & BI",
      "Diplomado BIM aplicado a Proyectos Hospitalarios",
      "Diplomado BIM aplicado a Colegios / Edificaciones Educativas",
      "Diplomado de Gestor BIM",
      "Especialización en Python para automatización (BIM/Revit)"
    ]},
    { grupo: "Oportunidades", items: [
      "Ser colaborador de AECODE más adelante",
      "Ser parte de la BECA AI TALENT para estudiantes",
      "Tener una alianza con mi empresa",
      "Recibir una capacitación corporativa",
      "Ser sponsor del próximo Summit",
      "Proponer una iniciativa en AECODE próximamente",
      "Investigación en AECODE",
      "Ser embajador de AECODE"
    ]}
  ],

  /* Permitir opción "Otro" con texto libre en intereses */
  INTERES_OTRO: true
};
