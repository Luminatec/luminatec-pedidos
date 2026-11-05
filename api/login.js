// POST /api/login  { vendorId, vendorName, password }  -> { ok, token }
import { signToken, readBody } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const { vendorId, vendorName, password } = await readBody(req);
    if (!vendorId || !password) { res.status(400).json({ ok: false, error: "Faltan datos" }); return; }

    const secret = process.env.APP_SECRET;
    if (!secret) { res.status(500).json({ ok: false, error: "Falta configurar APP_SECRET" }); return; }

    // Contraseñas por vendedor: env VENDOR_PASSWORDS = JSON { "<vendorId>": "<password>" }
    // Si no está definido, se usa una única clave de equipo: env TEAM_PASSWORD
    let ok = false;
    if (process.env.VENDOR_PASSWORDS) {
      let map = {};
      try { map = JSON.parse(process.env.VENDOR_PASSWORDS); } catch { map = {}; }
      ok = map[String(vendorId)] != null && String(map[String(vendorId)]) === String(password);
    } else if (process.env.TEAM_PASSWORD) {
      ok = String(process.env.TEAM_PASSWORD) === String(password);
    } else {
      res.status(500).json({ ok: false, error: "Falta configurar VENDOR_PASSWORDS o TEAM_PASSWORD" });
      return;
    }

    if (!ok) { res.status(401).json({ ok: false, error: "Contraseña incorrecta" }); return; }

    const token = signToken({ vid: String(vendorId), vn: vendorName || "" }, secret);
    res.status(200).json({ ok: true, token });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
