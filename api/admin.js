// POST /api/admin  { token, action, ... }  (requiere usuario con role='admin')
// actions:
//   list                               -> { ok, users:[...] }
//   create  { id, name, email, role }  -> { ok, tempPassword }
//   update  { id, name, email, role }  -> { ok }
//   resetPassword { id }               -> { ok, tempPassword }
//   setActive { id, active }           -> { ok }
import { verifyToken, readBody } from "./_lib.js";
import { ensureSchema, getUserById, sql } from "./_db.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

function genTemp() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin ambiguos (0/O, 1/I/L)
  const buf = crypto.randomBytes(9);
  let s = "";
  for (let i = 0; i < 9; i++) s += chars[buf[i] % chars.length];
  return s.slice(0, 4) + "-" + s.slice(4, 9); // ej: K3M7-QP9TX
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const secret = process.env.APP_SECRET;
    await ensureSchema();
    const body = await readBody(req);

    const claims = verifyToken(body.token, secret);
    if (!claims || claims.role !== "admin") { res.status(403).json({ ok: false, error: "No autorizado" }); return; }
    const admin = await getUserById(claims.uid);
    if (!admin || admin.role !== "admin" || !admin.active) { res.status(403).json({ ok: false, error: "No autorizado" }); return; }

    const action = body.action;

    if (action === "list") {
      const users = await sql`SELECT id, name, email, role, must_change, active, updated_at
                              FROM users ORDER BY (role='admin') DESC, name ASC`;
      res.status(200).json({ ok: true, users });
      return;
    }

    if (action === "create") {
      const id = Number(body.id);
      const name = String(body.name || "").trim();
      const email = body.email ? String(body.email).trim() : null;
      const role = body.role === "admin" ? "admin" : "vendor";
      if (!id || !name) { res.status(400).json({ ok: false, error: "Falta id o nombre" }); return; }
      const tmp = genTemp();
      const hash = await bcrypt.hash(tmp, 10);
      await sql`INSERT INTO users (id, name, email, role, pass_hash, must_change, active)
                VALUES (${id}, ${name}, ${email}, ${role}, ${hash}, true, true)
                ON CONFLICT (id) DO UPDATE SET
                  name=${name}, email=COALESCE(${email}, users.email),
                  role=${role}, pass_hash=${hash}, must_change=true, active=true, updated_at=now()`;
      res.status(200).json({ ok: true, tempPassword: tmp });
      return;
    }

    if (action === "update") {
      const id = Number(body.id);
      if (!id) { res.status(400).json({ ok: false, error: "Falta id" }); return; }
      const name = body.name != null ? String(body.name).trim() : null;
      const role = (body.role === "admin" || body.role === "vendor") ? body.role : null;
      // nombre / rol: se actualizan si vienen (COALESCE)
      await sql`UPDATE users SET name = COALESCE(${name}, name),
                                 role = COALESCE(${role}, role),
                                 updated_at = now()
                WHERE id=${id}`;
      // email: solo si viene la propiedad (permite fijarlo o limpiarlo)
      if (Object.prototype.hasOwnProperty.call(body, "email")) {
        const email = body.email ? String(body.email).trim() : null;
        await sql`UPDATE users SET email=${email}, updated_at=now() WHERE id=${id}`;
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "resetPassword") {
      const id = Number(body.id);
      if (!id) { res.status(400).json({ ok: false, error: "Falta id" }); return; }
      const tmp = genTemp();
      const hash = await bcrypt.hash(tmp, 10);
      await sql`UPDATE users SET pass_hash=${hash}, must_change=true, updated_at=now() WHERE id=${id}`;
      res.status(200).json({ ok: true, tempPassword: tmp });
      return;
    }

    if (action === "setActive") {
      const id = Number(body.id);
      if (!id) { res.status(400).json({ ok: false, error: "Falta id" }); return; }
      if (id === Number(admin.id) && !body.active) {
        res.status(400).json({ ok: false, error: "No podés desactivarte a vos mismo" }); return;
      }
      await sql`UPDATE users SET active=${!!body.active}, updated_at=now() WHERE id=${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: "Acción desconocida" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
