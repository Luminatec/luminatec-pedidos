// POST /api/meta  { token }
// Devuelve catálogos de Odoo para los selectores del pedido:
//   { ok, paymentTerms:[{id,name}], carriers:[{id,name}] }
// Requiere un token de sesión válido. Solo lectura.
import { verifyToken, odooExec, readBody } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const body = await readBody(req);
    const claims = verifyToken(body.token, process.env.APP_SECRET);
    if (!claims) { res.status(401).json({ ok: false, error: "Sesión inválida o vencida — volvé a entrar" }); return; }

    const out = { ok: true };

    // Odoo es multi-empresa. Los plazos/transportes son por empresa, así que
    // SOLO mostramos los de la empresa 6 (Co6) o los compartidos (company_id=false).
    // Si mostráramos los de otra empresa, Odoo rechaza el pedido al cargarlo.
    const companyId = Number(process.env.ODOO_COMPANY_ID || 6);
    const coDomain = ["|", ["company_id", "=", companyId], ["company_id", "=", false]];

    // Plazos de pago (account.payment.term)
    try {
      out.paymentTerms = await odooExec(
        "account.payment.term", "search_read",
        [coDomain], { fields: ["id", "name"], order: "name" }
      );
    } catch (e) { out.paymentTerms = []; out.paymentTermsError = String(e.message || e); }

    // Transportes (delivery.carrier) — puede no estar instalado el módulo
    try {
      out.carriers = await odooExec(
        "delivery.carrier", "search_read",
        [coDomain], { fields: ["id", "name"], order: "name" }
      );
    } catch (e) { out.carriers = []; }

    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
