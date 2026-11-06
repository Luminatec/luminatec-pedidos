// POST /api/pricelist-ingest  { key, name, filename, contentType, dataBase64 }
// Sube una lista de precios SIN sesión de usuario, usando una clave de ingreso (INGEST_KEY).
// Pensado para automatizar la carga desde Claude (skill). Límite práctico ~3-4 MB por el
// tope de body de la función; archivos más grandes se suben desde el panel de la app.
import { put } from "@vercel/blob";
import { ensureSchema, sql } from "./_db.js";
import { readBody } from "./_lib.js";
import crypto from "crypto";

function safeEqual(a, b) {
  const A = Buffer.from(String(a || ""));
  const B = Buffer.from(String(b || ""));
  if (A.length !== B.length) return false;
  try { return crypto.timingSafeEqual(A, B); } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ ok: false, error: "Método no permitido" }); return; }
  try {
    const body = await readBody(req);
    if (!process.env.INGEST_KEY || !safeEqual(body.key, process.env.INGEST_KEY)) {
      res.status(403).json({ ok: false, error: "Clave de ingreso inválida" }); return;
    }
    const name = String(body.name || "").trim();
    const filename = String(body.filename || "lista").trim();
    const dataBase64 = body.dataBase64 || body.data || "";
    if (!name) { res.status(400).json({ ok: false, error: "Falta el nombre de la lista" }); return; }
    if (!dataBase64) { res.status(400).json({ ok: false, error: "Falta el archivo (dataBase64)" }); return; }
    const buf = Buffer.from(String(dataBase64), "base64");
    if (!buf.length) { res.status(400).json({ ok: false, error: "Archivo vacío o base64 inválido" }); return; }

    await ensureSchema();
    const blob = await put(filename, buf, {
      access: "public",
      addRandomSuffix: true,
      contentType: body.contentType || undefined,
    });
    await sql`INSERT INTO price_lists (name, filename, url, size, content_type, uploaded_by)
              VALUES (${name}, ${filename}, ${blob.url}, ${buf.length}, ${body.contentType || null}, ${null})`;
    res.status(200).json({ ok: true, url: blob.url, size: buf.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
}
