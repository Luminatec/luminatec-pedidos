// Utilidades compartidas: auth por token HMAC + cliente Odoo JSON-RPC
import crypto from "crypto";

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ----- Token simple firmado (HMAC), sin dependencias externas -----
export function signToken(payload, secret, ttlSeconds = 60 * 60 * 12) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [data, sig] = token.split(".");
  const expected = b64url(crypto.createHmac("sha256", secret).update(data).digest());
  // comparación en tiempo constante
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let body;
  try { body = JSON.parse(Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()); }
  catch { return null; }
  if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}

// ----- Cliente Odoo JSON-RPC (external API con API key) -----
async function odooCall(service, method, args) {
  const url = `${process.env.ODOO_URL.replace(/\/$/, "")}/jsonrpc`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args } }),
  });
  const j = await res.json();
  if (j.error) {
    const msg = j.error?.data?.message || j.error?.message || "Error Odoo";
    throw new Error(msg);
  }
  return j.result;
}

let _uidCache = null;
export async function odooUid() {
  if (_uidCache) return _uidCache;
  const { ODOO_DB, ODOO_USER, ODOO_API_KEY } = process.env;
  const uid = await odooCall("common", "login", [ODOO_DB, ODOO_USER, ODOO_API_KEY]);
  if (!uid) throw new Error("No se pudo autenticar en Odoo (revisá ODOO_USER / ODOO_API_KEY / ODOO_DB).");
  _uidCache = uid;
  return uid;
}

export async function odooExec(model, method, args = [], kwargs = {}) {
  const { ODOO_DB, ODOO_API_KEY } = process.env;
  const uid = await odooUid();
  return odooCall("object", "execute_kw", [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs]);
}

export function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      if (typeof req.body === "string") { try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); } }
      return resolve(req.body);
    }
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
  });
}
