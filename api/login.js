// POST /api/login
//   body: { vendorId, vendorName, password }  (vendedor, por id de cartera)
//      o: { email, password }                 (administrador, por email)
//   -> { ok, token, mustChange, role, name, vid }
import { signToken, readBody } from "./_lib.js";
import { ensureSchema, getUserById, getUserByEmail } from "./_db.js";
import bcrypt from "bcryptjs";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const secret = process.env.APP_SECRET;
    if (!secret) { res.status(500).json({ ok: false, error: "Falta configurar APP_SECRET" }); return; }

    await ensureSchema();
    const { vendorId, email, password } = await readBody(req);
    if (!password || (!vendorId && !email)) { res.status(400).json({ ok: false, error: "Faltan datos" }); return; }

    const user = email
      ? await getUserByEmail(email)
      : await getUserById(Number(vendorId));

    const bad = () => res.status(401).json({ ok: false, error: "Usuario o contraseña incorrectos" });
    if (!user || !user.active || !user.pass_hash) return bad();

    const ok = await bcrypt.compare(String(password), user.pass_hash);
    if (!ok) return bad();

    const mc = !!user.must_change;
    const ac = !!user.allclients;
    const token = signToken({ uid: Number(user.id), role: user.role, vn: user.name, mc, ac }, secret);
    res.status(200).json({
      ok: true,
      token,
      mustChange: mc,
      role: user.role,
      name: user.name,
      vid: Number(user.id),
      allClients: ac,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
