const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ── Setup ──────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json({ limit: '4mb' })); // avatar images can be ~1-2 MB as base64
app.use(express.static(path.join(__dirname, 'public')));

// ── Database ───────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, 'chat.db');
let db;

async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }

  // Core tables — always safe to run
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_names (
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, name),
      UNIQUE (name)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      user_name  TEXT NOT NULL,
      type       TEXT NOT NULL,
      content    TEXT NOT NULL,
      file_meta  TEXT,
      created_at INTEGER NOT NULL
    );
  `);

  // ── Schema migrations (safe to re-run) ──────────────────────────────────
  // Add avatar column to users if it doesn't exist yet
  const userCols = dbAll(`PRAGMA table_info(users)`).map(c => c.name);
  if (!userCols.includes('avatar')) {
    db.run('ALTER TABLE users ADD COLUMN avatar TEXT');
    console.log('  Migration: added users.avatar column');
  }

  // Remove old UNIQUE constraint on users.name if it existed (no longer needed —
  // uniqueness is now enforced by user_names). SQLite can't drop constraints, but
  // the INSERT OR IGNORE on user_names handles the enforcement going forward.

  // Populate user_names from existing users rows (idempotent)
  const existing = dbAll('SELECT id, name, created_at FROM users');
  for (const u of existing) {
    const has = dbGet('SELECT 1 FROM user_names WHERE user_id = ? AND name = ?', [u.id, u.name]);
    if (!has) db.run('INSERT OR IGNORE INTO user_names (user_id, name, claimed_at) VALUES (?, ?, ?)', [u.id, u.name, u.created_at]);
  }

  let dirty = false;
  const origRun = db.run.bind(db);
  db.run = (...args) => { dirty = true; return origRun(...args); };

  setInterval(() => {
    if (dirty) { dirty = false; fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
  }, 5000);

  process.on('exit', () => fs.writeFileSync(DB_PATH, Buffer.from(db.export())));
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function dbGet(sql, params = []) { return dbAll(sql, params)[0] || null; }

// ── File registry ──────────────────────────────────────────────────────────
const fileRegistry = new Map();

function loadFileRegistry() {
  const rows = dbAll(`SELECT file_meta, user_id FROM messages WHERE type = 'file' AND file_meta IS NOT NULL`);
  for (const row of rows) {
    try {
      const meta = JSON.parse(row.file_meta);
      if (meta.fileId) fileRegistry.set(meta.fileId, { userId: row.user_id, name: meta.name, size: meta.size, mimeType: meta.mimeType });
    } catch {}
  }
  console.log(`  Loaded ${fileRegistry.size} file(s) into registry from history`);
}

// ── Helpers for full profile object ───────────────────────────────────────
function getProfile(userId) {
  const user = dbGet('SELECT id, name, avatar FROM users WHERE id = ?', [userId]);
  if (!user) return null;
  const names = dbAll('SELECT name, claimed_at FROM user_names WHERE user_id = ? ORDER BY claimed_at ASC', [userId]);
  return { id: user.id, name: user.name, avatar: user.avatar || null, aliases: names.map(n => n.name) };
}

// ── Connected clients ──────────────────────────────────────────────────────
const clients = new Map(); // ws → { socketId, userId, userName }

function broadcast(data, excludeWs = null) {
  const msg = JSON.stringify(data);
  for (const [ws] of clients) {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
function broadcastAll(data) { broadcast(data, null); }

function onlineUsers() {
  const seen = new Set();
  const result = [];
  for (const c of clients.values()) {
    if (c.userId && !seen.has(c.userId)) {
      seen.add(c.userId);
      const profile = getProfile(c.userId);
      result.push({ id: c.userId, name: c.userName, avatar: profile ? profile.avatar : null });
    }
  }
  return result;
}

function wsForUser(userId) {
  for (const [ws, client] of clients) {
    if (client.userId === userId && ws.readyState === WebSocket.OPEN) return ws;
  }
  return null;
}

function socketIdForUser(userId) {
  for (const [, client] of clients) {
    if (client.userId === userId) return client.socketId;
  }
  return null;
}

// ── REST API ───────────────────────────────────────────────────────────────

// Auth: login or register by name
// Name lookup checks ALL claimed names (past + present), so each name is unique forever
app.post('/api/auth', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name required' });
  const trimmed = name.trim().slice(0, 32);
  if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' });
  if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
    return res.status(400).json({ error: 'Name can only contain letters, numbers, spaces, hyphens, and underscores' });
  }

  // Find who owns this name (if anyone)
  const nameRow = dbGet('SELECT user_id FROM user_names WHERE name = ?', [trimmed]);

  if (nameRow) {
    // Name is claimed — log in as that user, switch active name to this one
    const userId = nameRow.user_id;
    db.run('UPDATE users SET name = ? WHERE id = ?', [trimmed, userId]);
    const profile = getProfile(userId);
    return res.json(profile);
  }

  // Brand new name — create a fresh user
  const id = uuidv4();
  const now = Date.now();
  db.run('INSERT INTO users (id, name, avatar, created_at) VALUES (?, ?, NULL, ?)', [id, trimmed, now]);
  db.run('INSERT INTO user_names (user_id, name, claimed_at) VALUES (?, ?, ?)', [id, trimmed, now]);
  return res.json(getProfile(id));
});

// Get profile of any user
app.get('/api/profile/:userId', (req, res) => {
  const profile = getProfile(req.params.userId);
  if (!profile) return res.status(404).json({ error: 'User not found' });
  res.json(profile);
});

// Update own profile (name switch/claim + avatar)
app.post('/api/profile', (req, res) => {
  const { userId, name, avatar } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const user = dbGet('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  let newName = user.name;

  if (name && name !== user.name) {
    const trimmed = name.trim().slice(0, 32);
    if (!trimmed) return res.status(400).json({ error: 'Name cannot be empty' });
    if (!/^[a-zA-Z0-9_\- ]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'Name can only contain letters, numbers, spaces, hyphens, and underscores' });
    }

    // Check if the name is free or already owned by this user
    const existing = dbGet('SELECT user_id FROM user_names WHERE name = ?', [trimmed]);
    if (existing && existing.user_id !== userId) {
      return res.status(409).json({ error: 'That name is already taken by someone else' });
    }

    // Claim if new
    if (!existing) {
      db.run('INSERT INTO user_names (user_id, name, claimed_at) VALUES (?, ?, ?)', [userId, trimmed, Date.now()]);
    }

    db.run('UPDATE users SET name = ? WHERE id = ?', [trimmed, userId]);
    newName = trimmed;

    // Update active client session name
    for (const [, client] of clients) {
      if (client.userId === userId) client.userName = trimmed;
    }
  }

  if (avatar !== undefined) {
    // avatar is a base64 data URL or null to clear
    db.run('UPDATE users SET avatar = ? WHERE id = ?', [avatar || null, userId]);
  }

  const profile = getProfile(userId);

  // Broadcast profile change to everyone
  broadcastAll({ type: 'profile_update', profile });

  res.json(profile);
});

// Message history
app.get('/api/messages', (req, res) => {
  const rows = dbAll('SELECT * FROM messages ORDER BY created_at DESC LIMIT 100').reverse();
  res.json(rows.map(r => {
    const parsed = r.file_meta ? JSON.parse(r.file_meta) : null;
    let uploaderSocketId = null;
    if (parsed && parsed.fileId) {
      const reg = fileRegistry.get(parsed.fileId);
      if (reg) uploaderSocketId = socketIdForUser(reg.userId) || null;
    }
    return { ...r, file_meta: parsed, uploaderSocketId };
  }));
});

// ── WebSocket handler ──────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const socketId = uuidv4();
  clients.set(ws, { socketId, userId: null, userName: null });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const client = clients.get(ws);

    switch (msg.type) {

      case 'join': {
        const user = dbGet('SELECT * FROM users WHERE id = ?', [msg.userId]);
        if (!user) { ws.send(JSON.stringify({ type: 'error', message: 'Unknown user' })); return; }
        client.userId = user.id;
        client.userName = user.name;
        ws.send(JSON.stringify({ type: 'welcome', socketId, users: onlineUsers() }));
        broadcast({ type: 'user_joined', user: { id: user.id, name: user.name }, users: onlineUsers() }, ws);
        const myFileIds = [];
        for (const [fid, meta] of fileRegistry) {
          if (meta.userId === user.id) myFileIds.push(fid);
        }
        if (myFileIds.length) ws.send(JSON.stringify({ type: 'rehost_files', fileIds: myFileIds }));
        broadcastAll({ type: 'uploader_online', userId: user.id, socketId });
        break;
      }

      case 'message': {
        if (!client.userId) return;
        const text = (msg.content || '').toString().trim().slice(0, 4000);
        if (!text) return;
        const id = uuidv4();
        const now = Date.now();
        db.run('INSERT INTO messages (id, user_id, user_name, type, content, file_meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [id, client.userId, client.userName, 'text', text, null, now]);
        broadcastAll({ type: 'message', id, userId: client.userId, userName: client.userName,
          msgType: 'text', content: text, fileMeta: null, createdAt: now });
        break;
      }

      case 'file_announce': {
        if (!client.userId) return;
        const { fileId, name, size, mimeType } = msg;
        if (!fileId || !name) return;
        fileRegistry.set(fileId, { userId: client.userId, name, size, mimeType });
        if (!msg.reannounce) {
          const id = uuidv4();
          const now = Date.now();
          db.run('INSERT INTO messages (id, user_id, user_name, type, content, file_meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, client.userId, client.userName, 'file', name, JSON.stringify({ fileId, name, size, mimeType }), now]);
          broadcastAll({ type: 'message', id, userId: client.userId, userName: client.userName,
            msgType: 'file', content: name, fileMeta: { fileId, name, size, mimeType },
            createdAt: now, uploaderSocketId: socketId });
        } else {
          broadcastAll({ type: 'file_available', fileId, uploaderSocketId: socketId });
        }
        break;
      }

      case 'file_request': {
        if (!client.userId) return;
        const { fileId, requestId, resumeFrom = 0 } = msg;
        const reg = fileRegistry.get(fileId);
        if (!reg) { ws.send(JSON.stringify({ type: 'file_unavailable', fileId, requestId })); return; }
        const uploaderWs = wsForUser(reg.userId);
        if (!uploaderWs) { ws.send(JSON.stringify({ type: 'file_unavailable', fileId, requestId })); return; }
        uploaderWs.send(JSON.stringify({ type: 'file_request', fileId, requestId, resumeFrom, requesterSocketId: socketId }));
        break;
      }

      case 'file_chunk': {
        const { requestId, requesterSocketId, chunk, done, error } = msg;
        let requesterWs = null;
        for (const [oWs, oClient] of clients) {
          if (oClient.socketId === requesterSocketId) { requesterWs = oWs; break; }
        }
        if (requesterWs && requesterWs.readyState === WebSocket.OPEN) {
          requesterWs.send(JSON.stringify({ type: 'file_chunk', requestId, chunk, done, error }));
        }
        break;
      }

      case 'typing': {
        if (!client.userId) return;
        broadcast({ type: 'typing', userId: client.userId, userName: client.userName, isTyping: !!msg.isTyping }, ws);
        break;
      }
    }
  });

  ws.on('close', () => {
    const client = clients.get(ws);
    clients.delete(ws);
    if (client && client.userId) {
      broadcast({ type: 'user_left', userId: client.userId, userName: client.userName, users: onlineUsers() });
    }
  });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  loadFileRegistry();
  server.listen(PORT, '0.0.0.0', () => {
    const interfaces = os.networkInterfaces();
    console.log('\n köfi is running!\n');
    console.log(`   Local:   http://localhost:${PORT}`);
    for (const [, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          console.log(`   Network: http://${addr.address}:${PORT}  ← share this with others on your network`);
        }
      }
    }
    console.log('');
  });
}).catch(err => { console.error('Failed to init DB:', err); process.exit(1); });
