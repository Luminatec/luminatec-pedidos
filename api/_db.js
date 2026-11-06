// Conexión a la base de datos (Neon Postgres) + esquema + helpers de usuarios.
import { neon } from "@neondatabase/serverless";

const connStr =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.POSTGRES_PRISMA_URL;

if (!connStr) {
  // No tiramos error al importar para no romper otras funciones; se reporta al usar.
  console.warn("[_db] No se encontró la cadena de conexión (DATABASE_URL).");
}

export const sql = neon(connStr);

let _ready = null;
export async function ensureSchema() {
  if (!connStr) throw new Error("Base de datos no configurada (falta DATABASE_URL).");
  if (_ready) return _ready;
  _ready = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'vendor',
      pass_hash TEXT,
      must_change BOOLEAN NOT NULL DEFAULT true,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    // Permiso "ve todos los clientes" sin ser admin (p. ej. asistentes de ventas)
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS allclients BOOLEAN NOT NULL DEFAULT false`;
    await sql`CREATE TABLE IF NOT EXISTS reset_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    // Listas de precios (archivos en Vercel Blob; acá guardamos los metadatos)
    await sql`CREATE TABLE IF NOT EXISTS price_lists (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT,
      url TEXT NOT NULL,
      size BIGINT,
      content_type TEXT,
      uploaded_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  })();
  return _ready;
}

export async function getUserById(id) {
  const rows = await sql`SELECT * FROM users WHERE id = ${Number(id)} LIMIT 1`;
  return rows[0] || null;
}

export async function getUserByEmail(email) {
  if (!email) return null;
  const rows = await sql`SELECT * FROM users WHERE lower(email) = lower(${String(email)}) LIMIT 1`;
  return rows[0] || null;
}
