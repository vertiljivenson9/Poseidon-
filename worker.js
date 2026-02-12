// ============================================
// POSEIDON - Worker universal (API + Frontend)
// ============================================
import { httpServerHandler } from 'cloudflare:node';
import express from 'express';
import { Pool } from 'pg';

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// DRIVERS DE BASE DE DATOS (PostgreSQL)
// ------------------------------------------------------------
async function testConnection(connectionString) {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return { success: true, message: 'Conexión exitosa' };
  } catch (error) {
    return { success: false, message: error.message };
  } finally {
    await pool.end();
  }
}

async function executeSQL(connectionString, sql) {
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await pool.query('BEGIN');
    await pool.query(sql);
    await pool.query('COMMIT');
    return { success: true, message: 'Ejecución exitosa' };
  } catch (error) {
    await pool.query('ROLLBACK');
    return { success: false, message: error.message };
  } finally {
    await pool.end();
  }
}

// ------------------------------------------------------------
// RUTAS DE LA API
// ------------------------------------------------------------
app.post('/api/connect', async (req, res) => {
  const { connectionString } = req.body;
  if (!connectionString) {
    return res.status(400).json({ success: false, message: 'Falta connectionString' });
  }
  const result = await testConnection(connectionString);
  res.json(result);
});

app.post('/api/generate', async (req, res) => {
  const { connectionString, features } = req.body;
  if (!connectionString || !features) {
    return res.status(400).json({ success: false, message: 'Faltan datos' });
  }

  let sql = '';
  if (features.includes('login')) {
    sql += `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `;
  }
  if (features.includes('roles')) {
    sql += `
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
// SERVIDOR DE ARCHIVOS ESTÁTICOS (Frontend)
// El HTML completo se sirve en la raíz
// ------------------------------------------------------------
const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Poseidon · Generación real de bases de datos</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css">
</head>
<body class="bg-gray-950 text-gray-100 font-sans antialiased">
  <div id="splash" class="fixed inset-0 bg-gradient-to-br from-indigo-900 via-purple-900 to-gray-900 flex flex-col items-center justify-center z-50 transition-opacity duration-700">
    <div class="text-center">
      <div class="text-8xl mb-6 drop-shadow-2xl">🌊</div>
      <h1 class="text-5xl md:text-6xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-4">Poseidon</h1>
      <p class="text-xl text-gray-300 max-w-md mx-auto">Motor automatizado de bases de datos · Conexión real · SQL inmediato</p>
      <button id="enterBtn" class="mt-10 px-8 py-3 bg-white text-gray-900 rounded-full font-semibold hover:bg-gray-200 transition shadow-lg transform hover:scale-105">COMENZAR →</button>
    </div>
  </div>

  <main id="mainApp" class="container mx-auto px-4 py-8 max-w-4xl opacity-0 transition-opacity duration-500">
    <div class="text-center mb-10">
      <span class="text-6xl inline-block mb-2">🌊</span>
      <h2 class="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">Poseidon</h2>
      <p class="text-gray-400">Infraestructura instantánea para tus proyectos</p>
    </div>

    <!-- Paso 1: Conexión -->
    <div class="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700 shadow-xl mb-8">
      <h3 class="text-xl font-semibold mb-4 flex items-center gap-2"><span class="bg-blue-600 w-6 h-6 rounded-full flex items-center justify-center text-sm">1</span> Conectar base de datos</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Proveedor (PostgreSQL)</label>
          <select id="provider" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-200 focus:ring-2 focus:ring-blue-500">
            <option value="supabase">Supabase (Free Tier)</option>
            <option value="neon">Neon (Free Tier)</option>
            <option value="custom">Conexión personalizada</option>
          </select>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Connection string / API Key</label>
          <input type="text" id="connectionString" placeholder="postgresql://user:pass@host:5432/db" class="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-gray-200 font-mono text-sm focus:ring-2 focus:ring-blue-500">
        </div>
        <button id="testConnectionBtn" class="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition flex items-center gap-2">
          <i class="fas fa-plug"></i> Verificar conexión
        </button>
        <div id="connectionMessage" class="text-sm hidden"></div>
      </div>
    </div>

    <!-- Paso 2: Selección de funcionalidades -->
    <div id="featuresSection" class="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700 shadow-xl mb-8 hidden">
      <h3 class="text-xl font-semibold mb-4 flex items-center gap-2"><span class="bg-blue-600 w-6 h-6 rounded-full flex items-center justify-center text-sm">2</span> Módulos del proyecto</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label class="flex items-start p-4 bg-gray-900/80 rounded-lg border border-gray-700 cursor-pointer hover:border-blue-500 transition">
          <input type="checkbox" value="login" class="mt-1 mr-3 w-5 h-5 accent-blue-500">
          <div>
            <span class="font-medium text-white">Login</span>
            <p class="text-xs text-gray-400">Tabla users, autenticación básica</p>
          </div>
        </label>
        <label class="flex items-start p-4 bg-gray-900/80 rounded-lg border border-gray-700 cursor-pointer hover:border-blue-500 transition feature-premium relative">
          <input type="checkbox" value="roles" class="mt-1 mr-3 w-5 h-5 accent-blue-500">
          <div>
            <span class="font-medium text-white">Roles <span class="ml-2 text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full">💎 Premium</span></span>
            <p class="text-xs text-gray-400">RBAC, tabla roles y asignación</p>
          </div>
        </label>
      </div>
      <button id="generateBtn" class="mt-6 w-full px-6 py-4 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 rounded-lg font-bold text-lg transition shadow-lg flex items-center justify-center gap-2">
        <i class="fas fa-bolt"></i> GENERAR Y EJECUTAR EN BASE DE DATOS REAL
      </button>
    </div>

    <!-- Paso 3: Resultados y descarga -->
    <div id="resultSection" class="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-700 shadow-xl hidden">
      <h3 class="text-xl font-semibold mb-4 flex items-center gap-2 text-green-400"><i class="fas fa-check-circle"></i> Base de datos actualizada</h3>
      <div class="bg-gray-950 rounded-lg p-4 font-mono text-sm text-gray-300 overflow-x-auto" id="sqlPreview"></div>
      <div class="mt-6 flex flex-wrap gap-4">
        <a id="downloadEnv" class="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition flex items-center gap-2 cursor-pointer">
          <i class="fas fa-file-alt"></i> Descargar .env
        </a>
        <button id="resetBtn" class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg font-medium transition flex items-center gap-2">
          <i class="fas fa-redo"></i> Nuevo proyecto
        </button>
      </div>
    </div>
  </main>

  <script>
    // ---------- ESTADO DE LA APLICACIÓN ----------
    let connectionVerified = false;
    let lastConnectionString = '';
    let lastGeneratedEnv = '';
    let lastGeneratedSQL = '';

    const splash = document.getElementById('splash');
    const mainApp = document.getElementById('mainApp');
    const enterBtn = document.getElementById('enterBtn');
    const testBtn = document.getElementById('testConnectionBtn');
    const connMsg = document.getElementById('connectionMessage');
    const featuresSection = document.getElementById('featuresSection');
    const generateBtn = document.getElementById('generateBtn');
    const resultSection = document.getElementById('resultSection');
    const sqlPreview = document.getElementById('sqlPreview');
    const downloadEnv = document.getElementById('downloadEnv');
    const resetBtn = document.getElementById('resetBtn');
    const connectionStringInput = document.getElementById('connectionString');
    const providerSelect = document.getElementById('provider');

    // ---------- SPLASH SCREEN ----------
    enterBtn.addEventListener('click', () => {
      splash.classList.add('hidden-splash');
      setTimeout(() => {
        splash.style.display = 'none';
        mainApp.classList.remove('opacity-0');
      }, 600);
    });

    // ---------- VERIFICAR CONEXIÓN (REAL) ----------
    testBtn.addEventListener('click', async () => {
      const connectionString = connectionStringInput.value.trim();
      if (!connectionString) {
        showMessage(connMsg, 'Ingresa una cadena de conexión', 'error');
        return;
      }

      showMessage(connMsg, 'Verificando conexión...', 'info', true);
      try {
        const response = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionString })
        });
        const data = await response.json();
        if (data.success) {
          showMessage(connMsg, '✅ Conexión exitosa. Listo para generar.', 'success');
          connectionVerified = true;
          lastConnectionString = connectionString;
          featuresSection.classList.remove('hidden');
        } else {
          showMessage(connMsg, \`❌ Error: \${data.message}\`, 'error');
          connectionVerified = false;
          featuresSection.classList.add('hidden');
        }
      } catch (err) {
        showMessage(connMsg, \`❌ Error de red: \${err.message}\`, 'error');
        connectionVerified = false;
        featuresSection.classList.add('hidden');
      }
    });

    // ---------- GENERAR Y EJECUTAR (REAL) ----------
    generateBtn.addEventListener('click', async () => {
      if (!connectionVerified) {
        alert('Primero verifica la conexión');
        return;
      }

      const checkboxes = document.querySelectorAll('#featuresSection input[type="checkbox"]:checked');
      const features = Array.from(checkboxes).map(cb => cb.value);
      if (features.length === 0) {
        alert('Selecciona al menos una funcionalidad');
        return;
      }

      generateBtn.disabled = true;
      generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Ejecutando SQL en tu base de datos...';

      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connectionString: lastConnectionString,
            features
          })
        });
        const data = await response.json();
        if (data.success) {
          lastGeneratedEnv = data.env;
          lastGeneratedSQL = data.sql;
          sqlPreview.textContent = data.sql || '-- No se generó SQL (módulo vacío)';
          resultSection.classList.remove('hidden');
          featuresSection.classList.add('hidden');
        } else {
          alert('Error en ejecución: ' + data.message);
        }
      } catch (err) {
        alert('Error de comunicación: ' + err.message);
      } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i class="fas fa-bolt"></i> GENERAR Y EJECUTAR EN BASE DE DATOS REAL';
      }
    });

    // ---------- DESCARGA .env ----------
    downloadEnv.addEventListener('click', () => {
      if (!lastGeneratedEnv) return;
      const blob = new Blob([lastGeneratedEnv], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '.env';
      a.click();
      URL.revokeObjectURL(url);
    });

    // ---------- RESET ----------
    resetBtn.addEventListener('click', () => {
      connectionVerified = false;
      lastConnectionString = '';
      lastGeneratedEnv = '';
      lastGeneratedSQL = '';
      connectionStringInput.value = '';
      document.querySelectorAll('#featuresSection input[type="checkbox"]').forEach(cb => cb.checked = false);
      featuresSection.classList.add('hidden');
      resultSection.classList.add('hidden');
      connMsg.classList.add('hidden');
      showMessage(connMsg, '', 'hide');
    });

    // ---------- UTILIDADES ----------
    function showMessage(el, text, type, loading = false) {
      el.classList.remove('hidden', 'bg-green-500/20', 'bg-red-500/20', 'bg-blue-500/20', 'text-green-300', 'text-red-300', 'text-blue-300');
      el.textContent = text;
      if (type === 'success') {
        el.classList.add('bg-green-500/20', 'text-green-300', 'p-3', 'rounded-lg');
      } else if (type === 'error') {
        el.classList.add('bg-red-500/20', 'text-red-300', 'p-3', 'rounded-lg');
      } else if (type === 'info') {
        el.classList.add('bg-blue-500/20', 'text-blue-300', 'p-3', 'rounded-lg');
      }
      if (loading) {
        el.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>' + text;
      }
    }

    // Sugerencia automática para Supabase
    providerSelect.addEventListener('change', () => {
      if (providerSelect.value === 'supabase') {
        connectionStringInput.value = 'postgresql://postgres:[PASSWORD]@db.[REF].supabase.co:5432/postgres';
      } else if (providerSelect.value === 'neon') {
        connectionStringInput.value = 'postgresql://[USER]:[PASSWORD]@[HOST].neon.tech/[DB]?sslmode=require';
      }
    });
  </script>

  <style>
    .hidden-splash {
      opacity: 0;
    }
    .feature-premium {
      position: relative;
    }
    .feature-premium::after {
      content: "💎";
      position: absolute;
      top: 0.5rem;
      right: 0.75rem;
      font-size: 1.25rem;
      opacity: 0.5;
    }
  </style>
</body>
</html>`;

app.get('/', (req, res) => {
  res.send(html);
});

// ------------------------------------------------------------
// PUNTO DE ENTRADA PARA CLOUDFLARE WORKERS
// ------------------------------------------------------------
export default httpServerHandler(app);
