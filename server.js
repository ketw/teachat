/* ── server.js — köfi API server ─────────────────────────────────────────────
   Pure production server. Exposes REST + WebSocket endpoints.
   Does not serve any UI — a hosting platform (Render, Railway, Fly, etc.)
   or a separate frontend handles that.

   Start:  node server.js
   Port:   process.env.PORT  (required on most hosting platforms)
           falls back to config.PORT, then 3000 for local dev.
──────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const http    = require('http');
const path    = require('path');
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

// ── Static files (UI) ──────────────────────────────────────────────────────
// Served here so the server is self-contained when needed (e.g. tunnel mode).
// On a dedicated hosting platform you can offload this to a CDN/edge layer,
// but keeping it here costs nothing and keeps deployment simple.
app.use(express.static(path.join(__dirname, 'public')));

// ── API routes ─────────────────────────────────────────────────────────────
registerAuthRoutes(app);
registerProfileRoutes(app, broadcastAll, clients);
registerFileRoutes(app, broadcastAll);

// ── WebSocket ──────────────────────────────────────────────────────────────
attachWS(server);

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || config.PORT || 3000;

initDB()
  .then(() => {
    loadFileRegistry();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`köfi listening on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to init DB:', err);
    process.exit(1);
  });
