/**
 * AECODE Stand · CONEIC — Backend (Google Apps Script)
 * -------------------------------------------------------------------------
 * Flujo NUEVO (v4 — panel de vendedores):
 *   1) La persona se registra en la landing (doPost) -> se guarda en "Leads"
 *      con Estado = PENDIENTE.  NO se le envía correo todavía.
 *   2) Los vendedores entran al PANEL (panel/) con una contraseña y ven, en
 *      tiempo real, todos los registros PENDIENTES.
 *   3) El vendedor marca el premio que la persona ganó en la ruleta física.
 *   4) Recién ahí se envía el correo (ya con el premio) y el lead queda
 *      cerrado.  Un solo vendedor puede asignar cada registro (bloqueo).
 *
 * CÓMO INSTALAR / ACTUALIZAR:
 *   1. Abre tu Google Sheet → Extensiones → Apps Script.
 *   2. Pega este archivo (reemplazando lo anterior). Guarda.
 *   3. Ejecuta la función  setupSheet  una vez (crea/actualiza las pestañas).
 *   4. Implementar → Gestionar implementaciones → EDITAR la existente →
 *      Nueva versión (así la URL /exec NO cambia).
 * ------------------------------------------------------------------------- */

/* ====== AJUSTES ====== */
// GHL vía API v2. Pega tu Private Integration Token (pit-...) en el archivo
// WITH-SECRETS (no en este, que es público). Vacío = no envía a GHL.
var GHL_TOKEN = "";
var GHL_LOCATION_ID = "T8ByMoOOq7hWWswablDhF";    // Sub-cuenta de AECODE (confirmar).
var GHL_TAG = "leads coneic presencial";
var GHL_WEBHOOK_URL = "";
var NOTIFY_TEAM_EMAIL = ""; // Correo interno para avisos de lead nuevo (opcional).

// Contraseña del PANEL de vendedores. Ponla en el archivo WITH-SECRETS.
// Si queda vacía, el panel NO deja entrar a nadie (por seguridad).
var PANEL_KEY = "";

// Cuántos segundos dura el "bloqueo" de un registro mientras un vendedor lo
// está atendiendo (para que otro no lo toque). Se libera solo al vencer.
var LOCK_TTL_SECONDS = 90;

var TAB_LEADS    = "Leads";
var TAB_CONFIG   = "Config_Correo";
var TAB_RULETA   = "Inventario_Ruleta";
var TAB_OPCIONES = "Opciones_Form";   // diplomados/intereses editables por ventas
var TAB_PREMIOS  = "Premios_Panel";   // premios que marca el vendedor (editables)
var OPCIONES_HEADERS = ["Orden", "Grupo", "Item", "Activo"];
var PREMIOS_HEADERS  = ["Orden", "Premio", "Tipo", "Activo"]; // Tipo: premio | sin
var TAB_SUSCRIP  = "Suscripciones";   // leads de la landing HUB (aecode-hub)
var SUSCRIP_HEADERS = ["Timestamp", "Nombre", "Correo", "WhatsApp", "Perfil", "Intereses", "Fuente"];

// Columnas de "Leads" (v4). Los índices se derivan de aquí (ver COL abajo).
var LEAD_HEADERS = [
  "Timestamp","Nombre","WhatsApp","Correo","Cargo/condición","Interés",
  "ID","Código","Estado","Premio asignado","Vendedor","Asignado en",
  "Correo enviado","Fuente","User agent","Lock","Lock ts"
];
// Índices 1-based por nombre (para no depender del orden mágico).
var COL = {};
LEAD_HEADERS.forEach(function (h, i) { COL[h] = i + 1; });

/* =========================================================================
   doPost — recibe el formulario de la landing (NO envía correo aún)
   ========================================================================= */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var data = JSON.parse(e.postData.contents);

    // Formulario de la landing HUB (aecode-hub) -> flujo aparte (sí envía correo).
    if (data.tipo === "hub") return handleHub_(data);

    var sheet = getSheet_(TAB_LEADS, LEAD_HEADERS);
    var id = Utilities.getUuid();
    var intereses = (data.intereses || []).join(" · ");

    // Orden EXACTO de LEAD_HEADERS.
    var row = [
      new Date(), data.nombre || "", data.whatsapp || "", data.correo || "",
      data.cargo || "", intereses,
      id, data.codigo || "", "PENDIENTE", "", "", "",
      "No", data.fuente || "leads coneic presencial", data.user_agent || "", "", ""
    ];
    sheet.appendRow(row);

    // El lead se captura en GHL de una vez (no perdemos el contacto).
    // El CORREO se envía recién cuando el vendedor asigna el premio.
    try { if (GHL_TOKEN || GHL_WEBHOOK_URL) pushToGHL_(data); } catch (err) { Logger.log("GHL error: " + err); }
    try { if (NOTIFY_TEAM_EMAIL) notifyTeam_(data); } catch (err) {}

    return json_({ ok: true, id: id, codigo: data.codigo });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================================
   doGet — opciones del form + endpoints del PANEL de vendedores
   ========================================================================= */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.list === "opciones") return json_({ ok: true, grupos: getOpciones_() });
  if (p.panel) return handlePanel_(p);
  return json_({ ok: true, service: "AECODE Stand backend" });
}

/* =========================================================================
   PANEL de vendedores
   ========================================================================= */
function handlePanel_(p) {
  // Puerta de seguridad: sin la clave correcta no se ve ni se toca nada.
  if (!PANEL_KEY || String(p.key || "") !== String(PANEL_KEY)) {
    return json_({ ok: false, error: "clave" });
  }
  switch (p.panel) {
    case "pendientes": return panelPendientes_();
    case "premios":    return json_({ ok: true, premios: getPremios_() });
    case "asignar":    return panelAsignar_(p);
    case "lock":       return panelLock_(p, true);
    case "unlock":     return panelLock_(p, false);
    default:           return json_({ ok: false, error: "accion" });
  }
}

/** Devuelve la cola PENDIENTE (más nuevos primero) + los últimos resueltos. */
function panelPendientes_() {
  var sh = getSheet_(TAB_LEADS, LEAD_HEADERS);
  var now = new Date().getTime();
  var pendientes = [], recientes = [];
  if (sh.getLastRow() >= 2) {
    var vals = sh.getRange(2, 1, sh.getLastRow() - 1, LEAD_HEADERS.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var r = vals[i];
      var estado = String(r[COL["Estado"] - 1] || "");
      var item = {
        id:       String(r[COL["ID"] - 1] || ""),
        nombre:   String(r[COL["Nombre"] - 1] || ""),
        whatsapp: String(r[COL["WhatsApp"] - 1] || ""),
        correo:   String(r[COL["Correo"] - 1] || ""),
        cargo:    String(r[COL["Cargo/condición"] - 1] || ""),
        interes:  String(r[COL["Interés"] - 1] || ""),
        codigo:   String(r[COL["Código"] - 1] || ""),
        ts:       fechaMs_(r[COL["Timestamp"] - 1])
      };
      if (estado === "PENDIENTE") {
        var lockBy = String(r[COL["Lock"] - 1] || "");
        var lockTs = fechaMs_(r[COL["Lock ts"] - 1]);
        item.lockedBy = (lockBy && (now - lockTs) < LOCK_TTL_SECONDS * 1000) ? lockBy : "";
        pendientes.push(item);
      } else {
        item.estado = estado;
        item.premio = String(r[COL["Premio asignado"] - 1] || "");
        item.vendedor = String(r[COL["Vendedor"] - 1] || "");
        item.asignadoMs = fechaMs_(r[COL["Asignado en"] - 1]);
        recientes.push(item);
      }
    }
  }
  pendientes.sort(function (a, b) { return b.ts - a.ts; });         // nuevos primero
  recientes.sort(function (a, b) { return b.asignadoMs - a.asignadoMs; });
  return json_({ ok: true, now: now, pendientes: pendientes, premiados: recientes.slice(0, 12) });
}

/** Marca (o suelta) el bloqueo de un registro para un vendedor. */
function panelLock_(p, poner) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var found = findRowById_(String(p.id || ""));
    if (!found) return json_({ ok: false, error: "no_encontrado" });
    var sh = found.sheet, rowIdx = found.row, r = found.values;
    if (String(r[COL["Estado"] - 1]) !== "PENDIENTE") {
      return json_({ ok: false, error: "ya_atendido", estado: String(r[COL["Estado"] - 1]) });
    }
    var vendedor = String(p.vendedor || "").trim();
    var lockBy = String(r[COL["Lock"] - 1] || "");
    var lockTs = fechaMs_(r[COL["Lock ts"] - 1]);
    var vigente = lockBy && (new Date().getTime() - lockTs) < LOCK_TTL_SECONDS * 1000;

    if (poner) {
      if (vigente && lockBy !== vendedor) return json_({ ok: false, error: "ocupado", lockedBy: lockBy });
      sh.getRange(rowIdx, COL["Lock"]).setValue(vendedor);
      sh.getRange(rowIdx, COL["Lock ts"]).setValue(new Date());
      return json_({ ok: true, lockedBy: vendedor });
    } else {
      if (lockBy === vendedor) {
        sh.getRange(rowIdx, COL["Lock"]).setValue("");
        sh.getRange(rowIdx, COL["Lock ts"]).setValue("");
      }
      return json_({ ok: true });
    }
  } finally {
    lock.releaseLock();
  }
}

/** Asigna el premio: valida que siga PENDIENTE, escribe y ENVÍA el correo. */
function panelAsignar_(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findRowById_(String(p.id || ""));
    if (!found) return json_({ ok: false, error: "no_encontrado" });
    var sh = found.sheet, rowIdx = found.row, r = found.values;

    if (String(r[COL["Estado"] - 1]) !== "PENDIENTE") {
      return json_({ ok: false, error: "ya_atendido", estado: String(r[COL["Estado"] - 1]),
                     vendedor: String(r[COL["Vendedor"] - 1] || "") });
    }

    var premio   = String(p.premio || "").trim();
    var vendedor = String(p.vendedor || "").trim();
    var sinPremio = /^__sin__$/i.test(premio) || esSinPremio_(premio);
    var estado = sinPremio ? "SIN_PREMIO" : "PREMIADO";
    var premioTexto = /^__sin__$/i.test(premio) ? "Sin premio" : premio;

    sh.getRange(rowIdx, COL["Premio asignado"]).setValue(premioTexto);
    sh.getRange(rowIdx, COL["Vendedor"]).setValue(vendedor);
    sh.getRange(rowIdx, COL["Asignado en"]).setValue(new Date());
    sh.getRange(rowIdx, COL["Estado"]).setValue(estado);
    sh.getRange(rowIdx, COL["Lock"]).setValue("");
    sh.getRange(rowIdx, COL["Lock ts"]).setValue("");

    // Reconstruye el "data" del lead desde la fila y ENVÍA el correo.
    var data = {
      nombre:  String(r[COL["Nombre"] - 1] || ""),
      correo:  String(r[COL["Correo"] - 1] || ""),
      cargo:   String(r[COL["Cargo/condición"] - 1] || ""),
      intereses: String(r[COL["Interés"] - 1] || "").split(" · ").filter(String),
      codigo:  String(r[COL["Código"] - 1] || ""),
      premio:  sinPremio ? "" : premioTexto   // "" = no muestra bloque de ruleta
    };
    var sent = false;
    try { sendLeadEmail_(data); sent = true; } catch (err) { Logger.log("Email error: " + err); }
    sh.getRange(rowIdx, COL["Correo enviado"]).setValue(sent ? "Sí" : "Error");

    return json_({ ok: true, estado: estado, correo: sent, nombre: data.nombre });
  } finally {
    lock.releaseLock();
  }
}

/** Busca una fila de Leads por su ID único. Devuelve {sheet,row,values} o null. */
function findRowById_(id) {
  if (!id) return null;
  var sh = getSheet_(TAB_LEADS, LEAD_HEADERS);
  if (sh.getLastRow() < 2) return null;
  var ids = sh.getRange(2, COL["ID"], sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      var rowIdx = i + 2;
      var values = sh.getRange(rowIdx, 1, 1, LEAD_HEADERS.length).getValues()[0];
      return { sheet: sh, row: rowIdx, values: values };
    }
  }
  return null;
}

/** Lista de premios activos para el panel (editable en Premios_Panel). */
function getPremios_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_PREMIOS);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  rows = rows.filter(function (r) {
    return r[1] && String(r[3]).toUpperCase() !== "FALSE" && r[3] !== false;
  });
  rows.sort(function (a, b) { return (Number(a[0]) || 0) - (Number(b[0]) || 0); });
  return rows.map(function (r) {
    return { premio: String(r[1]).trim(), tipo: String(r[2] || "premio").trim().toLowerCase() };
  });
}

/** True si el premio marcado es un "no ganó" (según la lista o el texto). */
function esSinPremio_(texto) {
  var t = String(texto || "").toLowerCase();
  if (/sin premio|no gan|no jug|no juega|otra vuelta|vac[ií]o/.test(t)) return true;
  var lista = getPremios_();
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].premio.toLowerCase() === t && lista[i].tipo === "sin") return true;
  }
  return false;
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
   HUB (landing aecode-hub) — suscripción de interés (sí envía correo neutro)
   ========================================================================= */
function handleHub_(data) {
  var sh = getSheet_(TAB_SUSCRIP, SUSCRIP_HEADERS);
  sh.appendRow([
    new Date(), data.nombre || "", data.correo || "", data.whatsapp || "",
    data.cargo || "", (data.intereses || []).join(" · "), data.fuente || "landing hub"
  ]);
  data.tag = "landing hub";
  try { sendHubEmail_(data); } catch (err) { Logger.log("Hub email: " + err); }
  try { if (GHL_TOKEN || GHL_WEBHOOK_URL) pushToGHL_(data); } catch (err) { Logger.log("Hub GHL: " + err); }
  return json_({ ok: true });
}

function sendHubEmail_(data) {
  var cfg = getConfig_();
  var nombre = (data.nombre || "").split(" ")[0] || "hola";
  var intereses = data.intereses || [];
  var lista = intereses.length
    ? "<ul style='margin:8px 0 0;padding-left:18px;color:#33364d;line-height:1.7'>" +
        intereses.map(function (i) { return "<li>" + esc_(i) + "</li>"; }).join("") + "</ul>"
    : "";
  var body = [
    "<div style='font-family:Manrope,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a2e'>",
    "<div style='background:#191C32;border-radius:16px;padding:26px;text-align:center'>",
      "<h1 style='color:#fff;font-size:22px;margin:0'>Gracias por tu interés en AECODE</h1>",
      "<p style='color:#9193BB;margin:10px 0 0'>Hola <b style='color:#fff'>", esc_(nombre), "</b>,</p>",
    "</div>",
    "<div style='padding:22px 6px'>",
      intereses.length ? "<p style='color:#33364d'>Nos contaste que te interesa:</p>" + lista : "",
      "<p style='margin-top:14px;color:#33364d'>Nuestro equipo te contactará pronto con toda la información.</p>",
      "<div style='margin:24px 0;text-align:center'>",
        btn_(cfg.link_beacons || "https://aecode.ai", "Conoce todo AECODE", "#7C28F8"),
        btn_(cfg.link_ig, "Síguenos en Instagram", "#E1306C"),
        btn_(cfg.link_wa, "Escríbenos por WhatsApp", "#25D366"),
      "</div>",
      "<p style='color:#6b6e93;font-size:13px'>", esc_(cfg.firma || "Nos vemos pronto — Equipo AECODE"), "</p>",
    "</div></div>"
  ].join("");
  GmailApp.sendEmail(data.correo, "Gracias por tu interés en AECODE", "Abre este correo en HTML.", {
    htmlBody: body, name: "AECODE"
  });
}

/* =========================================================================
   Correo personalizado (se envía al ASIGNAR el premio en el panel)
   ========================================================================= */
function sendLeadEmail_(data) {
  var cfg = getConfig_();
  var nombre = (data.nombre || "").split(" ")[0] || "hola";
  var intereses = data.intereses || [];

  // Clasificar lo que marcó: diplomados vs. otras iniciativas.
  var diplomaSet = getDiplomaSet_();
  var diplomas = intereses.filter(function (i) { return diplomaSet[i]; });
  var otros    = intereses.filter(function (i) { return !diplomaSet[i]; });

  var asunto = (cfg.asunto || "Gracias por visitarnos en el CONEIC")
                 .replace("{nombre}", nombre);
  var descuento = cfg.descuento || "un descuento especial";

  var listaIntereses = intereses.length
    ? "<ul style='margin:8px 0 0;padding-left:18px;color:#33364d;line-height:1.7'>" +
        intereses.map(function (i) { return "<li>" + esc_(i) + "</li>"; }).join("") + "</ul>"
    : "";

  // Bloque del PREMIO de la ruleta (lo que marcó el vendedor). Sin emojis.
  var esPremioReal = data.premio && !esSinPremio_(data.premio);
  var bloqueRuleta = esPremioReal ? (
    "<div style='margin:20px 0;padding:16px 18px;border-radius:12px;background:#EAF3FF;border:1px solid #CBE1FF'>" +
      "<p style='margin:0;color:#33364d'>En la ruleta de nuestro stand te ganaste:</p>" +
      "<p style='margin:6px 0 0;font-size:19px;font-weight:800;color:#236BF9'>" + esc_(data.premio) + "</p>" +
      "<p style='margin:8px 0 0;color:#6b6e93;font-size:13px'>Escríbenos por WhatsApp para reclamarlo (válido 24-72 h).</p>" +
    "</div>"
  ) : "";

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
  var waLabel = (esPremioReal || diplomas.length) ? "Reclama tu premio aquí" : "Escríbenos por WhatsApp";

  // Bloque de ponencias (calendario Luma) — solo si hay link configurado.
  var bloquePonencias = cfg.link_luma ? (
    "<div style='margin:20px 0;padding:16px 18px;border-radius:12px;background:#EAF3FF;border:1px solid #CBE1FF'>" +
      "<p style='margin:0;color:#33364d'>No te olvides que tenemos estas <b>ponencias</b> — regístrate para no perderte ninguna.</p>" +
    "</div>"
  ) : "";

  var body = [
    "<div style='font-family:Manrope,Arial,sans-serif;max-width:520px;margin:auto;color:#1a1a2e'>",
    "<div style='background:#191C32;border-radius:16px;padding:26px;text-align:center'>",
      "<h1 style='color:#fff;font-size:22px;margin:0'>", esc_(cfg.saludo || "Bienvenido a AECODE"), "</h1>",
      "<p style='color:#9193BB;margin:10px 0 0'>Hola <b style='color:#fff'>", esc_(nombre),
        "</b>, gracias por visitarnos en el CONEIC.</p>",
    "</div>",
    "<div style='padding:22px 6px'>",
      "<p style='color:#33364d'>", esc_(cfg.intro || "Aquí está todo lo que tenemos para ti — deslízalo con calma:"), "</p>",
      bloqueRuleta,
      intereses.length ? "<p style='margin-top:14px;color:#33364d'><b>Marcaste interés en:</b></p>" + listaIntereses : "",
      bloqueDiploma,
      bloqueOtros,
      bloquePonencias,
      "<div style='margin:24px 0;text-align:center'>",
        btn_(cfg.link_luma, "Ver calendario de ponencias en Luma", "#236BF9"),
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
   GHL — API v2 / webhook entrante (opcional)
   ========================================================================= */
function pushToGHL_(data) {
  var nombre = (data.nombre || "").trim();
  var firstName = nombre.split(" ")[0] || nombre;
  var lastName = nombre.split(" ").slice(1).join(" ");

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
        tags: [data.tag || GHL_TAG]
      })
    });
    return;
  }

  UrlFetchApp.fetch(GHL_WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      name: nombre, phone: data.whatsapp, email: data.correo,
      cargo: data.cargo, intereses: (data.intereses || []).join(", "),
      codigo: data.codigo,
      source: data.fuente || GHL_TAG, tags: [data.tag || GHL_TAG]
    })
  });
}

function notifyTeam_(data) {
  MailApp.sendEmail(NOTIFY_TEAM_EMAIL, "Nuevo lead stand: " + (data.nombre || ""),
    "Nombre: " + data.nombre + "\nWhatsApp: " + data.whatsapp + "\nCorreo: " + data.correo +
    "\nCargo: " + data.cargo + "\nInterés: " + (data.intereses || []).join(", ") +
    "\n(Pendiente de asignar premio en el panel)");
}

/* =========================================================================
   setupSheet — ejecútala UNA vez para crear/actualizar las pestañas
   ========================================================================= */
function setupSheet() {
  // Leads: crea la pestaña y asegura que tenga TODAS las columnas nuevas.
  var leads = getSheet_(TAB_LEADS, LEAD_HEADERS);
  ensureHeaders_(leads, LEAD_HEADERS);

  // Config del correo (editable a mano). Agrega solo las claves que falten.
  var cfg = getSheet_(TAB_CONFIG, ["Clave", "Valor"]);
  upsertKeys_(cfg, [
    ["asunto", "Gracias por visitarnos en el CONEIC"],
    ["saludo", "Bienvenido a AECODE"],
    ["intro", "Aquí está todo lo que tenemos para ti — deslízalo con calma:"],
    ["descuento", "hasta 40%"],
    ["link_beacons", "https://beacons.ai/aecode.ai"],
    ["link_ig", "https://www.instagram.com/aecode.ai/"],
    ["link_wa", "https://aecode-wsp-main.vercel.app/becatalent"],
    ["link_luma", "https://luma.com/aecode.ai"],
    ["firma", "Nos vemos pronto — Equipo AECODE"]
  ]);

  // Inventario de la ruleta (referencia física).
  var rul = getSheet_(TAB_RULETA, ["Casilla", "Premio", "Nivel", "Acción exigida", "Stock inicial", "Stock restante"]);
  if (rul.getLastRow() < 2) {
    rul.getRange(2, 1, 8, 6).setValues([
      ["Premio sorpresa…", "Merch sorpresa", "Base", "Seguir en IG", "", ""],
      ["Dale otra vueltita", "Gira de nuevo", "—", "—", "", ""],
      ["¡Suerte! 20% OFF", "20% descuento", "Base", "Seguir en IG (código 24h)", "", ""],
      ["Full acceso 24h", "Acceso 24h", "2º premio", "Seguir + historia AECODE", "", ""],
      ["Ganaste media beca", "Media beca (85% OFF)", "Mayor", "Seguir + mini-entrevista + historia", "", ""],
      ["Qué salado, para la próxima será", "Sin premio", "—", "—", "", ""],
      ["Estuviste cerca, casi ganas", "Sin premio", "—", "—", "", ""],
      ["Merch exclusivo", "Merch premium", "Base", "Seguir en IG", "", ""]
    ]);
  }

  // Opciones del formulario (diplomados/intereses) — EDITABLES por ventas.
  var op = getSheet_(TAB_OPCIONES, OPCIONES_HEADERS);
  if (op.getLastRow() < 2) {
    op.getRange(2, 1, 15, 4).setValues([
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
    ]);
  }

  // Premios que marca el VENDEDOR en el panel — EDITABLES (Tipo: premio | sin).
  var pr = getSheet_(TAB_PREMIOS, PREMIOS_HEADERS);
  if (pr.getLastRow() < 2) {
    pr.getRange(2, 1, 8, 4).setValues([
      [1, "Media beca (85% OFF)", "premio", true],
      [2, "Full acceso 24h", "premio", true],
      [3, "20% de descuento", "premio", true],
      [4, "Merch exclusivo", "premio", true],
      [5, "Merch sorpresa", "premio", true],
      [8, "Gira de nuevo", "sin", true],
      [9, "No ganó premio", "sin", true],
      [10, "No jugó la ruleta", "sin", true]
    ]);
  }

  SpreadsheetApp.getActive().toast("Pestañas listas ✅ (recuerda poner PANEL_KEY y redeploy)");
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

/**
 * Fuerza la fila 1 a ser EXACTAMENTE la lista canónica de cabeceras.
 * El código escribe/lee por POSICIÓN (ver COL), así que la fila 1 es solo una
 * etiqueta para humanos: si no coincide, confunde a quien lee el Sheet.
 * Por eso se reescribe entera (idempotente) en vez de "agregar las que falten".
 */
function ensureHeaders_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  // Limpia etiquetas sobrantes a la derecha (de versiones anteriores del esquema).
  var extra = sh.getLastColumn() - headers.length;
  if (extra > 0) sh.getRange(1, headers.length + 1, 1, extra).clearContent();
  sh.setFrozenRows(1);
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

/** Convierte un valor de celda (Date o string) a milisegundos; 0 si no aplica. */
function fechaMs_(v) {
  if (v instanceof Date) return v.getTime();
  if (!v) return 0;
  var d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function esc_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
