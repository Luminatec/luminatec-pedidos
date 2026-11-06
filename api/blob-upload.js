// POST /api/blob-upload
// Genera el token para subir un archivo directamente a Vercel Blob (client upload).
// Solo administradores. El front usa @vercel/blob/client -> upload().
import { handleUpload } from "@vercel/blob/client";
import { verifyToken, readBody } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Método no permitido" }); return; }
  try {
    const body = await readBody(req);
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let token = null;
        try { token = JSON.parse(clientPayload || "{}").token; } catch {}
        const claims = verifyToken(token, process.env.APP_SECRET);
        if (!claims || claims.role !== "admin") throw new Error("No autorizado");
        return {
          allowedContentTypes: [
            "application/pdf",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/csv",
            "image/png",
            "image/jpeg",
            "application/octet-stream",
          ],
          maximumSizeInBytes: 30 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });
    res.status(200).json(jsonResponse);
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
}
