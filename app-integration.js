/* Luminatec · Tomador de Pedidos — capa de integración.
   Login individual por usuario, cambio de clave (obligatorio el 1er ingreso),
   "olvidé mi clave" por mail, reseteo por enlace, panel de administración,
   offline y envío a mail/Odoo.
   Se apoya en globales del script principal: ST, save, show, ctx, renderClients,
   updateCartBar, BYID, VENDORS. Todo con guardas por si algo cambia. */
(function () {
  "use strict";

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  const money = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");
  const api = (path, body) =>
    fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

  // =========================================================================
  //  UI helpers (overlays)
  // =========================================================================
  const CSS = {
    inp: "width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:#0e0f11;color:#fff;font-size:15px;margin:2px 0 10px",
    lbl: "display:block;font-size:13px;color:var(--muted,#9aa3ab);margin:8px 0 2px",
    btn: "width:100%;box-sizing:border-box;padding:12px;border:0;border-radius:10px;background:var(--red,#FD0029);color:#fff;font-weight:700;font-size:15px;cursor:pointer;margin-top:4px",
    ghost: "width:100%;box-sizing:border-box;padding:11px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:transparent;color:var(--fg,#e9e9ea);font-weight:600;font-size:14px;cursor:pointer;margin-top:8px",
    err: "color:var(--red,#FD0029);min-height:16px;font-size:13px;margin:4px 0 2px",
  };
  function overlay() {
    const o = document.createElement("div");
    o.style.cssText = "position:fixed;inset:0;z-index:9000;background:rgba(10,11,13,.94);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:max(24px,env(safe-area-inset-top,0px)) 16px 24px";
    return o;
  }
  function card(maxw) {
    const c = document.createElement("div");
    c.style.cssText = `width:100%;max-width:${maxw || 440}px;background:#17181a;color:var(--fg,#e9e9ea);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5);margin:auto`;
    return c;
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // =========================================================================
  //  Cambio de contraseña
  // =========================================================================
  function showChangePassword({ forced, currentKnown, token, onDone, onCancel }) {
    const o = overlay();
    const c = card();
    const needCur = !(forced && currentKnown);
    c.innerHTML = `
      <h2 style="margin:0 0 6px;font-size:19px">${forced ? "Creá tu nueva contraseña" : "Cambiar contraseña"}</h2>
      <p style="margin:0 0 14px;color:var(--muted,#9aa3ab);font-size:13.5px">${forced ? "Es tu primer ingreso. Elegí una contraseña nueva para continuar." : "Ingresá tu contraseña actual y la nueva."}</p>
      ${needCur ? `<label style="${CSS.lbl}">Contraseña actual</label><input id="cpCur" type="password" autocomplete="current-password" style="${CSS.inp}">` : ""}
      <label style="${CSS.lbl}">Nueva contraseña (mínimo 8)</label>
      <input id="cpNew" type="password" autocomplete="new-password" style="${CSS.inp}">
      <label style="${CSS.lbl}">Repetir nueva contraseña</label>
      <input id="cpNew2" type="password" autocomplete="new-password" style="${CSS.inp}">
      <div id="cpErr" style="${CSS.err}"></div>
      <button id="cpBtn" style="${CSS.btn}">Guardar</button>
      ${forced ? "" : `<button id="cpCancel" style="${CSS.ghost}">Cancelar</button>`}
    `;
    o.appendChild(c); document.body.appendChild(o);
    const $ = (id) => c.querySelector("#" + id);
    const errEl = $("cpErr");
    const go = async () => {
      errEl.textContent = "";
      const cur = needCur ? ($("cpCur").value || "") : currentKnown;
      const n1 = $("cpNew").value || "", n2 = $("cpNew2").value || "";
      if (n1.length < 8) { errEl.textContent = "La nueva contraseña debe tener al menos 8 caracteres."; return; }
      if (n1 !== n2) { errEl.textContent = "Las dos contraseñas nuevas no coinciden."; return; }
      const btn = $("cpBtn"); btn.disabled = true; btn.textContent = "Guardando…";
      try {
        const { ok, data } = await api("/api/change-password", { token: token || ST.token, currentPassword: cur, newPassword: n1 });
        if (ok && data.token) { ST.token = data.token; try { save(); } catch {} o.remove(); onDone && onDone(data.token); }
        else { errEl.textContent = data.error || "No se pudo cambiar la contraseña."; btn.disabled = false; btn.textContent = "Guardar"; }
      } catch { errEl.textContent = "Error de conexión. Probá de nuevo."; btn.disabled = false; btn.textContent = "Guardar"; }
    };
    $("cpBtn").onclick = go;
    $("cpNew2").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    if ($("cpCancel")) $("cpCancel").onclick = () => { o.remove(); onCancel && onCancel(); };
  }

  // =========================================================================
  //  Olvidé mi contraseña
  // =========================================================================
  function showForgot(prefillEmail) {
    const o = overlay(); const c = card();
    c.innerHTML = `
      <h2 style="margin:0 0 6px;font-size:19px">Recuperar contraseña</h2>
      <p style="margin:0 0 14px;color:var(--muted,#9aa3ab);font-size:13.5px">Ingresá tu mail y te enviamos un enlace para crear una nueva contraseña.</p>
      <label style="${CSS.lbl}">Tu mail</label>
      <input id="fpEmail" type="email" autocomplete="email" style="${CSS.inp}" value="${esc(prefillEmail || "")}">
      <div id="fpMsg" style="min-height:16px;font-size:13px;margin:4px 0 2px"></div>
      <button id="fpBtn" style="${CSS.btn}">Enviar enlace</button>
      <button id="fpBack" style="${CSS.ghost}">Volver</button>
    `;
    o.appendChild(c); document.body.appendChild(o);
    const $ = (id) => c.querySelector("#" + id);
    $("fpBtn").onclick = async () => {
      const email = ($("fpEmail").value || "").trim();
      const btn = $("fpBtn"); btn.disabled = true; btn.textContent = "Enviando…";
      try { await api("/api/forgot-password", { email }); } catch {}
      $("fpMsg").style.color = "var(--muted,#9aa3ab)";
      $("fpMsg").textContent = "Si el mail está registrado, vas a recibir un enlace en unos minutos. Revisá spam.";
      btn.textContent = "Enviado";
    };
    $("fpBack").onclick = () => o.remove();
  }

  // =========================================================================
  //  Reseteo por enlace (#reset=<token>)
  // =========================================================================
  function showReset(resetToken) {
    const o = overlay(); const c = card();
    c.innerHTML = `
      <h2 style="margin:0 0 6px;font-size:19px">Nueva contraseña</h2>
      <p style="margin:0 0 14px;color:var(--muted,#9aa3ab);font-size:13.5px">Elegí tu nueva contraseña.</p>
      <label style="${CSS.lbl}">Nueva contraseña (mínimo 8)</label>
      <input id="rpNew" type="password" autocomplete="new-password" style="${CSS.inp}">
      <label style="${CSS.lbl}">Repetir nueva contraseña</label>
      <input id="rpNew2" type="password" autocomplete="new-password" style="${CSS.inp}">
      <div id="rpErr" style="${CSS.err}"></div>
      <button id="rpBtn" style="${CSS.btn}">Guardar</button>
    `;
    o.appendChild(c); document.body.appendChild(o);
    const $ = (id) => c.querySelector("#" + id);
    $("rpBtn").onclick = async () => {
      $("rpErr").textContent = "";
      const n1 = $("rpNew").value || "", n2 = $("rpNew2").value || "";
      if (n1.length < 8) { $("rpErr").textContent = "La contraseña debe tener al menos 8 caracteres."; return; }
      if (n1 !== n2) { $("rpErr").textContent = "Las dos contraseñas no coinciden."; return; }
      const btn = $("rpBtn"); btn.disabled = true; btn.textContent = "Guardando…";
      try {
        const { ok, data } = await api("/api/reset-password", { token: resetToken, newPassword: n1 });
        if (ok && data.ok) {
          c.innerHTML = `<h2 style="margin:0 0 10px;font-size:19px">✅ Contraseña actualizada</h2>
            <p style="margin:0 0 16px;color:var(--muted,#9aa3ab);font-size:14px">Ya podés entrar con tu nueva contraseña.</p>
            <button id="rpOk" style="${CSS.btn}">Ir a ingresar</button>`;
          c.querySelector("#rpOk").onclick = () => { try { history.replaceState(null, "", location.pathname); } catch {} location.reload(); };
        } else { $("rpErr").textContent = data.error || "No se pudo actualizar."; btn.disabled = false; btn.textContent = "Guardar"; }
      } catch { $("rpErr").textContent = "Error de conexión."; btn.disabled = false; btn.textContent = "Guardar"; }
    };
  }

  // =========================================================================
  //  Panel de administración
  // =========================================================================
  async function showAdminPanel() {
    const o = overlay(); o.style.alignItems = "flex-start";
    const c = card(1040);
    c.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px">
        <h2 style="margin:0;font-size:20px">Administración</h2>
        <div style="display:flex;gap:8px">
          <button id="apPass" style="padding:8px 12px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:transparent;color:var(--fg,#e9e9ea);font-size:13px;cursor:pointer">Mi contraseña</button>
          <button id="apOut" style="padding:8px 12px;border:0;border-radius:9px;background:var(--red,#FD0029);color:#fff;font-weight:600;font-size:13px;cursor:pointer">Salir</button>
        </div>
      </div>
      <p style="margin:0 0 12px;color:var(--muted,#9aa3ab);font-size:13px">Usuarios de la app. "Clave temporal" genera una contraseña que el usuario deberá cambiar al entrar.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button id="apOrder" style="padding:9px 14px;border:0;border-radius:9px;background:var(--red,#FD0029);color:#fff;font-weight:700;font-size:13.5px;cursor:pointer">🧾 Cargar un pedido</button>
        <button id="apAdd" style="padding:9px 14px;border:0;border-radius:9px;background:var(--yellow,#F5C400);color:#17181a;font-weight:700;font-size:13.5px;cursor:pointer">+ Agregar usuario</button>
        <button id="apPL" style="padding:9px 14px;border:1px solid rgba(255,255,255,.18);border-radius:9px;background:transparent;color:var(--fg,#e9e9ea);font-weight:700;font-size:13.5px;cursor:pointer">📄 Listas de precios</button>
      </div>
      <div id="apBanner"></div>
      <div id="apList" style="font-size:13.5px">Cargando…</div>
    `;
    o.appendChild(c); document.body.appendChild(o);
    const $ = (id) => c.querySelector("#" + id);
    $("apOut").onclick = logout;
    $("apPass").onclick = () => showChangePassword({ forced: false, token: ST.token, onDone: () => banner("Contraseña actualizada.", "ok") });
    $("apAdd").onclick = addUser;
    $("apOrder").onclick = () => { o.remove(); enterAdminOrderMode(); };
    $("apPL").onclick = () => showPriceLists();

    function banner(msg, kind, extraHtml) {
      const b = $("apBanner");
      const bg = kind === "ok" ? "rgba(22,163,74,.15)" : kind === "warn" ? "rgba(245,196,0,.16)" : "rgba(253,0,41,.12)";
      b.innerHTML = `<div style="background:${bg};border-radius:10px;padding:10px 12px;margin-bottom:12px;line-height:1.45">${msg}${extraHtml || ""}</div>`;
    }
    function showTemp(name, tmp) {
      banner(`Clave temporal para <b>${esc(name)}</b>:`, "ok",
        `<div style="display:flex;gap:8px;align-items:center;margin-top:8px">
          <code style="font-size:18px;letter-spacing:1px;background:#0e0f11;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px 12px">${esc(tmp)}</code>
          <button id="apCopy" style="padding:8px 12px;border:0;border-radius:8px;background:var(--yellow,#F5C400);color:#17181a;font-weight:700;cursor:pointer">Copiar</button>
         </div>
         <div style="color:var(--muted,#9aa3ab);font-size:12.5px;margin-top:6px">Entregásela al usuario. La cambiará al ingresar. No se vuelve a mostrar.</div>`);
      const cp = $("apCopy");
      if (cp) cp.onclick = () => { try { navigator.clipboard.writeText(tmp); cp.textContent = "Copiado ✓"; } catch { cp.textContent = tmp; } };
    }

    async function load() {
      const { ok, data } = await api("/api/admin", { token: ST.token, action: "list" });
      if (!ok || !data.ok) { $("apList").innerHTML = `<span style="color:var(--red,#FD0029)">${esc(data.error || "No se pudo cargar.")}</span>`; return; }
      const rows = data.users.map((u) => {
        const estado = !u.active ? '<span style="color:#e55">Inactivo</span>'
          : !u.has_pass ? '<span style="color:var(--yellow,#F5C400)">Sin clave</span>'
          : u.must_change ? '<span style="color:var(--yellow,#F5C400)">Debe cambiar</span>'
          : '<span style="color:#49c17a">OK</span>';
        const rol = u.role === "admin" ? '<span style="color:#7ab8ff">admin</span>' : "vendedor";
        const allBadge = (u.allclients && u.role !== "admin") ? ' · <span style="color:#49c17a">todos los clientes</span>' : "";
        const allBtn = u.role === "admin" ? "" : `<button data-act="allcli" data-id="${u.id}" data-all="${u.allclients ? 1 : 0}" style="${rowBtn}">${u.allclients ? "Solo su cartera" : "Todos los clientes"}</button>`;
        return `<tr style="border-top:1px solid rgba(255,255,255,.08)">
          <td style="padding:8px 6px">${esc(u.name)}<div style="color:var(--muted,#9aa3ab);font-size:11.5px">id ${u.id} · ${rol}${allBadge}</div></td>
          <td style="padding:8px 6px;color:var(--muted,#9aa3ab)">${esc(u.email || "—")}</td>
          <td style="padding:8px 6px">${estado}</td>
          <td style="padding:8px 6px;white-space:nowrap;text-align:right">
            <button data-act="temp" data-id="${u.id}" data-name="${esc(u.name)}" style="${rowBtn}">Clave temporal</button>
            <button data-act="email" data-id="${u.id}" data-email="${esc(u.email || "")}" style="${rowBtn}">Mail</button>
            ${allBtn}
            <button data-act="active" data-id="${u.id}" data-active="${u.active ? 1 : 0}" style="${rowBtn}">${u.active ? "Desactivar" : "Activar"}</button>
          </td>
        </tr>`;
      }).join("");
      $("apList").innerHTML = `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:620px">
        <thead><tr style="text-align:left;color:var(--muted,#9aa3ab);font-size:12px">
          <th style="padding:4px 6px">Usuario</th><th style="padding:4px 6px">Mail</th><th style="padding:4px 6px">Estado</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
      c.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => rowAction(b.dataset)));
    }
    const rowBtn = "padding:6px 9px;margin-left:5px;border:1px solid rgba(255,255,255,.16);border-radius:8px;background:transparent;color:var(--fg,#e9e9ea);font-size:12px;cursor:pointer";

    async function rowAction(ds) {
      const id = Number(ds.id);
      if (ds.act === "temp") {
        if (!confirm(`¿Generar una clave temporal nueva para ${ds.name}? La anterior deja de servir.`)) return;
        const { ok, data } = await api("/api/admin", { token: ST.token, action: "resetPassword", id });
        if (ok && data.tempPassword) { showTemp(ds.name, data.tempPassword); load(); } else banner(esc(data.error || "Error"), "err");
      } else if (ds.act === "email") {
        const email = prompt("Mail del usuario (para recuperar contraseña):", ds.email || "");
        if (email === null) return;
        const { ok, data } = await api("/api/admin", { token: ST.token, action: "update", id, email: email.trim() });
        if (ok && data.ok) { banner("Mail actualizado.", "ok"); load(); } else banner(esc(data.error || "Error"), "err");
      } else if (ds.act === "active") {
        const activate = ds.active === "0";
        if (!confirm(activate ? "¿Activar este usuario?" : "¿Desactivar este usuario? No podrá ingresar.")) return;
        const { ok, data } = await api("/api/admin", { token: ST.token, action: "setActive", id, active: activate });
        if (ok && data.ok) { banner(activate ? "Usuario activado." : "Usuario desactivado.", "ok"); load(); } else banner(esc(data.error || "Error"), "err");
      } else if (ds.act === "allcli") {
        const turnOn = ds.all === "0";
        const { ok, data } = await api("/api/admin", { token: ST.token, action: "update", id, allclients: turnOn });
        if (ok && data.ok) { banner(turnOn ? "Ahora ve todos los clientes." : "Ahora ve solo su cartera.", "ok"); load(); } else banner(esc(data.error || "Error"), "err");
      }
    }

    async function addUser() {
      const id = prompt("ID del usuario (para vendedores, el id de Referido de Odoo; para otros, un número único):");
      if (!id) return;
      const name = prompt("Nombre y apellido:");
      if (!name) return;
      const email = prompt("Mail (opcional, para recuperar contraseña):", "") || "";
      const isAdmin = confirm("¿Es administrador? (Aceptar = admin, Cancelar = vendedor)");
      const allclients = isAdmin ? true : confirm("¿Puede cargar pedidos para TODOS los clientes? (Aceptar = sí; Cancelar = solo su cartera)");
      const { ok, data } = await api("/api/admin", { token: ST.token, action: "create", id: Number(id), name: name.trim(), email: email.trim(), role: isAdmin ? "admin" : "vendor", allclients });
      if (ok && data.tempPassword) { showTemp(name, data.tempPassword); load(); } else banner(esc(data.error || "Error"), "err");
    }

    load();
  }

  // =========================================================================
  //  Login
  // =========================================================================
  function wireLogin() {
    const card0 = document.querySelector("#scr-login .center-card") || document.getElementById("scr-login");
    const sel = document.getElementById("vsel");
    const btn = document.getElementById("loginBtn");
    if (!btn || document.getElementById("vpass")) return;

    // Ocultar el selector de vendedores (ya no se elige de una lista) y su etiqueta
    if (sel) {
      sel.style.display = "none";
      const selLbl = document.querySelector('label[for="vsel"]') ||
        (sel.previousElementSibling && /vendedor|usuario|eleg/i.test(sel.previousElementSibling.textContent || "") ? sel.previousElementSibling : null);
      if (selLbl) selLbl.style.display = "none";
    }
    // Ajustar subtítulo si menciona elegir de una lista / cartera
    const sub = [...document.querySelectorAll("#scr-login p, #scr-login .sub, #scr-login .muted, #scr-login small")]
      .find((n) => /eleg|cartera|lista|vendedor/i.test(n.textContent || ""));
    if (sub) sub.textContent = "Ingresá con tu usuario y contraseña.";

    // Campo usuario (mail)
    const mailLbl = document.createElement("label"); mailLbl.className = "fld"; mailLbl.setAttribute("for", "vmail"); mailLbl.textContent = "Usuario (mail)";
    const emailInp = document.createElement("input"); emailInp.className = "inp"; emailInp.id = "vmail"; emailInp.type = "email"; emailInp.autocomplete = "username"; emailInp.placeholder = "tu@mail.com";
    // Campo contraseña
    const lbl = document.createElement("label"); lbl.className = "fld"; lbl.setAttribute("for", "vpass"); lbl.textContent = "Contraseña";
    const inp = document.createElement("input"); inp.className = "inp"; inp.id = "vpass"; inp.type = "password"; inp.autocomplete = "current-password"; inp.placeholder = "Tu contraseña";
    const err = document.createElement("div"); err.id = "loginErr"; err.style.cssText = "color:var(--red,#FD0029);font-size:13px;margin-top:8px;min-height:16px";

    const anchor = sel || btn;
    anchor.insertAdjacentElement("afterend", mailLbl);
    mailLbl.insertAdjacentElement("afterend", emailInp);
    emailInp.insertAdjacentElement("afterend", lbl);
    lbl.insertAdjacentElement("afterend", inp);
    const spacer = card0 && card0.querySelector('div[style*="height"]');
    (spacer || btn).insertAdjacentElement("beforebegin", err);

    // Link: olvidé mi contraseña
    const links = document.createElement("div");
    links.style.cssText = "margin-top:12px;font-size:13px";
    links.innerHTML = `<a id="lnkForgot" href="#" style="color:var(--muted,#9aa3ab);text-decoration:underline">¿Olvidaste tu contraseña?</a>`;
    btn.insertAdjacentElement("afterend", links);
    links.querySelector("#lnkForgot").onclick = (e) => { e.preventDefault(); showForgot(emailInp.value); };

    const doLogin = async () => {
      err.textContent = "";
      const email = (emailInp.value || "").trim();
      const pass = inp.value;
      if (!email) { emailInp.focus(); return; }
      if (!pass) { inp.focus(); return; }
      // offline: permití entrar si ya hay sesión previa
      if (!navigator.onLine) {
        if (ST.token && ST.vrid) { proceed(ST.vrid, ST.vendor); return; }
        err.textContent = "Sin conexión: la primera vez hay que entrar con internet.";
        return;
      }
      btn.disabled = true; btn.textContent = "Entrando…";
      try {
        const { ok, data } = await api("/api/login", { email, password: pass });
        if (ok && data.token) {
          ST.token = data.token;
          loadMeta();
          const done = () => {
            if (data.role === "admin") showAdminPanel();
            else proceed(data.vid, data.name);
          };
          if (data.mustChange) {
            showChangePassword({ forced: true, currentKnown: pass, token: data.token, onDone: () => done() });
          } else done();
        } else { err.textContent = data.error || "No se pudo iniciar sesión."; }
      } catch { err.textContent = "Error de conexión. Probá de nuevo."; }
      finally { btn.disabled = false; btn.textContent = "Entrar"; }
    };
    emailInp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.focus(); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    btn.onclick = doLogin;
  }

  function proceed(id, name) {
    ST.vendor = name; ST.vrid = id; ST.client = null; ST.allClients = !!tokenPayload().ac; ST.isAdmin = false; try { save(); } catch {} try { ctx(); } catch {}
    show("scr-client"); try { renderClients(); } catch {} refreshPend(); mountAccountButton();
  }

  function tokenPayload() {
    try { const p = (ST.token || "").split(".")[0].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(p)); } catch { return {}; }
  }
  // Admin: cargar pedidos viendo TODOS los clientes
  function enterAdminOrderMode() {
    const t = tokenPayload();
    ST.vendor = t.vn || "Administración"; ST.vrid = t.uid || 0; ST.client = null; ST.allClients = true; ST.isAdmin = true;
    try { save(); } catch {} try { ctx(); } catch {}
    show("scr-client"); try { renderClients(); } catch {} refreshPend(); mountAccountButton();
  }

  function logout() {
    try { ST.token = null; ST.vendor = null; ST.vrid = null; ST.client = null; ST.cart = {}; ST.prices = {}; ST.extra = {}; save(); } catch {}
    try { localStorage.removeItem("lumi-meta"); } catch {}
    try { history.replaceState(null, "", location.pathname); } catch {}
    location.reload();
  }

  // Botón flotante "Mi cuenta" (cambiar clave / salir) para vendedores
  function mountAccountButton() {
    if (document.getElementById("acctFab")) return;
    const b = document.createElement("button");
    b.id = "acctFab";
    b.textContent = "Mi cuenta";
    b.style.cssText = "position:fixed;right:max(14px,env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:55;border:0;border-radius:999px;background:rgba(255,255,255,.12);color:var(--fg,#e9e9ea);font-weight:600;font-size:12.5px;padding:9px 14px;backdrop-filter:blur(6px);cursor:pointer";
    b.onclick = () => {
      const o = overlay(); const c = card(360);
      c.innerHTML = `<h2 style="margin:0 0 14px;font-size:18px">Mi cuenta</h2>
        ${ST.isAdmin ? `<button id="mcPanel" style="${CSS.ghost};margin-top:0">Volver al panel de administración</button>` : ""}
        <button id="mcPass" style="${CSS.ghost};margin-top:${ST.isAdmin ? "8px" : "0"}">Cambiar contraseña</button>
        <button id="mcOut" style="${CSS.btn};margin-top:10px;background:var(--red,#FD0029)">Cerrar sesión</button>
        <button id="mcClose" style="${CSS.ghost}">Volver</button>`;
      o.appendChild(c); document.body.appendChild(o);
      c.querySelector("#mcClose").onclick = () => o.remove();
      c.querySelector("#mcOut").onclick = logout;
      c.querySelector("#mcPass").onclick = () => { o.remove(); showChangePassword({ forced: false, token: ST.token, onDone: () => {} }); };
      const mp = c.querySelector("#mcPanel");
      if (mp) mp.onclick = () => { o.remove(); const fab = document.getElementById("acctFab"); if (fab) fab.remove(); showAdminPanel(); };
    };
    document.body.appendChild(b);
  }

  // =========================================================================
  //  Cola offline (IndexedDB)
  // =========================================================================
  const DB_NAME = "lumi-pedidos", STORE = "cola";
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function qAdd(item) { const db = await openDB(); return new Promise((res) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).put(item); t.oncomplete = res; }); }
  async function qAll() { const db = await openDB(); return new Promise((res) => { const out = []; const c = db.transaction(STORE).objectStore(STORE).openCursor(); c.onsuccess = (e) => { const cur = e.target.result; if (cur) { out.push(cur.value); cur.continue(); } else res(out); }; }); }
  async function qDel(id) { const db = await openDB(); return new Promise((res) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).delete(id); t.oncomplete = res; }); }
  async function qCount() { try { return (await qAll()).length; } catch { return 0; } }

  // =========================================================================
  //  Envío del pedido
  // =========================================================================
  function currentOrder(opts) {
    const items = Object.entries(ST.cart || {}).map(([id, qty]) => {
      const p = (typeof BYID !== "undefined" && BYID[id]) || {};
      return { tmplId: Number(id), qty: Number(qty) || 0, price: Number((ST.prices || {})[id]) || 0, name: p.name || "", sku: p.sku || "" };
    }).filter((i) => i.qty > 0);
    const total = items.reduce((a, i) => a + i.qty * i.price, 0);
    const body = document.getElementById("notaBody");
    const m = body && body.textContent.match(/P\d{6,}-\d+/);
    const orderNo = m ? m[0] : "P" + Date.now();
    return {
      id: orderNo, ts: Date.now(),
      payload: {
        token: ST.token, orderNo, vendorName: ST.vendor,
        client: ST.client ? { id: ST.client.id, name: (ST.client.name || "").trim(), vat: ST.client.vat || "" } : null,
        items, total, extra: ST.extra || {}, sendOdoo: opts.sendOdoo, sendMail: opts.sendMail,
      },
    };
  }

  function setNotaStatus(html, kind) {
    let el = document.getElementById("notaStatus");
    if (!el) { el = document.createElement("div"); el.id = "notaStatus"; el.style.cssText = "margin:12px 0 0;font-size:13.5px;line-height:1.4;padding:10px 12px;border-radius:10px"; const b = document.getElementById("notaBody"); if (b) b.appendChild(el); }
    el.style.background = kind === "ok" ? "rgba(22,163,74,.12)" : kind === "warn" ? "rgba(245,196,0,.14)" : "rgba(253,0,41,.10)";
    el.style.color = "var(--fg)";
    el.innerHTML = html;
  }

  async function submitOrder(opts) {
    if (!ST.client || !Object.keys(ST.cart || {}).length) return;
    const order = currentOrder(opts);
    const btnMail = document.getElementById("mailBtn"), btnOdoo = document.getElementById("odooBtn");
    [btnMail, btnOdoo].forEach((b) => b && (b.disabled = true));

    if (!navigator.onLine || !ST.token) {
      await qAdd({ ...order, status: "pendiente" });
      refreshPend();
      setNotaStatus("📴 <b>Sin conexión.</b> El pedido quedó guardado y se enviará solo cuando vuelva internet. Podés seguir cargando.", "warn");
      clearCartSoft();
      return;
    }
    setNotaStatus("Enviando…", "warn");
    try {
      const { ok, data } = await api("/api/order", order.payload);
      if (ok && data.ok) {
        let msg = "✅ <b>Pedido enviado.</b>";
        if (data.odooName) msg += ` Cargado en Odoo como <b>${data.odooName}</b> (borrador para aprobación).`;
        if (data.appliedPaymentTerm) msg += `<br><span style="color:var(--muted)">Plazo aplicado en Odoo: <b>${esc(data.appliedPaymentTerm)}</b>.</span>`;
        if (data.paymentTermUnmatched) msg += `<br><span style="color:var(--muted)">⚠️ El plazo “${esc(data.paymentTermUnmatched)}” no coincide con ninguno cargado en Odoo, quedó anotado en el comentario del pedido.</span>`;
        if (data.mailSent) msg += " Mail enviado.";
        if (data.mailWarning) msg += `<br><span style="color:var(--muted)">⚠️ ${data.mailWarning}</span>`;
        setNotaStatus(msg, "ok");
        clearCartSoft();
      } else {
        if (data.error && /contraseña/i.test(data.error)) {
          setNotaStatus("⚠️ " + esc(data.error), "warn");
        } else {
          await qAdd({ ...order, status: "pendiente" }); refreshPend();
          setNotaStatus("⚠️ No se pudo enviar ahora (" + (data.error || "error") + "). Quedó en pendientes para reintentar.", "warn");
        }
      }
    } catch {
      await qAdd({ ...order, status: "pendiente" }); refreshPend();
      setNotaStatus("📴 Se cortó la conexión. El pedido quedó en pendientes y se enviará al reconectar.", "warn");
    } finally {
      [btnMail, btnOdoo].forEach((b) => b && (b.disabled = false));
    }
  }

  function clearCartSoft() { ST.cart = {}; try { save(); } catch {} try { updateCartBar(); } catch {} }

  function hookNota() {
    const body = document.getElementById("notaBody");
    if (!body) return;
    const obs = new MutationObserver(() => {
      const mail = document.getElementById("mailBtn"), odoo = document.getElementById("odooBtn");
      if (odoo && !odoo.dataset.wired) {
        odoo.dataset.wired = "1"; odoo.textContent = "Enviar pedido";
        odoo.onclick = () => submitOrder({ sendOdoo: true, sendMail: true });
      }
      if (mail && !mail.dataset.wired) {
        mail.dataset.wired = "1"; mail.textContent = "Solo enviar por mail";
        mail.onclick = () => submitOrder({ sendOdoo: false, sendMail: true });
      }
      const note = body.querySelector(".nota-hint, .muted-note") ||
        [...body.querySelectorAll("div,p")].find((n) => /activan en la fase conectada|requiere servidor|próxima fase/i.test(n.textContent || ""));
      if (note && !note.dataset.lumiNote) {
        note.dataset.lumiNote = "1";
        note.textContent = "El pedido se envía por mail y se carga en Odoo como borrador. Sin conexión queda en pendientes.";
      }
    });
    obs.observe(body, { childList: true, subtree: true });
  }

  // ---------- Pendientes ----------
  async function refreshPend() {
    const n = await qCount();
    let fab = document.getElementById("pendFab");
    if (!n) { if (fab) fab.remove(); return; }
    if (!fab) {
      fab = document.createElement("button");
      fab.id = "pendFab";
      fab.style.cssText = "position:fixed;left:max(14px,env(safe-area-inset-left,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:60;border:0;border-radius:999px;background:var(--yellow,#F5C400);color:#17181a;font-weight:700;font-size:13.5px;padding:11px 16px;box-shadow:0 8px 24px rgba(0,0,0,.25);cursor:pointer";
      fab.onclick = flushPend;
      document.body.appendChild(fab);
    }
    fab.textContent = `⟳ ${n} pendiente${n > 1 ? "s" : ""} · Enviar`;
    fab.disabled = false;
  }

  async function flushPend() {
    if (!navigator.onLine) { alert("Seguís sin conexión. Reintentá cuando vuelva internet."); return; }
    const fab = document.getElementById("pendFab");
    if (fab) { fab.disabled = true; fab.textContent = "Enviando pendientes…"; }
    const list = await qAll();
    let okCount = 0, fail = 0;
    for (const item of list) {
      const payload = { ...item.payload, token: ST.token || item.payload.token };
      try {
        const { ok, data } = await api("/api/order", payload);
        if (ok && data.ok) { await qDel(item.id); okCount++; } else fail++;
      } catch { fail++; break; }
    }
    await refreshPend();
    if (okCount) try { updateCartBar(); } catch {}
    if (fail && navigator.onLine) alert(`Se enviaron ${okCount}. Quedan ${fail} con error — reintentá más tarde.`);
  }

  window.addEventListener("online", () => { refreshPend(); qCount().then((n) => { if (n) flushPend(); }); });
  window.addEventListener("offline", refreshPend);

  // =========================================================================
  //  Init
  // =========================================================================
  async function loadMeta() {
    if (!ST || !ST.token) return;
    try {
      const { ok, data } = await api("/api/meta", { token: ST.token });
      if (ok && data && data.ok) {
        window.__lumiMeta = { paymentTerms: data.paymentTerms || [], carriers: data.carriers || [] };
        try { localStorage.setItem("lumi-meta", JSON.stringify(window.__lumiMeta)); } catch {}
        try { if (typeof populatePlazoOptions === "function") populatePlazoOptions(); } catch {}
      }
    } catch {}
  }

  // =========================================================================
  //  Listas de precios
  // =========================================================================
  function fmtSize(n) {
    if (!n) return "";
    return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
  }
  async function showPriceLists() {
    const o = overlay(); o.style.alignItems = "flex-start";
    const c = card(640);
    c.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px">
        <h2 style="margin:0;font-size:18px">Listas de precios</h2>
        <button id="plClose" style="width:auto;margin:0;padding:8px 12px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:transparent;color:var(--fg,#e9e9ea);font-weight:600;cursor:pointer">Cerrar</button>
      </div>
      ${ST.isAdmin ? `<div style="border:1px dashed rgba(255,255,255,.2);border-radius:12px;padding:12px;margin-bottom:14px">
        <label style="${CSS.lbl}">Nombre de la lista</label>
        <input id="plName" placeholder="Ej: Lista mayorista Noviembre" style="${CSS.inp}">
        <input id="plFile" type="file" accept=".pdf,.xls,.xlsx,.csv,image/*" style="color:var(--fg,#e9e9ea);font-size:13px;margin:2px 0 6px">
        <button id="plUp" style="${CSS.btn}">Subir lista</button>
        <div id="plMsg" style="font-size:12.5px;margin-top:8px;color:var(--muted,#9aa3ab)"></div>
      </div>` : ""}
      <div id="plList" style="font-size:13.5px">Cargando…</div>`;
    o.appendChild(c); document.body.appendChild(o);
    c.querySelector("#plClose").onclick = () => o.remove();

    async function load() {
      const box = c.querySelector("#plList");
      const { ok, data } = await api("/api/pricelists", { token: ST.token, action: "list" });
      if (!ok || !data.ok) { box.innerHTML = `<span style="color:var(--red,#FD0029)">${esc((data && data.error) || "No se pudo cargar.")}</span>`; return; }
      const lists = data.lists || [];
      if (!lists.length) { box.innerHTML = `<div style="color:var(--muted,#9aa3ab)">Todavía no hay listas cargadas.</div>`; return; }
      box.innerHTML = lists.map((l) => {
        const d = l.created_at ? new Date(l.created_at).toLocaleDateString("es-AR") : "";
        const sz = fmtSize(Number(l.size));
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid rgba(255,255,255,.08)">
          <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(l.name)}</div><div style="color:var(--muted,#9aa3ab);font-size:11.5px">${esc(d)}${sz ? " · " + sz : ""}</div></div>
          <a href="${esc(l.url)}" target="_blank" rel="noopener" style="flex:none;padding:8px 14px;border-radius:10px;background:var(--red,#FD0029);color:#fff;font-weight:700;font-size:13px;text-decoration:none">Descargar</a>
          ${ST.isAdmin ? `<button data-del="${l.id}" title="Borrar" style="flex:none;padding:8px 10px;border:1px solid rgba(255,255,255,.18);border-radius:10px;background:transparent;color:var(--fg,#e9e9ea);cursor:pointer">🗑</button>` : ""}
        </div>`;
      }).join("");
      box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
        if (!confirm("¿Borrar esta lista de precios?")) return;
        const { ok, data } = await api("/api/pricelists", { token: ST.token, action: "delete", id: Number(b.dataset.del) });
        if (ok && data.ok) load(); else alert((data && data.error) || "Error al borrar");
      }));
    }
    load();

    if (ST.isAdmin) {
      const up = c.querySelector("#plUp");
      up.onclick = async () => {
        const name = (c.querySelector("#plName").value || "").trim();
        const fileInp = c.querySelector("#plFile");
        const file = fileInp.files && fileInp.files[0];
        const msg = c.querySelector("#plMsg");
        if (!name) { msg.textContent = "Poné un nombre para la lista."; return; }
        if (!file) { msg.textContent = "Elegí un archivo."; return; }
        up.disabled = true; msg.textContent = "Subiendo…";
        try {
          const mod = await import("https://esm.sh/@vercel/blob@2.8.2/client");
          const blob = await mod.upload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/blob-upload",
            clientPayload: JSON.stringify({ token: ST.token }),
          });
          const { ok, data } = await api("/api/pricelists", { token: ST.token, action: "register", name, filename: file.name, url: blob.url, size: file.size, contentType: file.type });
          if (ok && data.ok) { msg.textContent = "✓ Lista subida."; c.querySelector("#plName").value = ""; fileInp.value = ""; load(); }
          else { msg.textContent = (data && data.error) || "Se subió el archivo pero falló el registro."; }
        } catch (e) {
          msg.textContent = "Error al subir: " + (e && e.message ? e.message : e);
        } finally { up.disabled = false; }
      };
    }
  }
  window.showPriceLists = showPriceLists;

  function init() {
    // enlace de reseteo por mail
    const m = (location.hash || "").match(/reset=([a-f0-9]{16,})/i);
    if (m) { try { showReset(m[1]); } catch (e) {} }
    try { wireLogin(); } catch (e) {}
    try { hookNota(); } catch (e) {}
    try { loadMeta(); } catch (e) {}
    try { refreshPend(); } catch (e) {}
    // si ya hay sesión de vendedor, mostrar botón de cuenta
    try { if (ST && ST.vrid && document.getElementById("scr-client")) mountAccountButton(); } catch (e) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
