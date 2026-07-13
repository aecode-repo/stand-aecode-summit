/**
 * AECODE Stand · AI Construction Summit 2026 — Backend (Google Apps Script)
 * -------------------------------------------------------------------------
 * Qué hace:
 *   1) Recibe el formulario (doPost) y lo guarda en la pestaña "Leads".
 *   2) Envía un correo personalizado (textos editables en "Config_Correo").
 *   3) (Opcional) Empuja el lead a GHL vía webhook entrante.
 *
 * CÓMO INSTALAR (5 min):
 *   1. Abre tu Google Sheet → Extensiones → Apps Script.
 *   2. Pega este archivo. Guarda.
 *   3. Ejecuta la función  setupSheet   una vez (crea las 3 pestañas).
 *   4. Implementar → Nueva implementación → Aplicación web:
 *         - Ejecutar como:  Yo (coordinador@aecode.ai)
 *         - Acceso:         Cualquier persona
 *      Copia la URL y pégala en  config.js → APPS_SCRIPT_URL
 * ------------------------------------------------------------------------- */

/* ====== AJUSTES ====== */
// GHL vía API v2 (recomendado). Pega tu Private Integration Token (pit-...).
var GHL_TOKEN = "";                               // Vacío = no envía a GHL.
var GHL_LOCATION_ID = "T8ByMoOOq7hWWswablDhF";    // Sub-cuenta de AECODE (confirmar).
var GHL_TAG = "leads summit presencial";
// Alternativa: webhook entrante de GHL (si prefieres no usar token).
var GHL_WEBHOOK_URL = "";
var NOTIFY_TEAM_EMAIL = ""; // Correo interno para avisos de lead nuevo (opcional).

var TAB_LEADS    = "Leads";
var TAB_CONFIG   = "Config_Correo";
var TAB_RULETA   = "Inventario_Ruleta";
var TAB_OPCIONES = "Opciones_Form";   // diplomados/intereses editables por ventas
var OPCIONES_HEADERS = ["Orden", "Grupo", "Item", "Activo"];

var LEAD_HEADERS = [
  "Timestamp","Nombre","WhatsApp","Correo","Cargo/condición","¿Qué ganaste?",
  "Interés","Premio (código)","Estado reclamo","Correo enviado","Fuente","User agent"
];

/* =========================================================================
   doPost — recibe el formulario
   ========================================================================= */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_(TAB_LEADS, LEAD_HEADERS);

    var intereses = (data.intereses || []).join(" · ");
    var row = [
      new Date(), data.nombre || "", data.whatsapp || "", data.correo || "",
      data.cargo || "", data.premio || "", intereses, data.codigo || "",
      "Pendiente", "No", data.fuente || "leads summit presencial", data.user_agent || ""
    ];
    sheet.appendRow(row);
    var rowIndex = sheet.getLastRow();

    var sent = false;
    try { sendLeadEmail_(data); sent = true; } catch (err) { Logger.log("Email error: " + err); }
    sheet.getRange(rowIndex, 10).setValue(sent ? "Sí" : "Error"); // col "Correo enviado"

    try { if (GHL_TOKEN || GHL_WEBHOOK_URL) pushToGHL_(data); } catch (err) { Logger.log("GHL error: " + err); }
    try { if (NOTIFY_TEAM_EMAIL) notifyTeam_(data); } catch (err) {}

    return json_({ ok: true, codigo: data.codigo });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.list === "opciones") return json_({ ok: true, grupos: getOpciones_() });
  return json_({ ok: true, service: "AECODE Stand backend" });
}

/** Lee la pestaña Opciones_Form y devuelve [{grupo, items:[...]}] ordenado. */
function getOpciones_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_OPCIONES);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  rows = rows.filter(function (r) {
    return r[2] && String(r[3]).toUpperCase() !== "FALSE" && r[3] !== false;
  });
  rows.sort(function (a, b) { return (Number(a[0]) || 0) - (Number(b[0]) || 0); });
  var order = [], map = {};
  rows.forEach(function (r) {
    var g = String(r[1] || "").trim() || "Opciones";
    if (!map[g]) { map[g] = []; order.push(g); }
    map[g].push(String(r[2]).trim());
  });
  return order.map(function (g) { return { grupo: g, items: map[g] }; });
}

/* =========================================================================
   Correo personalizado
   ========================================================================= */
function sendLeadEmail_(data) {
  var cfg = getConfig_();
  var nombre = (data.nombre || "").split(" ")[0] || "hola";
  var intereses = data.intereses || [];

  // Clasificar lo que marcó: diplomados vs. otras iniciativas.
  var diplomaSet = getDiplomaSet_();
  var diplomas = intereses.filter(function (i) { return diplomaSet[i]; });
  var otros    = intereses.filter(function (i) { return !diplomaSet[i]; });

  var asunto = (cfg.asunto || "Gracias por visitarnos en el AI Construction Summit")
                 .replace("{nombre}", nombre);
  var descuento = cfg.descuento || "un descuento especial";

  var listaIntereses = intereses.length
    ? "<ul style='margin:8px 0 0;padding-left:18px;color:#33364d;line-height:1.7'>" +
        intereses.map(function (i) { return "<li>" + esc_(i) + "</li>"; }).join("") + "</ul>"
    : "";

  // Bloque de descuento (solo si marcó al menos un diplomado).
  var bloqueDiploma = diplomas.length ? (
    "<div style='margin:20px 0;padding:16px 18px;border-radius:12px;background:#F3EEFF;border:1px solid #E0D4FF'>" +
      "<p style='margin:0;color:#33364d'>Por estar en el stand de AECODE <b>te ganaste " +
        esc_(descuento) + " de descuento</b> en los diplomados que marcaste.</p>" +
      "<p style='margin:8px 0 0;color:#6b4bd6;font-weight:700'>Tienes 72 horas para reclamarlo " +
        "antes de que alguien más te lo gane.</p>" +
    "</div>"
  ) : "";

  // Bloque para otras iniciativas (colaborador, beca, alianza, etc.).
  var bloqueOtros = otros.length ? (
    "<p style='margin:16px 0 0;color:#33364d'>Sobre <b>" + esc_(listInline_(otros)) +
      "</b>, nos contactaremos contigo pronto.</p>"
  ) : "";

  // El botón de WhatsApp cambia según haya premio.
  var waLabel = diplomas.length ? "Reclama tu premio aquí" : "Escríbenos por WhatsApp";

  var body = [
    "<div style='font-family:Manrope,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a2e'>",
    "<div style='background:#191C32;border-radius:16px;padding:26px;text-align:center'>",
      "<h1 style='color:#fff;font-size:22px;margin:0'>", esc_(cfg.saludo || "Bienvenido a AECODE"), "</h1>",
      "<p style='color:#9193BB;margin:10px 0 0'>Hola <b style='color:#fff'>", esc_(nombre),
        "</b>, gracias por pasar por nuestro stand.</p>",
    "</div>",
    "<div style='padding:22px 6px'>",
      "<p style='color:#33364d'>", esc_(cfg.intro || "Aquí está todo lo que tenemos para ti — deslízalo con calma:"), "</p>",
      intereses.length ? "<p style='margin-top:14px;color:#33364d'><b>Marcaste interés en:</b></p>" + listaIntereses : "",
      bloqueDiploma,
      bloqueOtros,
      "<div style='margin:24px 0;text-align:center'>",
        btn_(cfg.link_beacons, "Mira todo lo de AECODE", "#7C28F8"),
        btn_(cfg.link_ig, "Síguenos en Instagram", "#E1306C"),
        btn_(cfg.link_wa, waLabel, "#25D366"),
      "</div>",
      "<p style='color:#6b6e93;font-size:13px'>", esc_(cfg.firma || "Nos vemos pronto — Equipo AECODE"), "</p>",
    "</div></div>"
  ].join("");

  GmailApp.sendEmail(data.correo, asunto, "Abre este correo en HTML.", {
    htmlBody: body,
    name: "AECODE"
  });
}

/** Devuelve un mapa {nombreDiplomado: true} desde la pestaña Opciones_Form. */
function getDiplomaSet_() {
  var out = {};
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_OPCIONES);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    if (r[2] && String(r[1]).trim().toLowerCase() === "diplomados") out[String(r[2]).trim()] = true;
  });
  return out;
}

/** "a, b y c" para listar en el correo. */
function listInline_(arr) {
  if (!arr || !arr.length) return "";
  if (arr.length === 1) return arr[0];
  return arr.slice(0, -1).join(", ") + " y " + arr[arr.length - 1];
}

function btn_(href, label, color) {
  if (!href) return "";
  return "<a href='" + esc_(href) + "' style='display:block;margin:8px auto;max-width:320px;" +
    "background:" + color + ";color:#fff;text-decoration:none;font-weight:700;" +
    "padding:13px 18px;border-radius:100px'>" + esc_(label) + "</a>";
}

/* =========================================================================
   GHL — webhook entrante (opcional)
   ========================================================================= */
function pushToGHL_(data) {
  var nombre = (data.nombre || "").trim();
  var firstName = nombre.split(" ")[0] || nombre;
  var lastName = nombre.split(" ").slice(1).join(" ");

  // Opción A: API v2 (crea/actualiza el contacto directo, con etiqueta).
  if (GHL_TOKEN) {
    UrlFetchApp.fetch("https://services.leadconnectorhq.com/contacts/upsert", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      headers: { Authorization: "Bearer " + GHL_TOKEN, Version: "2021-07-28" },
      payload: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName: firstName, lastName: lastName,
        name: nombre, email: data.correo, phone: data.whatsapp,
        source: data.fuente || GHL_TAG,
        tags: [GHL_TAG]
        // Nota: si luego creas custom fields en GHL (cargo, intereses, premio,
        // codigo), se pueden agregar aquí con "customFields". Por ahora van en
        // el Sheet para no romper el upsert si el campo no existe.
      })
    });
    return;
  }

  // Opción B: webhook entrante.
  UrlFetchApp.fetch(GHL_WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      name: nombre, phone: data.whatsapp, email: data.correo,
      cargo: data.cargo, intereses: (data.intereses || []).join(", "),
      premio: data.premio, codigo: data.codigo,
      source: data.fuente || GHL_TAG, tags: [GHL_TAG]
    })
  });
}

function notifyTeam_(data) {
  MailApp.sendEmail(NOTIFY_TEAM_EMAIL, "🟢 Nuevo lead stand: " + (data.nombre || ""),
    "Nombre: " + data.nombre + "\nWhatsApp: " + data.whatsapp + "\nCorreo: " + data.correo +
    "\nCargo: " + data.cargo + "\nInterés: " + (data.intereses || []).join(", ") +
    "\nPremio: " + data.premio + " (" + data.codigo + ")");
}

/* =========================================================================
   setupSheet — ejecútala UNA vez para crear las pestañas
   ========================================================================= */
function setupSheet() {
  getSheet_(TAB_LEADS, LEAD_HEADERS);

  // Config del correo (editable a mano después). Agrega solo las claves que falten.
  var cfg = getSheet_(TAB_CONFIG, ["Clave", "Valor"]);
  upsertKeys_(cfg, [
    ["asunto", "Gracias por visitarnos en el AI Construction Summit"],
    ["saludo", "Bienvenido a AECODE"],
    ["intro", "Aquí está todo lo que tenemos para ti — deslízalo con calma:"],
    ["descuento", "hasta 40%"],   // <- EDITA aquí el descuento de los diplomados
    ["link_beacons", "https://beacons.ai/aecode.ai"],
    ["link_ig", "https://www.instagram.com/aecode.ai/"],
    ["link_wa", "https://wa.me/51900121245"],
    ["firma", "Nos vemos pronto — Equipo AECODE"]
  ]);

  // Inventario de la ruleta (llena stock a tu gusto)
  var rul = getSheet_(TAB_RULETA, ["Casilla", "Premio", "Nivel", "Acción exigida", "Stock inicial", "Stock restante"]);
  if (rul.getLastRow() < 2) {
    var r = [
      ["Premio sorpresa…", "Merch sorpresa", "Base", "Seguir en IG", "", ""],
      ["Dale otra vueltita", "Gira de nuevo", "—", "—", "", ""],
      ["¡Suerte! 20% OFF", "20% descuento", "Base", "Seguir en IG (código 24h)", "", ""],
      ["Full acceso 24h", "Acceso 24h", "2º premio", "Seguir + historia AECODE", "", ""],
      ["Ganaste media beca", "Media beca (85% OFF)", "Mayor", "Seguir + mini-entrevista + historia", "", ""],
      ["Qué salado, para la próxima será", "Sin premio", "—", "—", "", ""],
      ["Estuviste cerca, casi ganas", "Sin premio", "—", "—", "", ""],
      ["Merch exclusivo", "Merch premium", "Base", "Seguir en IG", "", ""]
    ];
    rul.getRange(2, 1, r.length, 6).setValues(r);
  }

  // Opciones del formulario (diplomados/intereses) — EDITABLES por ventas.
  // Cambia nombres, Orden o pon Activo=FALSE y la landing se actualiza al refrescar.
  var op = getSheet_(TAB_OPCIONES, OPCIONES_HEADERS);
  if (op.getLastRow() < 2) {
    var o = [
      [1, "Diplomados", "Diplomado de IA aplicada a la Ingeniería y Construcción", true],
      [2, "Diplomados", "Diplomado BIM en Infraestructura Vial", true],
      [3, "Diplomados", "Diplomado BIM en Obras con LEAN & BI", true],
      [4, "Diplomados", "Diplomado BIM aplicado a Proyectos Hospitalarios", true],
      [5, "Diplomados", "Diplomado BIM aplicado a Colegios / Edificaciones Educativas", true],
      [6, "Diplomados", "Diplomado de Gestor BIM", true],
      [7, "Diplomados", "Especialización en Python para automatización (BIM/Revit)", true],
      [10, "Oportunidades", "Ser colaborador de AECODE más adelante", true],
      [11, "Oportunidades", "Ser parte de la BECA AI TALENT para estudiantes", true],
      [12, "Oportunidades", "Tener una alianza con mi empresa", true],
      [13, "Oportunidades", "Recibir una capacitación corporativa", true],
      [14, "Oportunidades", "Ser sponsor del próximo Summit", true],
      [15, "Oportunidades", "Proponer una iniciativa en AECODE próximamente", true],
      [16, "Oportunidades", "Investigación en AECODE", true],
      [17, "Oportunidades", "Ser embajador de AECODE", true]
    ];
    op.getRange(2, 1, o.length, 4).setValues(o);
  }

  SpreadsheetApp.getActive().toast("Pestañas listas ✅");
}

/* =========================================================================
   Helpers
   ========================================================================= */
function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (headers && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

function getConfig_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_CONFIG);
  var out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (r[0]) out[String(r[0]).trim()] = r[1];
  });
  return out;
}

/** Agrega a la hoja (Clave|Valor) solo los pares cuya clave aún no exista. */
function upsertKeys_(sh, pairs) {
  var have = {};
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (r[0]) have[String(r[0]).trim()] = true;
    });
  }
  var toAdd = pairs.filter(function (p) { return !have[p[0]]; });
  if (toAdd.length) sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, 2).setValues(toAdd);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function esc_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
