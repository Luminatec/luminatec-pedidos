/* Luminatec · Tomador de Pedidos — capa de integración (login real, offline, envío a mail/Odoo).
   Se apoya en variables/funciones globales del script principal: ST, save, show, ctx,
   renderClients, updateCartBar, closeModal, BYID, VENDORS. Todo con guardas por si cambia algo. */
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

  // ---------- Cola offline (IndexedDB) ----------
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

  // ---------- Login con contraseña ----------
  function wireLogin() {
    const card = document.querySelector("#scr-login .center-card") || document.getElementById("scr-login");
    const sel = document.getElementById("vsel");
    const btn = document.getElementById("loginBtn");
    if (!sel || !btn || document.getElementById("vpass")) return;

    const lbl = document.createElement("label"); lbl.className = "fld"; lbl.setAttribute("for", "vpass"); lbl.textContent = "Contraseña";
    const inp = document.createElement("input"); inp.className = "inp"; inp.id = "vpass"; inp.type = "password"; inp.autocomplete = "current-password"; inp.placeholder = "Tu contraseña";
    const err = document.createElement("div"); err.id = "loginErr"; err.style.cssText = "color:var(--red);font-size:13px;margin-top:8px;min-height:16px";
    sel.insertAdjacentElement("afterend", lbl);
    lbl.insertAdjacentElement("afterend", inp);

    const spacer = card.querySelector('div[style*="height"]');
    (spacer || btn).insertAdjacentElement("beforebegin", err);

    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") btn.click(); });

    btn.onclick = async () => {
      err.textContent = "";
      const id = parseInt(sel.value, 10);
      const pass = inp.value;
      if (!id) { sel.focus(); return; }
      if (!pass) { inp.focus(); return; }
      const v = (typeof VENDORS !== "undefined" ? VENDORS : []).find((x) => x.id === id);
      const name = v ? v.name : "";

      // offline: permití entrar si ya hay token guardado de este vendedor
      if (!navigator.onLine) {
        if (ST.token && ST.vrid === id) { proceed(id, name); return; }
        err.textContent = "Sin conexión: la primera vez hay que entrar con internet.";
        return;
      }
      btn.disabled = true; btn.textContent = "Entrando…";
      try {
        const { ok, data } = await api("/api/login", { vendorId: id, vendorName: name, password: pass });
        if (ok && data.token) { ST.token = data.token; proceed(id, name); }
        else { err.textContent = data.error || "No se pudo iniciar sesión."; }
      } catch { err.textContent = "Error de conexión. Probá de nuevo."; }
      finally { btn.disabled = false; btn.textContent = "Entrar"; }
    };
  }
  function proceed(id, name) {
    ST.vendor = name; ST.vrid = id; ST.client = null; save(); ctx();
    show("scr-client"); renderClients(); refreshPend();
  }

  // ---------- Envío del pedido ----------
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
        items, total, sendOdoo: opts.sendOdoo, sendMail: opts.sendMail,
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
        if (data.mailSent) msg += " Mail enviado.";
        if (data.mailWarning) msg += `<br><span style="color:var(--muted)">⚠️ ${data.mailWarning}</span>`;
        setNotaStatus(msg, "ok");
        clearCartSoft();
      } else {
        await qAdd({ ...order, status: "pendiente" }); refreshPend();
        setNotaStatus("⚠️ No se pudo enviar ahora (" + (data.error || "error") + "). Quedó en pendientes para reintentar.", "warn");
      }
    } catch {
      await qAdd({ ...order, status: "pendiente" }); refreshPend();
      setNotaStatus("📴 Se cortó la conexión. El pedido quedó en pendientes y se enviará al reconectar.", "warn");
    } finally {
      [btnMail, btnOdoo].forEach((b) => b && (b.disabled = false));
    }
  }

  function clearCartSoft() { ST.cart = {}; try { save(); } catch {} try { updateCartBar(); } catch {} }

  // Interceptar los botones de la nota cada vez que se renderiza
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
      if (note) note.textContent = "El pedido se envía por mail y se carga en Odoo como borrador. Sin conexión queda en pendientes.";
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

  // ---------- Init ----------
  function init() {
    try { wireLogin(); } catch (e) {}
    try { hookNota(); } catch (e) {}
    try { refreshPend(); } catch (e) {}
    // si el script principal ya dejó al usuario logueado (token guardado), nada que hacer
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
