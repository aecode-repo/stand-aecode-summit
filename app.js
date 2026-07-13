/* =========================================================================
   AECODE Stand · lógica del formulario
   ========================================================================= */
(function () {
  "use strict";
  var CFG = window.AECODE_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- 1. Poblar el select de cargo ---------- */
  var selCargo = $("#sel-cargo");
  (CFG.CARGOS || []).forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c;
    selCargo.appendChild(o);
  });

  /* ---------- 2. Poblar las casillas de interés ---------- */
  var cont = $("#intereses");
  (CFG.INTERESES || []).forEach(function (g) {
    var wrap = document.createElement("div");
    wrap.className = "int-group";
    if (g.grupo) {
      var t = document.createElement("div");
      t.className = "int-group__title";
      t.textContent = g.grupo;
      wrap.appendChild(t);
    }
    (g.items || []).forEach(function (label) {
      wrap.appendChild(makeCheck(label));
    });
    cont.appendChild(wrap);
  });

  // Opción "Otro" con texto libre
  if (CFG.INTERES_OTRO) {
    var otro = document.createElement("label");
    otro.className = "check check__otro";
    otro.innerHTML =
      '<span style="display:flex;align-items:center;gap:11px">' +
        '<input type="checkbox" name="interes" value="Otro" id="chk-otro">' +
        '<span>Otro (cuéntanos)</span>' +
      '</span>' +
      '<input type="text" id="otro-text" placeholder="¿Qué más te interesa?" hidden>';
    cont.appendChild(otro);
    var chkOtro = $("#chk-otro"), otroText = $("#otro-text");
    chkOtro.addEventListener("change", function () {
      otroText.hidden = !chkOtro.checked;
      if (chkOtro.checked) otroText.focus();
    });
  }

  function makeCheck(label) {
    var l = document.createElement("label");
    l.className = "check";
    var i = document.createElement("input");
    i.type = "checkbox"; i.name = "interes"; i.value = label;
    var s = document.createElement("span");
    s.textContent = label;
    l.appendChild(i); l.appendChild(s);
    return l;
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

    send(data).then(function () {
      showDone(data);
    }).catch(function () {
      // Aun si falla la red, no perdemos al usuario: mostramos la pantalla.
      showDone(data);
    });
  });

  function collect() {
    var fd = new FormData(form);
    var intereses = fd.getAll("interes");
    var otroText = $("#otro-text");
    if (otroText && otroText.value.trim()) {
      // reemplaza el "Otro" plano por "Otro: <texto>"
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
    var n = Math.floor(1000 + Math.random() * 9000);
    return "AEC-" + n;
  }

  /* ---------- 4. Envío al Apps Script (no-cors) ---------- */
  function send(data) {
    if (!CFG.APPS_SCRIPT_URL) {
      // Modo demo: sin backend configurado
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

    // Si no ganó nada aún, ocultamos el código
    var noPrize = /a[uú]n no|todav[ií]a|no juego|no gan|nada/i.test(data.premio || "");
    if (!data.premio || noPrize) {
      $("#claim-box").hidden = true;
    }

    $("#cta-ig").href = L.instagram || "#";
    $("#cta-wa").href = L.wa_channel || "#";
    $("#cta-beacons").href = L.beacons || "#";

    $("#view-form").hidden = true;
    $("#view-done").hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });

    startRedirect(L.instagram || L.beacons);
  }

  function firstName(full) { return (full || "").split(" ")[0]; }

  /* ---------- 6. Redirección al Beacons/IG ---------- */
  function startRedirect(url) {
    var R = CFG.REDIRECT || {};
    if (!R.enabled || !url) return;
    var note = $("#redirect-note"), count = $("#redirect-count");
    var left = R.delay_seconds || 6;
    note.hidden = false; count.textContent = left;
    var t = setInterval(function () {
      left -= 1;
      count.textContent = left;
      if (left <= 0) { clearInterval(t); window.location.href = url; }
    }, 1000);
  }
})();
