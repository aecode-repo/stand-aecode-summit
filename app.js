/* =========================================================================
   AECODE Stand · lógica del formulario  (v2)
   - Intereses editables en tiempo real desde el Google Sheet (con respaldo).
   - Checkbox custom (con ✓) que sí funciona.
   ========================================================================= */
(function () {
  "use strict";
  var CFG = window.AECODE_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- 1. Select de cargo ---------- */
  var selCargo = $("#sel-cargo");
  (CFG.CARGOS || []).forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c;
    selCargo.appendChild(o);
  });

  /* ---------- 2. Intereses: primero del Sheet, si falla -> config.js ---------- */
  var cont = $("#intereses");

  fetchOpciones()
    .then(function (grupos) { buildIntereses(grupos && grupos.length ? grupos : CFG.INTERESES); })
    .catch(function () { buildIntereses(CFG.INTERESES); });

  function fetchOpciones() {
    if (!CFG.APPS_SCRIPT_URL) return Promise.reject();
    return fetch(CFG.APPS_SCRIPT_URL + "?list=opciones")
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j && j.grupos) ? j.grupos : null; });
  }

  function buildIntereses(grupos) {
    cont.innerHTML = "";
    (grupos || []).forEach(function (g) {
      var wrap = document.createElement("div");
      wrap.className = "int-group";
      if (g.grupo) {
        var t = document.createElement("div");
        t.className = "int-group__title";
        t.textContent = g.grupo;
        wrap.appendChild(t);
      }
      (g.items || []).forEach(function (label) { wrap.appendChild(makeOpt(label)); });
      cont.appendChild(wrap);
    });
    if (CFG.INTERES_OTRO) appendOtro();
  }

  function makeOpt(label) {
    var l = document.createElement("label");
    l.className = "opt";
    l.innerHTML =
      '<input type="checkbox" name="interes">' +
      '<span class="opt__box" aria-hidden="true"></span>' +
      '<span class="opt__label"></span>';
    l.querySelector("input").value = label;
    l.querySelector(".opt__label").textContent = label;
    return l;
  }

  function appendOtro() {
    var otro = document.createElement("label");
    otro.className = "opt opt--otro";
    otro.innerHTML =
      '<span class="opt__row">' +
        '<input type="checkbox" name="interes" value="Otro" id="chk-otro">' +
        '<span class="opt__box" aria-hidden="true"></span>' +
        '<span class="opt__label">Otro (cuéntanos)</span>' +
      '</span>' +
      '<input type="text" id="otro-text" placeholder="¿Qué más te interesa?" hidden>';
    cont.appendChild(otro);
    var chkOtro = $("#chk-otro"), otroText = $("#otro-text");
    chkOtro.addEventListener("change", function () {
      otroText.hidden = !chkOtro.checked;
      if (chkOtro.checked) otroText.focus();
    });
  }

  /* ---------- 3. Enviar ---------- */
  var form = $("#lead-form");
  var errBox = $("#form-error");
  var btn = $("#btn-submit");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errBox.hidden = true;

    var data = collect();
    var problem = validate(data);
    if (problem) {
      errBox.textContent = problem;
      errBox.hidden = false;
      errBox.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    data.codigo = genCode();
    btn.classList.add("btn--loading");
    btn.disabled = true;

    send(data).then(function () { showDone(data); })
              .catch(function () { showDone(data); });
  });

  function collect() {
    var fd = new FormData(form);
    var intereses = fd.getAll("interes");
    var otroText = $("#otro-text");
    if (otroText && otroText.value.trim()) {
      intereses = intereses.filter(function (x) { return x !== "Otro"; });
      intereses.push("Otro: " + otroText.value.trim());
    }
    return {
      nombre:   (fd.get("nombre") || "").trim(),
      whatsapp: (fd.get("whatsapp") || "").trim(),
      correo:   (fd.get("correo") || "").trim(),
      cargo:    (fd.get("cargo") || "").trim(),
      premio:   (fd.get("premio") || "").trim(),
      intereses: intereses,
      fuente: "leads summit presencial",
      user_agent: navigator.userAgent
    };
  }

  function validate(d) {
    if (!d.nombre) return "Escribe tu nombre 🙂";
    if (!d.whatsapp || d.whatsapp.replace(/\D/g, "").length < 6) return "Revisa tu número de WhatsApp.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.correo)) return "Revisa tu correo.";
    if (!d.cargo) return "Elige tu cargo o condición.";
    if (!d.intereses.length) return "Marca al menos 1 cosa que te interese de AECODE.";
    return null;
  }

  function genCode() {
    return "AEC-" + Math.floor(1000 + Math.random() * 9000);
  }

  /* ---------- 4. Envío al Apps Script (no-cors) ---------- */
  function send(data) {
    if (!CFG.APPS_SCRIPT_URL) {
      console.info("[AECODE] Modo demo — datos NO enviados:", data);
      return Promise.resolve();
    }
    return fetch(CFG.APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(data)
    });
  }

  /* ---------- 5. Pantalla ¡Listo! ---------- */
  function showDone(data) {
    var L = CFG.LINKS || {};
    $("#done-name").textContent = firstName(data.nombre) || "crack";
    $("#claim-code").textContent = data.codigo;

    var noPrize = /a[uú]n no|todav[ií]a|no juego|no gan|nada/i.test(data.premio || "");
    if (!data.premio || noPrize) $("#claim-box").hidden = true;

    $("#cta-ig").href = L.instagram || "#";
    $("#cta-wa").href = L.wa_channel || "#";
    $("#cta-beacons").href = L.beacons || "#";

    $("#view-form").hidden = true;
    $("#view-done").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });

    startRedirect(L.instagram || L.beacons);
  }

  function firstName(full) { return (full || "").split(" ")[0]; }

  /* ---------- 6. Redirección ---------- */
  function startRedirect(url) {
    var R = CFG.REDIRECT || {};
    if (!R.enabled || !url) return;
    var note = $("#redirect-note"), count = $("#redirect-count");
    var left = R.delay_seconds || 6;
    note.hidden = false; count.textContent = left;
    var t = setInterval(function () {
      left -= 1; count.textContent = left;
      if (left <= 0) { clearInterval(t); window.location.href = url; }
    }, 1000);
  }
})();
