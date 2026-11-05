// POST /api/order
// body: { token, client:{id,name,vat}, vendorName, orderNo, items:[{tmplId,qty,price,name,sku}],
//         total, sendOdoo, sendMail }
// -> crea presupuesto borrador en Odoo (si sendOdoo) y manda mail (si sendMail)
import { verifyToken, odooExec, readBody } from "./_lib.js";

const money = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");

function buildHtml({ orderNo, vendorName, client, items, total }) {
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
    const { token, client, vendorName, orderNo, items = [], total, sendOdoo = true, sendMail = true } = body;

    const claims = verifyToken(token, process.env.APP_SECRET);
    if (!claims) { res.status(401).json({ ok: false, error: "Sesión inválida o vencida — volvé a entrar" }); return; }
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
      const vals = {
        partner_id: Number(client.id),
        company_id: company,
        order_line: orderLine,
        note: `Pedido ${orderNo || ""} cargado por ${vendorName || ""} desde el Tomador de Pedidos.`,
      };
      if (process.env.ODOO_SALESPERSON_UID) vals.user_id = Number(process.env.ODOO_SALESPERSON_UID);

      const orderId = await odooExec("sale.order", "create", [vals]);
      const read = await odooExec("sale.order", "read", [[orderId], ["name"]]);
      result.odooId = orderId;
      result.odooName = read?.[0]?.name || String(orderId);
    }

    // ---- 2) Enviar mail (Resend) ----
    if (sendMail) {
      const key = process.env.RESEND_API_KEY;
      const to = (process.env.MAIL_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
      const from = process.env.MAIL_FROM;
      if (key && to.length && from) {
        const subject = `Nuevo pedido ${orderNo || ""} · ${client.name}${result.odooName ? " · Odoo " + result.odooName : ""}`;
        const html = buildHtml({ orderNo, vendorName, client, items, total });
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
