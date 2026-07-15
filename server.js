/* ── server.js — köfi API server ─────────────────────────────────────────────
   Pure API server. Exposes REST + WebSocket endpoints only.
   Does not serve any UI or static files — that is handled externally
   by serve.js (or any other hook that imports this module).

   Run directly:   node server.js          ← API only, no UI
   Run with UI:    node serve.js           ← API + public folder
   Run via tunnel: node tunnel.js          ← API + public folder + Cloudflare URL

   Port: process.env.PORT → config.PORT → 3000
──────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const http    = require('http');
const config  = require('./config');

const { initDB }                               = require('./src/db');
const { registerAuthRoutes }                   = require('./src/auth');
const { registerProfileRoutes }                = require('./src/profile');
const { loadFileRegistry, registerFileRoutes } = require('./src/files');
const { broadcastAll, clients, attachWS }      = require('./src/ws');

// ── Express app + HTTP server ──────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '4mb' }));
// Raw body parser for file save uploads (bypasses the JSON size limit)
app.use('/api/save', express.raw({ type: '*/*', limit: config.SAVE_SIZE_LIMIT_BYTES + 1024 }));

// ── API routes ─────────────────────────────────────────────────────────────
registerAuthRoutes(app);
registerProfileRoutes(app, broadcastAll, clients);
registerFileRoutes(app, broadcastAll);

// ── WebSocket ──────────────────────────────────────────────────────────────
attachWS(server);

// ── Start function — called by this file or by an external hook ───────────
const PORT = process.env.PORT || config.PORT || 3000;

async function start() {
  await initDB();
  loadFileRegistry();
  await new Promise((resolve, reject) =>
    server.listen(PORT, '0.0.0.0', (err) => err ? reject(err) : resolve())
  );
  console.log(`köfi api listening on port ${PORT}`);
}

// ── Exports — let other files hook into app/server before or after start ──
module.exports = { app, server, start, PORT };

// ── Boot when run directly ─────────────────────────────────────────────────
if (require.main === module) {
  start().catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}
