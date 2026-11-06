// POST /api/forgot-password  { email } -> { ok }  (siempre ok, sin revelar si el mail existe)
// Envía un mail con un enlace de reseteo (requiere dominio verificado en Resend).
import { readBody } from "./_lib.js";
import { ensureSchema, getUserByEmail, sql } from "./_db.js";
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  const respondOk = () => res.status(200).json({ ok: true });
  try {
    await ensureSchema();
    const { email } = await readBody(req);
    if (!email) return respondOk();

    const user = await getUserByEmail(email);
    if (!user || !user.active || !user.email) return respondOk();

    const raw = crypto.randomBytes(32).toString("hex");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await sql`INSERT INTO reset_tokens (token_hash, user_id, expires_at) VALUES (${hash}, ${user.id}, ${expires.toISOString()})`;

    const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const link = `${proto}://${host}/#reset=${raw}`;

    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    if (key && from) {
      const html = `
        <div style="font-family:Arial,sans-serif;color:#17181a;max-width:520px">
          <h2 style="margin:0 0 8px">Restablecer tu contraseña</h2>
          <p style="margin:0 0 12px">Hola ${escapeHtml(user.name || "")}, recibimos un pedido para restablecer tu contraseña del Tomador de Pedidos de Luminatec.</p>
          <p style="margin:0 0 16px"><a href="${link}" style="background:#FD0029;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;display:inline-block;font-weight:700">Crear nueva contraseña</a></p>
          <p style="margin:0 0 6px;font-size:13px;color:#555">O copiá y pegá este enlace en el navegador:</p>
          <p style="margin:0 0 16px;font-size:12px;color:#777;word-break:break-all">${link}</p>
          <p style="margin:0;font-size:12px;color:#999">El enlace vence en 1 hora. Si no fuiste vos, ignorá este mail.</p>
        </div>`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [user.email],
          subject: "Restablecer contraseña · Tomador de Pedidos Luminatec",
          html,
        }),
      }).catch(() => {});
    }
    return respondOk();
  } catch (e) {
    // No revelamos errores internos en este endpoint
    return respondOk();
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
