// POST /api/client  { token, partnerId }
// Devuelve lo que el cliente ya tiene cargado en Odoo para precargar el pedido:
//   { ok, addresses:[{id,name,type,label}], defaultCarrier:{id,name}|null, defaultPaymentTerm:{id,name}|null }
import { verifyToken, odooExec, readBody } from "./_lib.js";

function labelOf(p) {
  const parts = [];
  if (p.street) parts.push(p.street);
  if (p.street2) parts.push(p.street2);
  if (p.city) parts.push(p.city);
  const addr = parts.join(", ");
  const typeEs = { delivery: "Entrega", invoice: "Facturación", contact: "Contacto", other: "Otra" }[p.type] || "";
  return (p.name ? p.name : "") + (addr ? " — " + addr : "") + (typeEs ? " (" + typeEs + ")" : "");
}

const m2o = (v) => (Array.isArray(v) && v.length >= 2 ? { id: v[0], name: v[1] } : null);

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const body = await readBody(req);
    const claims = verifyToken(body.token, process.env.APP_SECRET);
    if (!claims) { res.status(401).json({ ok: false, error: "Sesión inválida o vencida — volvé a entrar" }); return; }
    const pid = Number(body.partnerId);
    if (!pid) { res.status(400).json({ ok: false, error: "Falta partnerId" }); return; }

    // La empresa + sus direcciones/contactos hijos
    const rows = await odooExec(
      "res.partner", "search_read",
      [["|", ["id", "=", pid], ["parent_id", "=", pid]]],
      { fields: ["id", "name", "type", "street", "street2", "city"], order: "type,id" }
    );
    const addresses = (rows || []).map((p) => ({ id: p.id, name: p.name, type: p.type, label: labelOf(p) }));

    // Transporte y plazo por defecto del cliente (campos opcionales según módulos de Odoo)
    let defaultCarrier = null, defaultPaymentTerm = null;
    try {
      const main = await odooExec("res.partner", "read", [[pid], ["property_delivery_carrier_id", "property_payment_term_id"]]);
      if (main && main[0]) {
        defaultCarrier = m2o(main[0].property_delivery_carrier_id);
        defaultPaymentTerm = m2o(main[0].property_payment_term_id);
      }
    } catch (e) { /* campo inexistente en esta instancia: se ignora */ }

    res.status(200).json({ ok: true, addresses, defaultCarrier, defaultPaymentTerm });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
