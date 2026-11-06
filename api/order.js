// POST /api/order
// body: { token, client:{id,name,vat}, vendorName, orderNo, items:[{tmplId,qty,price,name,sku}],
//         total, sendOdoo, sendMail }
// -> crea presupuesto borrador en Odoo (si sendOdoo) y manda mail (si sendMail)
import { verifyToken, odooExec, readBody } from "./_lib.js";

const money = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");

function buildHtml({ orderNo, vendorName, client, items, total, extra = {} }) {
  const exLines = [];
  if (extra.transporte) exLines.push(["Transporte", extra.transporte]);
  if (extra.direccion) exLines.push(["Dirección de entrega", extra.direccion]);
  if (extra.plazoName) exLines.push(["Plazo de pago", extra.plazoName]);
  if (extra.comentarios) exLines.push(["Comentarios", extra.comentarios]);
  const extraHtml = exLines.length
    ? `<div style="margin:0 0 12px;font-size:13px;line-height:1.5">${exLines.map((r) => `<div><b>${escapeHtml(r[0])}:</b> ${escapeHtml(r[1])}</div>`).join("")}</div>`
    : "";
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee">${it.sku || ""}</td>` +
        `<td style="padding:4px 10px;border-bottom:1px solid #eee">${escapeHtml(it.name || "")}</td>` +
        `<td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right">${it.qty}</td>` +
        `<td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right">${money(it.price)}</td>` +
        `<td style="padding:4px 10px;border-bottom:1px solid #eee;text-align:right">${money(it.qty * it.price)}</td></tr>`
    )
    .join("");
  return `
  <div style="font-family:Arial,sans-serif;color:#17181a">
    <h2 style="margin:0 0 4px">Nota de pedido ${orderNo || ""}</h2>
    <p style="margin:0 0 2px"><b>Vendedor:</b> ${escapeHtml(vendorName || "")}</p>
    <p style="margin:0 0 12px"><b>Cliente:</b> ${escapeHtml(client?.name || "")}${client?.vat ? " · CUIT " + client.vat : ""}</p>
    ${extraHtml}
    <table style="border-collapse:collapse;width:100%;font-size:13px">
      <thead><tr>
        <th style="text-align:left;padding:4px 10px;border-bottom:2px solid #333">SKU</th>
        <th style="text-align:left;padding:4px 10px;border-bottom:2px solid #333">Producto</th>
        <th style="text-align:right;padding:4px 10px;border-bottom:2px solid #333">Cant.</th>
        <th style="text-align:right;padding:4px 10px;border-bottom:2px solid #333">P.Unit</th>
        <th style="text-align:right;padding:4px 10px;border-bottom:2px solid #333">Subtotal</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="text-align:right;font-size:16px;margin:12px 0 0"><b>Total: ${money(total)}</b></p>
  </div>`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const body = await readBody(req);
    const { token, client, vendorName, orderNo, items = [], total, extra = {}, sendOdoo = true, sendMail = true } = body;

    const claims = verifyToken(token, process.env.APP_SECRET);
    if (!claims) { res.status(401).json({ ok: false, error: "Sesión inválida o vencida — volvé a entrar" }); return; }
    if (claims.mc) { res.status(403).json({ ok: false, error: "Tenés que cambiar tu contraseña antes de cargar pedidos." }); return; }
    if (!client?.id || !items.length) { res.status(400).json({ ok: false, error: "Pedido vacío o sin cliente" }); return; }

    const result = { ok: true };

    // ---- 1) Crear presupuesto borrador en Odoo ----
    if (sendOdoo) {
      const tmplIds = [...new Set(items.map((i) => Number(i.tmplId)))];
      const tmpls = await odooExec("product.template", "read", [tmplIds, ["product_variant_id"]]);
      const variantByTmpl = {};
      for (const t of tmpls) variantByTmpl[t.id] = Array.isArray(t.product_variant_id) ? t.product_variant_id[0] : null;

      const orderLine = [];
      for (const it of items) {
        const vId = variantByTmpl[Number(it.tmplId)];
        if (!vId) continue;
        orderLine.push([0, 0, {
          product_id: vId,
          product_uom_qty: Number(it.qty) || 0,
          price_unit: Number(it.price) || 0,
          name: it.name || undefined,
        }]);
      }

      const company = Number(process.env.ODOO_COMPANY_ID || 6);

      // --- Resolver plazo de pago de forma AUTORITATIVA contra la base actual ---
      // No confiamos a ciegas en el id que manda el navegador (puede venir de un
      // cache viejo con ids cruzados, o ser texto libre). Si hay nombre, lo buscamos
      // por nombre en account.payment.term; recién si no hay nombre usamos el id.
      // Odoo es multi-empresa: el plazo tiene que ser de la empresa del pedido (Co6)
      // o compartido (company_id=false). Si no, Odoo rechaza la orden por
      // "empresas incompatibles". Por eso acotamos la búsqueda a esa empresa.
      const coDomain = ["|", ["company_id", "=", company], ["company_id", "=", false]];
      let termId = null, termName = null;
      const wantTermName = String(extra.plazoName || "").trim();
      const wantTermId = (typeof extra.plazoId === "number" && extra.plazoId > 0) ? extra.plazoId : null;
      try {
        if (wantTermName) {
          const f = await odooExec("account.payment.term", "search_read",
            [[...coDomain, ["name", "=ilike", wantTermName]]], { fields: ["id", "name"], limit: 1 });
          if (f && f[0]) { termId = f[0].id; termName = f[0].name; }
        }
        if (termId == null && wantTermName === "" && wantTermId) {
          const f = await odooExec("account.payment.term", "search_read",
            [[...coDomain, ["id", "=", wantTermId]]], { fields: ["id", "name"], limit: 1 });
          if (f && f[0]) { termId = f[0].id; termName = f[0].name; }
        }
      } catch (e) { /* módulo/campo ausente: se ignora, queda solo en la nota */ }

      // Nombre del plazo para la nota: lo resuelto si existe, si no lo que tipeó el usuario.
      const plazoNoteName = termName || wantTermName;

      const noteLines = [`Pedido ${orderNo || ""} cargado por ${vendorName || ""} desde el Tomador de Pedidos.`];
      if (extra.transporte) noteLines.push(`Transporte: ${extra.transporte}`);
      if (extra.direccion) noteLines.push(`Dirección de entrega: ${extra.direccion}`);
      // Si NO pudimos mapearlo a un término real de Odoo, lo dejamos aclarado en la nota.
      if (plazoNoteName && termId == null) noteLines.push(`Plazo de pago: ${plazoNoteName}`);
      if (extra.comentarios) noteLines.push(`Comentarios: ${extra.comentarios}`);
      const vals = {
        partner_id: Number(client.id),
        company_id: company,
        order_line: orderLine,
        note: noteLines.join("\n"),
      };
      if (termId != null) vals.payment_term_id = termId;
      if (typeof extra.transporteId === "number" && extra.transporteId > 0) vals.carrier_id = extra.transporteId;
      if (typeof extra.direccionId === "number" && extra.direccionId > 0) vals.partner_shipping_id = extra.direccionId;
      if (process.env.ODOO_SALESPERSON_UID) vals.user_id = Number(process.env.ODOO_SALESPERSON_UID);

      const orderId = await odooExec("sale.order", "create", [vals]);

      // --- Verificar que Odoo no haya recomputado los campos desde el cliente ---
      // Algunas versiones de Odoo recalculan payment_term_id / partner_shipping_id
      // al crear (onchange del partner). Releemos y, si no coincide con lo pedido,
      // forzamos con un write. Un write post-create no sufre ese recálculo.
      const fixWrite = {};
      try {
        const chk = await odooExec("sale.order", "read",
          [[orderId], ["name", "payment_term_id", "carrier_id", "partner_shipping_id"]]);
        const row = chk?.[0] || {};
        const idOf = (v) => (Array.isArray(v) ? v[0] : (v || null));
        if (termId != null && idOf(row.payment_term_id) !== termId) fixWrite.payment_term_id = termId;
        if (vals.carrier_id && idOf(row.carrier_id) !== vals.carrier_id) fixWrite.carrier_id = vals.carrier_id;
        if (vals.partner_shipping_id && idOf(row.partner_shipping_id) !== vals.partner_shipping_id) fixWrite.partner_shipping_id = vals.partner_shipping_id;
        if (Object.keys(fixWrite).length) await odooExec("sale.order", "write", [[orderId], fixWrite]);
      } catch (e) { /* no crítico */ }

      const read = await odooExec("sale.order", "read", [[orderId], ["name", "payment_term_id"]]);
      result.odooId = orderId;
      result.odooName = read?.[0]?.name || String(orderId);
      // Devolvemos el plazo REALMENTE aplicado para que el front pueda confirmarlo.
      const appliedTerm = read?.[0]?.payment_term_id;
      result.appliedPaymentTerm = Array.isArray(appliedTerm) ? appliedTerm[1] : null;
      if (plazoNoteName && termId == null) result.paymentTermUnmatched = plazoNoteName;
    }

    // ---- 2) Enviar mail (Resend) ----
    if (sendMail) {
      const key = process.env.RESEND_API_KEY;
      const to = (process.env.MAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
      const from = process.env.MAIL_FROM;
      if (key && to.length && from) {
        const subject = `Nuevo pedido ${orderNo || ""} · ${client.name}${result.odooName ? " · Odoo " + result.odooName : ""}`;
        const html = buildHtml({ orderNo, vendorName, client, items, total, extra });
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, subject, html }),
        });
        if (!r.ok) { result.mailWarning = "El pedido se creó, pero el mail falló: " + (await r.text()).slice(0, 200); }
        else { result.mailSent = true; }
      } else {
        result.mailWarning = "Mail no configurado (RESEND_API_KEY / MAIL_FROM / MAIL_TO).";
      }
    }

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
