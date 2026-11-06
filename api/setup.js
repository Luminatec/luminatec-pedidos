// POST /api/setup  { token }  (token === SETUP_TOKEN)  -> crea tablas y siembra usuarios.
// Siembra los 14 vendedores (sin contraseña: el admin les asigna una temporal desde el panel)
// y el usuario administrador (con ADMIN_INITIAL_PASSWORD, que debe cambiar en el primer ingreso).
import { readBody } from "./_lib.js";
import { ensureSchema, sql } from "./_db.js";
import bcrypt from "bcryptjs";

const VENDORS = [
  { id: 152238, name: "GERENCIA COMERCIAL" },
  { id: 152432, name: "PEREZ KOHUT HORACIO GUSTAVO" },
  { id: 49121, name: "LUCAS RIVERO JAVIER" },
  { id: 49142, name: "MARTIN JAGODNIK" },
  { id: 49338, name: "EDUARDO MIGUEL MORENO" },
  { id: 120501, name: "FLOMAT REPRESENTACIONES SRL" },
  { id: 49339, name: "RUBEN ENRIQUE CARRIZO" },
  { id: 152394, name: "MAGENTA PABLO MATIAS" },
  { id: 49340, name: "SOFIA JOSE MARIA" },
  { id: 156600, name: "Adrian Hugo Giosa" },
  { id: 155658, name: "Maximiliano Alejandro Figueroa" },
  { id: 49014, name: "GARCIA EDUARDO DANIEL" },
  { id: 150857, name: "Antonio Iglesias" },
  { id: 152243, name: "Mariano Toman" },
];

const ADMIN_ID = 900001;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const { token } = await readBody(req);
    if (!process.env.SETUP_TOKEN || token !== process.env.SETUP_TOKEN) {
      res.status(403).json({ ok: false, error: "SETUP_TOKEN inválido o no configurado" }); return;
    }
    await ensureSchema();

    // Vendedores: sin contraseña (pass_hash NULL). El admin asigna la temporal desde el panel.
    for (const v of VENDORS) {
      await sql`INSERT INTO users (id, name, role, must_change, active)
                VALUES (${v.id}, ${v.name}, 'vendor', true, true)
                ON CONFLICT (id) DO UPDATE SET name=${v.name}`;
    }

    // Administrador
    const adminEmail = (process.env.ADMIN_EMAIL || "ivarela@luminatec.com").toLowerCase();
    const adminName = process.env.ADMIN_NAME || "Nacho Varela";
    const adminPass = process.env.ADMIN_INITIAL_PASSWORD;
    let adminSeeded = false;
    if (adminPass && String(adminPass).length >= 6) {
      const h = await bcrypt.hash(String(adminPass), 10);
      await sql`INSERT INTO users (id, name, email, role, pass_hash, must_change, active)
                VALUES (${ADMIN_ID}, ${adminName}, ${adminEmail}, 'admin', ${h}, true, true)
                ON CONFLICT (id) DO UPDATE SET name=${adminName}, email=${adminEmail}, role='admin', pass_hash=${h}, must_change=true, active=true`;
      adminSeeded = true;
    }

    const cnt = await sql`SELECT count(*)::int AS n FROM users`;
    res.status(200).json({
      ok: true,
      totalUsers: cnt[0].n,
      vendorsSeeded: VENDORS.length,
      adminSeeded,
      adminEmail: adminSeeded ? adminEmail : null,
      note: adminSeeded
        ? "Listo. Entrá como admin con ADMIN_INITIAL_PASSWORD; te pedirá cambiarla."
        : "Vendedores sembrados. Falta ADMIN_INITIAL_PASSWORD para crear el admin.",
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
