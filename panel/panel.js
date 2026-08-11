/* =========================================================================
   Panel de ventas · AECODE Stand
   - Tablero compartido en tiempo real (refresco cada 5 s).
   - Bloqueo: cuando un vendedor abre un registro, a los demás les sale
     "lo está atendiendo X" y el servidor impide doble asignación.
   ========================================================================= */
(function () {
  "use strict";

  // Mismo backend que la landing (Apps Script /exec).
  var API = "https://script.google.com/macros/s/AKfycbxIW5FA02hyz474ooYSGsCR3ixGzH9Rdcw6I592sSSqINPVROA4ZIO90m3_DRMppWTpBA/exec";

  var POLL_MS = 5000;
  var $ = function (s) { return document.querySelector(s); };

  var state = {
    vendedor: localStorage.getItem("aecode_vendedor") || "",
    key: localStorage.getItem("aecode_panelkey") || "",
    premios: null,
    current: null,       // lead abierto en el modal
    selected: null,      // premio seleccionado {premio,tipo}
    polling: false,
    timer: null
  };

  /* ---------------- API helper (GET + JSON, con cache-buster) ------------- */
  function api(params) {
    var q = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]);
    }).join("&");
    var url = API + "?" + q + "&_=" + Date.now();
    return fetch(url, { method: "GET" }).then(function (r) { return r.json(); });
  }

  /* ---------------------------- LOGIN ------------------------------------ */
  function initLogin() {
    if (state.vendedor) $("#in-vendedor").value = state.vendedor;
    if (state.key) $("#in-key").value = state.key;
    $("#btn-login").addEventListener("click", doLogin);
    $("#in-key").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  }

  function doLogin() {
    var vendedor = $("#in-vendedor").value.trim();
    var key = $("#in-key").value.trim();
    var err = $("#login-error");
    err.hidden = true;
    if (!vendedor) { return showErr(err, "Escribe tu nombre."); }
    if (!key) { return showErr(err, "Escribe la contraseña."); }

    $("#btn-login").disabled = true;
    $("#btn-login").textContent = "Entrando…";
    api({ panel: "pendientes", key: key }).then(function (res) {
      $("#btn-login").disabled = false;
      $("#btn-login").textContent = "Entrar";
      if (!res || res.ok === false) { return showErr(err, "Contraseña incorrecta."); }
      state.vendedor = vendedor; state.key = key;
      localStorage.setItem("aecode_vendedor", vendedor);
      localStorage.setItem("aecode_panelkey", key);
      enterPanel(res);
    }).catch(function () {
      $("#btn-login").disabled = false;
      $("#btn-login").textContent = "Entrar";
      showErr(err, "Sin conexión. Revisa el internet e intenta de nuevo.");
    });
  }

  function showErr(el, msg) { el.textContent = msg; el.hidden = false; }

  /* ---------------------------- PANEL ------------------------------------ */
  function enterPanel(firstData) {
    $("#view-login").hidden = true;
    $("#view-panel").hidden = false;
    $("#me").textContent = state.vendedor;
    $("#btn-logout").addEventListener("click", logout);
    $("#modal-close").addEventListener("click", closeModal);
    $("#btn-confirm").addEventListener("click", confirmAssign);
    $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });

    loadPremios();
    if (firstData) render(firstData);
    startPolling();
  }

  function logout() {
    stopPolling();
    localStorage.removeItem("aecode_panelkey");
    state.key = "";
    location.reload();
  }

  function loadPremios() {
    api({ panel: "premios", key: state.key }).then(function (res) {
      if (res && res.ok) state.premios = res.premios || [];
    }).catch(function () {});
  }

  function startPolling() {
    poll();
    state.timer = setInterval(poll, POLL_MS);
    // Refresca al volver a la pestaña.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll();
    });
  }
  function stopPolling() { if (state.timer) clearInterval(state.timer); state.timer = null; }

  function poll() {
    if (state.polling) return;
    state.polling = true;
    api({ panel: "pendientes", key: state.key }).then(function (res) {
      state.polling = false;
      setConn(true);
      if (res && res.ok) render(res);
    }).catch(function () {
      state.polling = false;
      setConn(false);
    });
  }

  function setConn(ok) {
    var d = $("#conn");
    d.className = "dot " + (ok ? "ok" : "bad");
    $("#last-upd").textContent = ok ? ("Actualizado " + hora()) : "Sin conexión…";
  }

  /* --------------------------- RENDER ------------------------------------ */
  function render(res) {
    var now = res.now || Date.now();
    var pend = res.pendientes || [];
    var prem = res.premiados || [];

    $("#pend-count").textContent = pend.length + (pend.length === 1 ? " en espera" : " en espera");

    var cont = $("#pendientes");
    if (!pend.length) {
      cont.innerHTML = '<div class="empty"><b>Todo al día ✨</b>No hay registros en espera. Aparecerán aquí apenas alguien se registre.</div>';
    } else {
      cont.innerHTML = "";
      pend.forEach(function (p) { cont.appendChild(cardPendiente(p, now)); });
    }

    // Recientes (últimos premiados)
    var rec = $("#recientes");
    if (!prem.length) {
      $("#recientes-wrap").hidden = true;
    } else {
      $("#recientes-wrap").hidden = false;
      rec.innerHTML = "";
      prem.forEach(function (p) { rec.appendChild(recItem(p)); });
    }
  }

  function cardPendiente(p, now) {
    var el = document.createElement("div");
    var mine = p.lockedBy && p.lockedBy === state.vendedor;
    var lockedByOther = p.lockedBy && p.lockedBy !== state.vendedor;
    el.className = "lead" + (lockedByOther ? " locked" : "");

    var esNuevo = (now - (p.ts || 0)) < 30000;
    var tags = interesTags(p.interes);

    el.innerHTML =
      '<div class="lead__body">' +
        '<p class="lead__name">' + esc(p.nombre || "Sin nombre") + '</p>' +
        '<p class="lead__meta">' + esc(p.cargo || "") + (p.cargo && p.whatsapp ? " · " : "") + esc(p.whatsapp || "") + '</p>' +
        (tags ? '<div class="lead__tags">' + tags + '</div>' : '') +
      '</div>' +
      '<div class="lead__side">' +
        (esNuevo ? '<span class="new-pill">nuevo</span>' : '') +
        '<span class="ago">' + agoTxt(now - (p.ts || 0)) + '</span>' +
        (p.codigo ? '<span class="code">' + esc(p.codigo) + '</span>' : '') +
        (lockedByOther ? '<span class="lockflag">🔒 ' + esc(p.lockedBy) + '</span>' : '') +
        (mine ? '<span class="lockflag">tú lo tienes</span>' : '') +
      '</div>';

    if (!lockedByOther) {
      el.addEventListener("click", function () { openModal(p); });
    }
    return el;
  }

  function interesTags(interes) {
    if (!interes) return "";
    return interes.split(" · ").filter(String).slice(0, 3).map(function (i) {
      var short = i.length > 34 ? i.slice(0, 32) + "…" : i;
      return '<span class="tag">' + esc(short) + '</span>';
    }).join("");
  }

  function recItem(p) {
    var el = document.createElement("div");
    el.className = "rec-item";
    var sin = p.estado === "SIN_PREMIO";
    el.innerHTML =
      '<span class="r-name">' + esc(p.nombre || "") + '</span>' +
      '<span class="r-prize' + (sin ? " sin" : "") + '">' + esc(sin ? "sin premio" : (p.premio || "—")) +
        ' <span class="r-by">· ' + esc(p.vendedor || "") + '</span></span>';
    return el;
  }

  /* --------------------------- MODAL ------------------------------------- */
  function openModal(p) {
    // Intenta bloquear antes de abrir.
    api({ panel: "lock", key: state.key, id: p.id, vendedor: state.vendedor }).then(function (res) {
      if (res && res.error === "ocupado") {
        toast("Lo está atendiendo " + (res.lockedBy || "otro vendedor"), "bad");
        poll();
        return;
      }
      if (res && res.error === "ya_atendido") {
        toast("Ese registro ya fue atendido.", "bad");
        poll();
        return;
      }
      state.current = p;
      state.selected = null;
      $("#m-nombre").textContent = p.nombre || "Sin nombre";
      var meta = [p.cargo, p.whatsapp, p.correo].filter(String).join(" · ");
      $("#m-meta").textContent = meta;
      $("#m-interes").innerHTML = interesTags(p.interes) || '<span class="muted small">Sin intereses marcados</span>';
      $("#modal-error").hidden = true;
      $("#btn-confirm").disabled = true;
      $("#btn-confirm").textContent = "Confirmar y enviar correo";
      renderPremios();
      $("#modal").hidden = false;
    }).catch(function () { toast("Sin conexión", "bad"); });
  }

  function renderPremios() {
    var cont = $("#premios");
    cont.innerHTML = "";
    var lista = state.premios || [];
    if (!lista.length) {
      cont.innerHTML = '<p class="muted small">No hay premios configurados. Agrégalos en la pestaña "Premios_Panel" del Sheet.</p>';
      return;
    }
    lista.forEach(function (pr) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "premio-btn" + (pr.tipo === "sin" ? " tipo-sin" : "");
      b.textContent = pr.premio;
      b.addEventListener("click", function () {
        state.selected = pr;
        Array.prototype.forEach.call(cont.children, function (c) { c.classList.remove("sel"); });
        b.classList.add("sel");
        $("#btn-confirm").disabled = false;
      });
      cont.appendChild(b);
    });
  }

  function confirmAssign() {
    if (!state.current || !state.selected) return;
    var btn = $("#btn-confirm");
    btn.disabled = true; btn.textContent = "Enviando…";
    $("#modal-error").hidden = true;

    api({
      panel: "asignar", key: state.key, id: state.current.id,
      premio: state.selected.premio, vendedor: state.vendedor
    }).then(function (res) {
      if (res && res.ok) {
        var nom = (res.nombre || state.current.nombre || "").split(" ")[0];
        toast("Premio asignado a " + nom + (res.correo ? " · correo enviado ✅" : " · (correo falló, revisar)"), res.correo ? "ok" : "bad");
        closeModal();
        poll();
      } else if (res && res.error === "ya_atendido") {
        showErr($("#modal-error"), "Otro vendedor ya lo atendió (" + (res.vendedor || "") + ").");
        btn.textContent = "Confirmar y enviar correo";
      } else {
        showErr($("#modal-error"), "No se pudo guardar. Intenta de nuevo.");
        btn.disabled = false; btn.textContent = "Confirmar y enviar correo";
      }
    }).catch(function () {
      showErr($("#modal-error"), "Sin conexión. Intenta de nuevo.");
      btn.disabled = false; btn.textContent = "Confirmar y enviar correo";
    });
  }

  function closeModal() {
    var cur = state.current;
    $("#modal").hidden = true;
    state.current = null; state.selected = null;
    // Suelta el bloqueo (si no se asignó, queda libre para otros).
    if (cur) api({ panel: "unlock", key: state.key, id: cur.id, vendedor: state.vendedor }).catch(function () {});
  }

  /* --------------------------- Utils ------------------------------------- */
  function toast(msg, kind) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast " + (kind || "");
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.hidden = true; }, 3400);
  }

  function agoTxt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return "hace " + s + "s";
    var m = Math.floor(s / 60);
    if (m < 60) return "hace " + m + " min";
    var h = Math.floor(m / 60);
    return "hace " + h + " h";
  }

  function hora() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* --------------------------- Arranque ---------------------------------- */
  initLogin();
})();
