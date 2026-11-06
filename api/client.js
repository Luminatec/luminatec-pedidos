// POST /api/client  { token, partnerId }
// Devuelve las direcciones del cliente cargadas en Odoo (la empresa + sus contactos/
// direcciones hijas), para elegir la dirección de entrega del pedido.
//   { ok, addresses:[{id,name,type,label}] }
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
    res.status(200).json({ ok: true, addresses });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
