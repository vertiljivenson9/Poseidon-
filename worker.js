// ============================================
// POSEIDON - Worker universal (API + Frontend)
// Versión corregida para Cloudflare Workers
// ============================================
import { httpServerHandler } from 'cloudflare:node';
import express from 'express';
import { neon } from '@neondatabase/serverless';

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// CONFIGURACIÓN DE SEGURIDAD
// ------------------------------------------------------------
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || 'supabase.co,neon.tech')
  .split(',')
  .map(h => h.trim().toLowerCase());

// Extraer host de una connection string PostgreSQL
function extractHostFromConnectionString(connectionString) {
  try {
    // Formato esperado: postgresql://user:pass@host:port/db
    const match = connectionString.match(/@([^:/]+)/);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

// Validar si el host está permitido
function isHostAllowed(host) {
  if (!host) return false;
  return ALLOWED_HOSTS.some(allowed => host.endsWith(allowed));
}

// ------------------------------------------------------------
// RATE LIMITING (en memoria, por IP)
// ------------------------------------------------------------
const rateLimit = new Map(); // IP -> { count, resetTime }

function checkRateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minuto
  const maxRequests = 10;

  const record = rateLimit.get(ip);
  if (!record || now > record.resetTime) {
    rateLimit.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (record.count >= maxRequests) {
    return false;
  }

  record.count += 1;
  return true;
}

// Middleware de rate limiting
function rateLimitMiddleware(req, res, next) {
  const ip = req.headers['cf-connecting-ip'] || req.ip || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ success: false, message: 'Demasiadas solicitudes. Intenta más tarde.' });
  }
  next();
}

// ------------------------------------------------------------
// FUNCIONES DE BASE DE DATOS (con @neondatabase/serverless)
// ------------------------------------------------------------
async function testConnection(connectionString) {
  const sql = neon(connectionString);
  try {
    await sql`SELECT 1`;
    return { success: true, message: 'Conexión exitosa' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function executeSQL(connectionString, sqlString) {
  const sql = neon(connectionString);
  try {
    // Ejecutar el SQL directamente (múltiples sentencias separadas por ;)
    await sql.unsafe(sqlString);
    return { success: true, message: 'Ejecución exitosa' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// ------------------------------------------------------------
// GENERACIÓN DE SQL (modular)
// ------------------------------------------------------------
function generateLoginSQL() {
  return `
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `;
}

function generateRolesSQL() {
  return `
    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(50) UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );
    INSERT INTO roles (name) VALUES ('admin'), ('user') ON CONFLICT DO NOTHING;
  `;
}

function generateSQL(features) {
  let sql = '';
  if (features.includes('login')) sql += generateLoginSQL();
  if (features.includes('roles')) sql += generateRolesSQL();
  return sql;
}

// ------------------------------------------------------------
// RUTAS DE LA API (con validaciones)
// ------------------------------------------------------------
app.post('/api/connect', rateLimitMiddleware, async (req, res) => {
  const { connectionString } = req.body;
  if (!connectionString) {
    return res.status(400).json({ success: false, message: 'Falta connectionString' });
  }

  const host = extractHostFromConnectionString(connectionString);
  if (!host || !isHostAllowed(host)) {
    return res.status(403).json({ success: false, message: 'Host no permitido. Usa un proveedor autorizado (Supabase, Neon, etc.).' });
  }

  const result = await testConnection(connectionString);
  res.json(result);
});

app.post('/api/generate', rateLimitMiddleware, async (req, res) => {
  const { connectionString, features } = req.body;
  if (!connectionString || !features || !Array.isArray(features)) {
    return res.status(400).json({ success: false, message: 'Faltan datos o formato incorrecto' });
  }

  const host = extractHostFromConnectionString(connectionString);
  if (!host || !isHostAllowed(host)) {
    return res.status(403).json({ success: false, message: 'Host no permitido.' });
  }

  const sql = generateSQL(features);
  if (!sql.trim()) {
    return res.status(400).json({ success: false, message: 'No se generó SQL (selecciona al menos una funcionalidad)' });
  }

  const execution = await executeSQL(connectionString, sql);
  if (!execution.success) {
    return res.status(500).json({ success: false, message: execution.message });
  }

  const envContent = `DATABASE_URL="${connectionString}"
ENABLE_LOGIN=${features.includes('login')}
ENABLE_ROLES=${features.includes('roles')}
`;

  res.json({
    success: true,
    message: 'Base de datos actualizada',
    env: envContent,
    sql
  });
});

// ------------------------------------------------------------
// FRONTEND (HTML incrustado, igual que el original pero con pequeños ajustes)
// ------------------------------------------------------------
const html = `<!DOCTYPE html>
... (mismo HTML que proporcionaste, sin cambios) ...
`;

app.get('/', (req, res) => {
  res.send(html);
});

// ------------------------------------------------------------
// EXPORTAR PARA CLOUDFLARE WORKERS
// ------------------------------------------------------------
export default httpServerHandler(app);