/* ── serve.js — UI hook for köfi ─────────────────────────────────────────────
   Hooks into the API server and mounts the public folder on top of it.
   This is the entry point for actually using köfi as a webapp.

   Run:  node serve.js

   What it does:
     1. Imports the API server (server.js) — gets the express app instance
     2. Mounts express.static on the public/ folder before starting
     3. Calls start() — same server, same port, same API + WebSocket
        but now also serves the webapp at /

   The server itself has zero knowledge of this file.
   Swap public/ for anything else, or mount a different UI entirely,
   without touching a single line of server.js or src/.
──────────────────────────────────────────────────────────────────────────── */

const express = require('express');
const path    = require('path');
const { app, start, PORT } = require('./server');

// ── Mount the webapp ───────────────────────────────────────────────────────
// Registered before start() so it's in place when the server begins listening.
// Any request that doesn't match an /api/* route falls through to these files.
app.use(express.static(path.join(__dirname, 'public')));

// ── Boot ───────────────────────────────────────────────────────────────────
start()
  .then(() => {
    console.log(`köfi running on http://localhost:${PORT}`);
  })
  .catch(err => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
