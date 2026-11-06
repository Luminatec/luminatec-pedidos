// POST /api/pricelists  { token, action, ... }
//   list                                   -> { ok, lists:[...] }   (cualquier usuario con sesión)
//   register { name, filename, url, size, contentType }  -> { ok }  (admin; tras subir a Blob)
//   delete   { id }                         -> { ok }   (admin; borra de Blob y de la base)
import { verifyToken, readBody } from "./_lib.js";
import { ensureSchema, sql } from "./_db.js";
import { del } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    await ensureSchema();
    const body = await readBody(req);
    const claims = verifyToken(body.token, process.env.APP_SECRET);
    if (!claims) { res.status(401).json({ ok: false, error: "Sesión inválida o vencida — volvé a entrar" }); return; }

    const action = body.action || "list";

    if (action === "list") {
      const lists = await sql`SELECT id, name, filename, url, size, content_type, created_at
                              FROM price_lists ORDER BY created_at DESC`;
      res.status(200).json({ ok: true, lists });
      return;
    }

    // De acá en adelante, solo administradores
    if (claims.role !== "admin") { res.status(403).json({ ok: false, error: "No autorizado" }); return; }

    if (action === "register") {
      const name = String(body.name || "").trim();
      const url = String(body.url || "").trim();
      if (!name || !url) { res.status(400).json({ ok: false, error: "Falta nombre o archivo" }); return; }
      await sql`INSERT INTO price_lists (name, filename, url, size, content_type, uploaded_by)
                VALUES (${name}, ${body.filename || null}, ${url}, ${Number(body.size) || null}, ${body.contentType || null}, ${Number(claims.uid) || null})`;
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "delete") {
      const id = Number(body.id);
      if (!id) { res.status(400).json({ ok: false, error: "Falta id" }); return; }
      const rows = await sql`SELECT url FROM price_lists WHERE id=${id}`;
      if (rows[0] && rows[0].url) { try { await del(rows[0].url); } catch (e) { /* ya borrado o sin token */ } }
      await sql`DELETE FROM price_lists WHERE id=${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, error: "Acción desconocida" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
