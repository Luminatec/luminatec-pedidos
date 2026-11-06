// POST /api/reset-password  { token, newPassword } -> { ok }
import { readBody } from "./_lib.js";
import { ensureSchema, sql } from "./_db.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    await ensureSchema();
    const { token, newPassword } = await readBody(req);
    if (!token || !newPassword || String(newPassword).length < 8) {
      res.status(400).json({ ok: false, error: "La nueva contraseña debe tener al menos 8 caracteres" }); return;
    }
    const hash = crypto.createHash("sha256").update(String(token)).digest("hex");
    const rows = await sql`SELECT * FROM reset_tokens WHERE token_hash=${hash} LIMIT 1`;
    const rt = rows[0];
    if (!rt || rt.used || new Date(rt.expires_at) < new Date()) {
      res.status(400).json({ ok: false, error: "El enlace venció o ya fue usado. Pedí uno nuevo." }); return;
    }
    const ph = await bcrypt.hash(String(newPassword), 10);
    await sql`UPDATE users SET pass_hash=${ph}, must_change=false, updated_at=now() WHERE id=${rt.user_id}`;
    await sql`UPDATE reset_tokens SET used=true WHERE token_hash=${hash}`;
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
