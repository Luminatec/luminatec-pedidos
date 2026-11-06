// POST /api/change-password  { token, currentPassword, newPassword } -> { ok, token }
import { verifyToken, signToken, readBody } from "./_lib.js";
import { ensureSchema, getUserById, sql } from "./_db.js";
import bcrypt from "bcryptjs";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const secret = process.env.APP_SECRET;
    await ensureSchema();
    const { token, currentPassword, newPassword } = await readBody(req);

    const claims = verifyToken(token, secret);
    if (!claims) { res.status(401).json({ ok: false, error: "Sesión inválida o vencida — volvé a entrar" }); return; }
    if (!newPassword || String(newPassword).length < 8) {
      res.status(400).json({ ok: false, error: "La nueva contraseña debe tener al menos 8 caracteres" }); return;
    }

    const user = await getUserById(claims.uid);
    if (!user || !user.active) { res.status(401).json({ ok: false, error: "Usuario no válido" }); return; }

    const ok = await bcrypt.compare(String(currentPassword || ""), user.pass_hash || "");
    if (!ok) { res.status(400).json({ ok: false, error: "La contraseña actual no es correcta" }); return; }

    const hash = await bcrypt.hash(String(newPassword), 10);
    await sql`UPDATE users SET pass_hash=${hash}, must_change=false, updated_at=now() WHERE id=${user.id}`;

    const newToken = signToken({ uid: Number(user.id), role: user.role, vn: user.name, mc: false }, secret);
    res.status(200).json({ ok: true, token: newToken });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
