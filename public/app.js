/* ══════════════════════════════════════════════════════════════
   köfi — client
   ══════════════════════════════════════════════════════════════ */

// ── Helpers ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024*1024)).toFixed(1) + ' MB';
  return (bytes / (1024*1024*1024)).toFixed(2) + ' GB';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fileIcon(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime.includes('pdf')) return '📕';
  if (mime.includes('zip') || mime.includes('compressed')) return '🗜️';
  if (mime.includes('word') || mime.includes('document')) return '📝';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '📊';
  return '📄';
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

// ── State ─────────────────────────────────────────────────────────────────
let me = null;          // { id, name, avatar, aliases[] }
let ws = null;
let mySocketId = null;

// Profile cache: userId → { id, name, avatar, aliases[] }
const profileCache = new Map();

// Files this client hosts in-browser: fileId → File object
const hostedFiles = new Map();

// Active downloads: requestId → DownloadState
// DownloadState = { fileId, resolve, reject, chunks[], received, fileSize, mime, name,
//                   onProgress, onStatusChange, stallTimer, done }
const pendingDownloads = new Map();

// Per-file partial progress (survives a cancelled/stalled transfer so we can resume)
// fileId → { chunks[], received }
const partialDownloads = new Map();

// fileId → uploaderSocketId (updated when uploader comes online)
const fileUploaderMap = new Map();

// fileId → uploaderUserId (populated from messages, used for reconnect logic)
const fileOwnerMap = new Map();

// fileId → Set of callbacks to call when that uploader comes online
const waitingForUploader = new Map();

let queuedFiles = [];
let typingTimer = null;
let isTyping = false;
let lastGroup = null; // { userId, el } for message grouping


// ── Auth ──────────────────────────────────────────────────────────────────
// body { visibility:hidden } in CSS. reveal() is called the instant we know
// which screen to mount — zero flash, nothing pre-rendered in HTML.
(async () => {
  try {
    const res = await fetch('/api/session');
    if (res.ok) {
      buildChatScreen();
      reveal();
      enterChat(await res.json());
      return;
    }
  } catch {}
  buildLoginScreen();
  reveal();
})();

function reveal() { document.body.classList.add('ready'); }

// ── Build login screen ────────────────────────────────────────────────────
function buildLoginScreen() {
  const root = $('root');
  root.innerHTML = '';
  const screen = mk('div', { id:'login-screen' });
  const box    = mk('div', { className:'login-box' });
  const nameIn = mk('input',  { id:'name-input', type:'text', placeholder:'your name', maxLength:32, autocomplete:'off' });
  nameIn.spellcheck = false;
  const passIn = mk('input',  { id:'password-input', type:'password', placeholder:'password', maxLength:128, autocomplete:'current-password' });
  const btn    = mk('button', { id:'join-btn', textContent:'join' });
  const err    = mk('span',   { id:'login-error', className:'error' });
  box.append(nameIn, passIn, btn, err);
  screen.appendChild(box);
  root.appendChild(screen);
  btn.addEventListener('click', doLogin);
  nameIn.addEventListener('keydown', e => { if (e.key === 'Enter') passIn.focus(); });
  passIn.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  nameIn.focus();
}

// ── Build chat screen skeleton ────────────────────────────────────────────
function buildChatScreen() {
  const root = $('root');
  root.innerHTML = '';
  const screen = mk('div', { id:'chat-screen' });

  const profBtn = mk('button', { id:'my-profile-btn', title:'Your profile' });
  profBtn.setAttribute('aria-label', 'Open profile');

  const panel = mk('div', { id:'profile-panel', className:'hidden' });
  panel.setAttribute('role', 'dialog');
  panel.innerHTML = [
    '<div class="pp-header">',
      '<span class="pp-title">profile</span>',
      '<button class="pp-close" id="pp-close-btn" aria-label="Close">✕</button>',
    '</div>',
    '<div class="pp-avatar-section">',
      '<div class="pp-avatar-wrap">',
        '<div id="pp-avatar-preview" class="pp-avatar-preview"></div>',
        '<label class="pp-avatar-change" title="Upload photo">',
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square">',
            '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>',
            '<polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
          '</svg>',
          '<input id="pp-avatar-input" type="file" accept="image/*" hidden />',
        '</label>',
      '</div>',
      '<button id="pp-avatar-remove" class="pp-avatar-remove hidden">remove photo</button>',
      '<div id="pp-uid" class="pp-uid"></div>',
    '</div>',
    '<div class="pp-field-group">',
      '<label class="pp-label">display name</label>',
      '<div class="pp-name-row">',
        '<input id="pp-name-input" type="text" class="pp-input" maxlength="32" spellcheck="false" placeholder="name" />',
        '<button id="pp-name-save" class="pp-btn-primary">save</button>',
      '</div>',
      '<span id="pp-name-error" class="pp-error"></span>',
    '</div>',
    '<div class="pp-field-group" id="pp-aliases-group">',
      '<label class="pp-label">your names <span class="pp-label-sub">— permanently claimed</span></label>',
      '<div id="pp-aliases-list" class="pp-aliases-list"></div>',
    '</div>',
    '<div class="pp-field-group">',
      '<label class="pp-label">change password</label>',
      '<input id="pp-cur-pass" type="password" class="pp-input" placeholder="current password" autocomplete="current-password" />',
      '<input id="pp-new-pass" type="password" class="pp-input" placeholder="new password" autocomplete="new-password" />',
      '<button id="pp-pass-save" class="pp-btn-primary" style="align-self:flex-start">update</button>',
      '<span id="pp-pass-error" class="pp-error"></span>',
    '</div>',
  ].join('');

  const backdrop = mk('div', { id:'profile-backdrop', className:'hidden' });
  const messages = mk('div', { id:'messages' });

  const cWrap = mk('div', { id:'composer-wrap' });
  cWrap.innerHTML = [
    '<div id="typing-bar"></div>',
    '<div id="user-blobs"></div>',
    '<div id="composer">',
      '<label id="attach-btn" title="Attach file">',
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">',
          '<path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>',
        '</svg>',
        '<input id="file-input" type="file" multiple hidden />',
      '</label>',
      '<div id="file-previews"></div>',
      '<textarea id="msg-input" placeholder="message" rows="1"></textarea>',
      '<button id="send-btn" title="Send (Enter)">',
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">',
          '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>',
        '</svg>',
      '</button>',
    '</div>',
  ].join('');

  screen.append(profBtn, panel, backdrop, messages, cWrap);
  root.appendChild(screen);
}

function mk(tag, props) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) e[k] = v;
  return e;
}

async function doLogin() {
  const name     = $('name-input').value.trim();
  const password = $('password-input').value;
  if (!name)     return;
  if (!password) { $('login-error').textContent = 'Password required'; return; }
  $('login-error').textContent = '';
  try {
    const res  = await fetch('/api/auth', { method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ name, password }) });
    const data = await res.json();
    if (!res.ok) { $('login-error').textContent = data.error; return; }
    buildChatScreen();
    enterChat(data);
  } catch { $('login-error').textContent = 'Connection error'; }
}

// ── Enter chat ────────────────────────────────────────────────────────────
async function enterChat(user) {
  me = user;
  profileCache.set(me.id, me);
  updateMyProfileBtn();
  initProfilePanel();
  wireComposer();
  fetch('/api/messages')
    .then(r => r.json())
    .then(msgs => { for (const m of msgs) renderMessage(m, false); forceScrollBottom(); })
    .catch(() => {});
  connectWS();
}


// ── WebSocket ─────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', userId: me.id }));
  };

  ws.onmessage = ({ data }) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    handleWS(msg);
  };

  ws.onclose = () => { setTimeout(connectWS, 2000); };
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// ── WS message dispatch ───────────────────────────────────────────────────
function handleWS(msg) {
  switch (msg.type) {

    case 'welcome':
      mySocketId = msg.socketId;
      renderUsers(msg.users);
      break;

    case 'user_joined':
      renderUsers(msg.users);
      appendSystem(`${esc(msg.user.name)} joined`);
      break;

    case 'user_left':
      renderUsers(msg.users);
      appendSystem(`${esc(msg.userName)} left`);
      // Mark their file bubbles as offline
      markUploaderOffline(msg.userId);
      break;

    case 'message':
      renderMessage({
        id: msg.id, user_id: msg.userId, user_name: msg.userName,
        type: msg.msgType, content: msg.content, file_meta: msg.fileMeta,
        created_at: msg.createdAt, uploaderSocketId: msg.uploaderSocketId,
      }, true);
      break;

    case 'typing':
      handleTypingEvent(msg);
      break;

    // Server tells me (uploader) to re-host these fileIds after reconnect
    case 'rehost_files':
      for (const fileId of msg.fileIds) {
        if (hostedFiles.has(fileId)) {
          // Re-announce so server maps new socketId
          const file = hostedFiles.get(fileId);
          send({ type: 'file_announce', fileId, name: file.name,
            size: file.size, mimeType: file.type || 'application/octet-stream',
            reannounce: true });
        }
      }
      break;

    // Uploader came (back) online — update our map and retry any stalled downloads
    case 'uploader_online':
      handleUploaderOnline(msg.userId, msg.socketId);
      break;

    // A specific file is now available (uploader re-announced after reconnect)
    case 'file_available':
      fileUploaderMap.set(msg.fileId, msg.uploaderSocketId);
      updateFileBubbleStatus(msg.fileId, 'online', msg.uploaderSocketId);
      // Notify anything waiting on this file
      triggerWaitingCallbacks(msg.fileId);
      break;

    // Uploader's browser is serving a chunk to me
    case 'file_chunk':
      handleFileChunk(msg);
      break;

    // Someone wants a file I'm hosting
    case 'file_request':
      handleIncomingFileRequest(msg);
      break;

    case 'file_unavailable':
      handleFileUnavailable(msg);
      break;

    case 'profile_update':
      handleProfileUpdate(msg.profile);
      break;
  }
}

// ── Uploader-side: serve file chunks ─────────────────────────────────────
async function handleIncomingFileRequest({ fileId, requestId, resumeFrom = 0, requesterSocketId }) {
  const file = hostedFiles.get(fileId);
  if (!file) {
    send({ type: 'file_chunk', requestId, requesterSocketId, chunk: null, done: true,
      error: 'File not available in this browser session' });
    return;
  }
  streamFileTo(file, requestId, requesterSocketId, resumeFrom);
}

// Stream file → requester, starting at resumeFrom bytes
async function streamFileTo(file, requestId, requesterSocketId, resumeFrom = 0) {
  const CHUNK_SIZE = 256 * 1024; // 256 KB — bigger chunks = fewer round trips
  let offset = resumeFrom;

  while (offset < file.size) {
    // Check socket is still up before each chunk
    if (!ws || ws.readyState !== WebSocket.OPEN) return; // requester will retry on reconnect

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();

    // base64-encode for JSON transport
    const bytes = new Uint8Array(buffer);
    let binary = '';
    // Build binary string in 8 KB steps to avoid stack overflow on large chunks
    const STEP = 8192;
    for (let i = 0; i < bytes.length; i += STEP) {
      binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
    }
    const chunk = btoa(binary);

    offset += buffer.byteLength;
    const done = offset >= file.size;
    send({ type: 'file_chunk', requestId, requesterSocketId, chunk, done });

    if (!done) await new Promise(r => setTimeout(r, 0)); // yield to event loop
  }
}

// ── Downloader-side: receive chunks & handle resume ───────────────────────
function handleFileChunk({ requestId, chunk, done, error }) {
  const dl = pendingDownloads.get(requestId);
  if (!dl) return;

  // Reset stall timer on every chunk received
  resetStallTimer(requestId);

  if (error) {
    finishDownload(requestId, null, error);
    return;
  }

  if (chunk) {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    dl.chunks.push(bytes);
    dl.received += bytes.length;

    // Save partial progress so we can resume if something goes wrong
    partialDownloads.set(dl.fileId, { chunks: dl.chunks, received: dl.received });

    dl.onProgress && dl.onProgress(dl.received, dl.fileSize);
  }

  if (done) {
    finishDownload(requestId, null, null);
  }
}

function finishDownload(requestId, forcedBlob, error) {
  const dl = pendingDownloads.get(requestId);
  if (!dl) return;
  clearStallTimer(requestId);
  pendingDownloads.delete(requestId);
  dl.done = true;

  if (error) {
    dl.onStatusChange && dl.onStatusChange('error', error);
    dl.reject(new Error(error));
    return;
  }

  partialDownloads.delete(dl.fileId); // clean up partial state on success
  const blob = forcedBlob || new Blob(dl.chunks, { type: dl.mime || 'application/octet-stream' });
  dl.resolve(blob);
}

function handleFileUnavailable({ fileId, requestId }) {
  const dl = pendingDownloads.get(requestId);
  if (!dl) return;
  clearStallTimer(requestId);
  pendingDownloads.delete(requestId);

  // Don't reject — enter "waiting for uploader" state so we resume when they return
  dl.onStatusChange && dl.onStatusChange('waiting', 'Uploader offline — will resume when they return');

  // Register to retry when uploader comes back
  const ownerId = fileOwnerMap.get(fileId);
  if (ownerId) {
    if (!waitingForUploader.has(fileId)) waitingForUploader.set(fileId, new Set());
    waitingForUploader.get(fileId).add(() => {
      dl.onStatusChange && dl.onStatusChange('resuming', `Resuming from ${formatSize(dl.received)}…`);
      startDownload(dl);
    });
  } else {
    dl.reject(new Error('Uploader offline'));
  }
}

// ── Stall detection (no chunks for 15s → treat as disconnected) ───────────
function resetStallTimer(requestId) {
  const dl = pendingDownloads.get(requestId);
  if (!dl) return;
  clearStallTimer(requestId);
  dl.stallTimer = setTimeout(() => {
    if (!pendingDownloads.has(requestId)) return;
    pendingDownloads.delete(requestId);
    dl.onStatusChange && dl.onStatusChange('waiting', 'Transfer stalled — will resume when uploader returns');
    const ownerId = fileOwnerMap.get(dl.fileId);
    if (ownerId) {
      if (!waitingForUploader.has(dl.fileId)) waitingForUploader.set(dl.fileId, new Set());
      waitingForUploader.get(dl.fileId).add(() => {
        dl.onStatusChange && dl.onStatusChange('resuming', `Resuming from ${formatSize(dl.received)}…`);
        startDownload(dl);
      });
    } else {
      dl.reject(new Error('Transfer stalled'));
    }
  }, 15000);
}

function clearStallTimer(requestId) {
  const dl = pendingDownloads.get(requestId);
  if (dl && dl.stallTimer) { clearTimeout(dl.stallTimer); dl.stallTimer = null; }
}

// ── Start / resume a download ─────────────────────────────────────────────
// dl = { fileId, mime, name, fileSize, chunks[], received, resolve, reject, onProgress, onStatusChange }
function startDownload(dl) {
  const requestId = newId();
  dl.stallTimer = null;
  pendingDownloads.set(requestId, dl);

  send({ type: 'file_request', fileId: dl.fileId, requestId, resumeFrom: dl.received });
  resetStallTimer(requestId);
}

// Public API: initiate a new download for a file bubble
function initiateDownload(fileId, meta) {
  return new Promise((resolve, reject) => {
    // Pick up any partial progress from a previous attempt
    const partial = partialDownloads.get(fileId);
    const dl = {
      fileId,
      mime: meta.mimeType,
      name: meta.name,
      fileSize: meta.size,
      chunks: partial ? partial.chunks : [],
      received: partial ? partial.received : 0,
      resolve, reject,
      onProgress: null,      // set by caller
      onStatusChange: null,  // set by caller
      stallTimer: null,
      done: false,
    };
    startDownload(dl);
  });
}

// ── Uploader came back online ─────────────────────────────────────────────
function handleUploaderOnline(userId, socketId) {
  // Update fileUploaderMap for all files owned by this user
  for (const [fileId, ownerId] of fileOwnerMap) {
    if (ownerId === userId) {
      fileUploaderMap.set(fileId, socketId);
      updateFileBubbleStatus(fileId, 'online', socketId);
    }
  }
  // Fire any waiting download callbacks for this user's files
  for (const [fileId, ownerId] of fileOwnerMap) {
    if (ownerId === userId) triggerWaitingCallbacks(fileId);
  }
}

function triggerWaitingCallbacks(fileId) {
  const cbs = waitingForUploader.get(fileId);
  if (!cbs || !cbs.size) return;
  const snapshot = [...cbs];
  cbs.clear();
  for (const cb of snapshot) cb();
}

// ── Profile cache & updates ───────────────────────────────────────────────
function handleProfileUpdate(profile) {
  profileCache.set(profile.id, profile);
  if (profile.id === me.id) {
    me = profile;

    updateMyProfileBtn();
    refreshProfilePanel();
  }
  // Update all message avatars for this user
  document.querySelectorAll(`.msg-avatar[data-user-id="${profile.id}"]`).forEach(el => {
    applyAvatarToEl(el, profile);
  });
  // Update user blobs
  document.querySelectorAll(`.user-blob[data-user-id="${profile.id}"]`).forEach(el => {
    applyAvatarToBlob(el, profile);
    el.dataset.name = profile.id === me.id ? profile.name + ' (you)' : profile.name;
  });
}

// Render an avatar (initial or image) into any square element
function applyAvatarToEl(el, profile) {
  el.innerHTML = '';
  if (profile.avatar) {
    const img = document.createElement('img');
    img.src = profile.avatar;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    el.appendChild(img);
  } else {
    el.textContent = profile.name.charAt(0);
  }
}

function applyAvatarToBlob(el, profile) {
  el.innerHTML = '';
  if (profile.avatar) {
    const img = document.createElement('img');
    img.src = profile.avatar;
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
    el.appendChild(img);
  } else {
    el.textContent = profile.name.charAt(0);
  }
}

// Floating profile btn reflects own avatar/initial
function updateMyProfileBtn() {
  const btn = $('my-profile-btn');
  btn.innerHTML = '';
  if (me.avatar) {
    const img = document.createElement('img');
    img.src = me.avatar;
    btn.appendChild(img);
  } else {
    btn.textContent = me.name.charAt(0);
  }
}

// ── DOM: file bubble status updates ──────────────────────────────────────
// We tag each file bubble's wrapper with data-file-id so we can find & update it

function updateFileBubbleStatus(fileId, status, uploaderSocketId) {
  const wrapper = document.querySelector(`[data-file-id="${fileId}"]`);
  if (!wrapper) return;
  const faction = wrapper.querySelector('.file-action');
  if (!faction) return;

  if (status === 'online') {
    faction.textContent = 'Click to download';
    faction.style.color = 'var(--accent)';
    const bubble = wrapper.querySelector('.file-bubble');
    if (bubble) {
      bubble.style.cursor = 'pointer';
      bubble.style.opacity = '1';
    }
  } else if (status === 'offline') {
    faction.textContent = 'Uploader offline — will resume when they return';
    faction.style.color = 'var(--text-muted)';
  }
}

function markUploaderOffline(userId) {
  for (const [fileId, ownerId] of fileOwnerMap) {
    if (ownerId === userId) {
      updateFileBubbleStatus(fileId, 'offline', null);
    }
  }
}

// ── Render helpers ────────────────────────────────────────────────────────
function scrollBottom() {
  const el = $('messages');
  // Only auto-scroll if user is near the bottom (within 120px)
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

function forceScrollBottom() {
  const el = $('messages');
  el.scrollTop = el.scrollHeight;
}

function appendSystem(text) {
  lastGroup = null;
  const d = document.createElement('div');
  d.className = 'msg-system';
  d.textContent = text;
  $('messages').appendChild(d);
  scrollBottom();
}

// Generate a consistent color per user from their ID (stable across renames)
function userColor(userId) {
  const palette = ['#b07156','#7a8c5e','#5e7a8c','#8c5e7a','#8c7a5e','#5e8c75'];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

function renderMessage(m, live) {
  const isMe = m.user_id === me.id;
  const messagesEl = $('messages');

  // Track uploader info from all file messages
  if (m.type === 'file' && m.file_meta && m.file_meta.fileId) {
    fileOwnerMap.set(m.file_meta.fileId, m.user_id);
    if (m.uploaderSocketId) fileUploaderMap.set(m.file_meta.fileId, m.uploaderSocketId);
  }

  const isSameUser = lastGroup && lastGroup.userId === m.user_id;
  const timeDiff = isSameUser ? (m.created_at - (lastGroup.lastTs || 0)) : Infinity;
  const isFollowUp = isSameUser && timeDiff < 5 * 60 * 1000; // collapse within 5 min

  if (isFollowUp) {
    appendBubble(lastGroup.el, m, isMe);
    lastGroup.lastTs = m.created_at;
  } else {
    // New group row
    const group = document.createElement('div');
    group.className = 'msg-group' + (isMe ? ' is-me' : '');
    if (isFollowUp) group.classList.add('follow-up');
    group.dataset.userId = m.user_id;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.dataset.userId = m.user_id;
    const profile = profileCache.get(m.user_id) || { name: m.user_name, avatar: null };
    applyAvatarToEl(avatar, profile);
    avatar.style.background = userColor(m.user_id);

    // Body
    const body = document.createElement('div');
    body.className = 'msg-body';

    // Header row (name + timestamp)
    const header = document.createElement('div');
    header.className = 'msg-header';

    const author = document.createElement('span');
    author.className = 'msg-author';
    author.textContent = m.user_name;

    const ts = document.createElement('span');
    ts.className = 'msg-timestamp';
    ts.textContent = formatTime(m.created_at);

    header.append(author, ts);
    body.appendChild(header);
    group.append(avatar, body);
    messagesEl.appendChild(group);

    lastGroup = { userId: m.user_id, el: group, bodyEl: body, lastTs: m.created_at };
    appendBubble(group, m, isMe);
  }

  if (live) scrollBottom();
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent)">$1</a>');
}

function triggerDownload(url, name) {
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── appendBubble ──────────────────────────────────────────────────────────
function appendBubble(group, m, isMe) {
  // For the first message in a group, content goes in .msg-body
  // For follow-ups the group IS the same element — find the body
  const body = group.querySelector('.msg-body') || group;

  if (m.type === 'text') {
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.innerHTML = linkify(esc(m.content));
    body.appendChild(bubble);

  } else if (m.type === 'file') {
    const meta = m.file_meta || {};
    const mime = meta.mimeType || '';
    const isImage = mime.startsWith('image/');

    // Uploader: instant inline preview from hosted file
    if (isMe && hostedFiles.has(meta.fileId)) {
      const url = URL.createObjectURL(hostedFiles.get(meta.fileId));
      if (isImage) {
        const img = document.createElement('img');
        img.className = 'img-preview'; img.alt = meta.name; img.src = url;
        img.addEventListener('click', () => openMediaViewer(url, 'image', meta.name));
        body.appendChild(img);
      } else if (mime.startsWith('audio/')) {
        body.appendChild(buildAudioPlayer(url, meta.name));
      } else if (mime.includes('pdf')) {
        body.appendChild(buildPdfBubble(url, meta.name, true));
      } else {
        buildFileBubble(body, m, isMe, meta);
      }
    } else {
      buildFileBubble(body, m, isMe, meta);
    }
  }

  // Timestamp on follow-up messages (small, inline)
  if (group.classList.contains('follow-up') || !group.querySelector('.msg-header')) {
    // no extra timestamp — it clutters follow-ups, timestamp is in header of first msg
  }
}

// ── Build file bubble ─────────────────────────────────────────────────────
function buildFileBubble(container, m, isMe, meta) {
  const fileId = meta.fileId;

  const wrapper = document.createElement('div');
  wrapper.className = 'file-wrapper';
  wrapper.dataset.fileId = fileId;

  const bubble = document.createElement('div');
  bubble.className = 'file-bubble';

  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.textContent = fileIcon(meta.mimeType);

  const info = document.createElement('div');
  info.className = 'file-info';

  const fname = document.createElement('span');
  fname.className = 'file-name';
  fname.title = meta.name;
  fname.textContent = meta.name;

  const fsize = document.createElement('span');
  fsize.className = 'file-size';
  fsize.textContent = formatSize(meta.size);

  const faction = document.createElement('span');
  faction.className = 'file-action';

  const progressWrap = document.createElement('div');
  progressWrap.className = 'dl-progress';
  const progressBar = document.createElement('div');
  progressBar.className = 'dl-progress-bar';
  progressWrap.appendChild(progressBar);

  info.append(fname, fsize, faction, progressWrap);
  bubble.append(icon, info);
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);

  if (isMe) {
    // Uploader: open instantly from hosted file
    faction.textContent = 'Click to open';
    bubble.style.cursor = 'pointer';
    bubble.addEventListener('click', () => {
      const file = hostedFiles.get(fileId);
      if (!file) return;
      const url = URL.createObjectURL(file);
      const mime = meta.mimeType || '';
      const kind = mime.split('/')[0];
      if (kind === 'image') openMediaViewer(url, 'image', meta.name);
      else if (kind === 'video') openMediaViewer(url, 'video', meta.name);
      else if (kind === 'audio') openMediaViewer(url, 'audio', meta.name);
      else if (mime.includes('pdf')) openPdfViewer(url, meta.name);
      else triggerDownload(url, meta.name);
    });
  } else {
    setupDownloadBubble({ bubble, wrapper, faction, progressBar, progressWrap, meta, fileId });
  }
}

// ── Download bubble interaction ───────────────────────────────────────────
function setupDownloadBubble({ bubble, wrapper, faction, progressBar, progressWrap, meta, fileId }) {
  const uploaderOnline = fileUploaderMap.has(fileId);
  const mime = meta.mimeType || '';
  const kind = mime.split('/')[0];
  const isPdf = mime.includes('pdf');

  if (uploaderOnline) {
    faction.textContent = clickLabel(kind, isPdf);
    bubble.style.cursor = 'pointer';
  } else {
    faction.textContent = 'Uploader offline — will resume when they return';
    faction.style.color = 'var(--text-muted)';
  }

  // Show partial progress badge if we have a partial download saved
  const partial = partialDownloads.get(fileId);
  if (partial && partial.received > 0 && meta.size) {
    const pct = Math.round((partial.received / meta.size) * 100);
    faction.textContent = `Resume (${pct}% already downloaded)`;
    progressWrap.style.display = 'block';
    progressBar.style.width = pct + '%';
  }

  let active = false;

  const onClick = async () => {
    if (active) return;
    if (!fileUploaderMap.has(fileId)) {
      faction.textContent = 'Waiting for uploader…';
      if (!waitingForUploader.has(fileId)) waitingForUploader.set(fileId, new Set());
      waitingForUploader.get(fileId).add(onClick);
      return;
    }

    active = true;
    progressWrap.style.display = 'block';
    faction.textContent = 'Connecting…';

    const dl = await runDownload(fileId, meta, {
      onProgress(received, total) {
        if (total) {
          const pct = Math.round((received / total) * 100);
          progressBar.style.width = pct + '%';
          faction.textContent = `${formatSize(received)} / ${formatSize(total)} (${pct}%)`;
        }
      },
      onStatusChange(status, detail) {
        if (status === 'waiting' || status === 'resuming') {
          faction.textContent = detail;
          faction.style.color = 'var(--text-muted)';
          active = false;
        } else if (status === 'error') {
          faction.textContent = '✗ ' + detail;
          faction.style.color = 'var(--accent)';
          progressWrap.style.display = 'none';
          active = false;
        }
      },
    });

    if (!dl) return;

    faction.style.color = '';
    const url = URL.createObjectURL(dl);

    if (kind === 'image') {
      // Replace bubble with inline image
      const img = document.createElement('img');
      img.className = 'img-preview'; img.src = url; img.alt = meta.name;
      img.addEventListener('click', () => openMediaViewer(url, 'image', meta.name));
      wrapper.replaceWith(img);

    } else if (kind === 'audio') {
      // Replace bubble with inline audio player
      wrapper.replaceWith(buildAudioPlayer(url, meta.name));

    } else if (isPdf) {
      // Replace bubble with a PDF preview tile (click to open full viewer)
      wrapper.replaceWith(buildPdfBubble(url, meta.name, false));

    } else if (kind === 'video') {
      progressBar.style.width = '100%';
      faction.textContent = 'Click to watch';
      faction.style.color = 'var(--accent)';
      active = false;
      bubble.onclick = () => openMediaViewer(url, 'video', meta.name);

    } else {
      triggerDownload(url, meta.name);
      progressBar.style.width = '100%';
      faction.textContent = 'Downloaded ✓';
      active = false;
    }
  };

  bubble.addEventListener('click', onClick);
}

function clickLabel(kind, isPdf) {
  if (kind === 'audio') return 'Click to play';
  if (isPdf) return 'Click to view PDF';
  if (kind === 'image') return 'Click to view';
  if (kind === 'video') return 'Click to watch';
  return 'Click to download';
}

// Wraps initiateDownload with callbacks wired to the UI
function runDownload(fileId, meta, { onProgress, onStatusChange }) {
  return new Promise((resolve) => {
    const partial = partialDownloads.get(fileId);
    const dl = {
      fileId, mime: meta.mimeType, name: meta.name, fileSize: meta.size,
      chunks: partial ? partial.chunks : [],
      received: partial ? partial.received : 0,
      stallTimer: null, done: false,
      resolve: blob => resolve(blob),
      reject: err => { onStatusChange('error', err.message); resolve(null); },
      onProgress,
      onStatusChange,
    };
    startDownload(dl);
  });
}

// ── Audio player (inline, voice-note style) ───────────────────────────────
function buildAudioPlayer(url, name) {
  const wrap = document.createElement('div');
  wrap.className = 'audio-player';

  const icon = document.createElement('span');
  icon.className = 'audio-icon';
  icon.textContent = '🎵';

  const col = document.createElement('div');
  col.className = 'audio-col';

  const label = document.createElement('span');
  label.className = 'audio-label';
  label.textContent = name;
  label.title = name;

  const audio = document.createElement('audio');
  audio.src = url;
  audio.controls = true;
  audio.preload = 'metadata';

  const dlLink = document.createElement('a');
  dlLink.href = url; dlLink.download = name;
  dlLink.textContent = '⬇';
  dlLink.title = 'Download';
  dlLink.className = 'audio-dl';

  col.append(label, audio);
  wrap.append(icon, col, dlLink);
  return wrap;
}

// ── PDF bubble (click → open full viewer) ────────────────────────────────
function buildPdfBubble(url, name, isUploader) {
  const wrap = document.createElement('div');
  wrap.className = 'pdf-bubble';
  wrap.title = 'Click to view PDF';

  const icon = document.createElement('span');
  icon.className = 'pdf-icon';
  icon.textContent = '📕';

  const info = document.createElement('div');
  info.className = 'pdf-info';

  const fname = document.createElement('span');
  fname.className = 'pdf-name';
  fname.textContent = name;

  const hint = document.createElement('span');
  hint.className = 'pdf-hint';
  hint.textContent = isUploader ? 'Click to open' : 'PDF — click to view';

  info.append(fname, hint);
  wrap.append(icon, info);

  wrap.addEventListener('click', () => openPdfViewer(url, name));
  return wrap;
}

// ── PDF full-screen viewer ────────────────────────────────────────────────
function openPdfViewer(url, name) {
  const overlay = document.createElement('div');
  overlay.className = 'pdf-overlay';

  const toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';

  const title = document.createElement('span');
  title.className = 'pdf-toolbar-title';
  title.textContent = name;

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:0.6rem;align-items:center;';

  const dlBtn = document.createElement('a');
  dlBtn.href = url; dlBtn.download = name;
  dlBtn.className = 'pdf-toolbar-btn';
  dlBtn.textContent = '⬇ Download';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'pdf-toolbar-btn';
  closeBtn.textContent = '✕ Close';
  closeBtn.addEventListener('click', () => overlay.remove());

  actions.append(dlBtn, closeBtn);
  toolbar.append(title, actions);

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.className = 'pdf-iframe';
  iframe.title = name;

  overlay.append(toolbar, iframe);
  document.body.appendChild(overlay);
}

// ── Media lightbox (image / video / audio modal) ──────────────────────────
function openMediaViewer(url, kind, name) {
  const overlay = document.createElement('div');
  overlay.className = 'media-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  if (kind === 'image') {
    const img = document.createElement('img');
    img.src = url; img.alt = name;
    overlay.appendChild(img);
  } else if (kind === 'video') {
    const vid = document.createElement('video');
    vid.src = url; vid.controls = true; vid.autoplay = true;
    overlay.appendChild(vid);
  } else if (kind === 'audio') {
    const box = document.createElement('div');
    box.className = 'media-overlay-audio';
    const lbl = document.createElement('div');
    lbl.className = 'media-overlay-audio-name';
    lbl.textContent = name;
    const aud = document.createElement('audio');
    aud.src = url; aud.controls = true; aud.autoplay = true;
    box.append(lbl, aud);
    overlay.appendChild(box);
  }

  const bar = document.createElement('div');
  bar.className = 'media-overlay-bar';

  const dl = document.createElement('a');
  dl.href = url; dl.download = name;
  dl.className = 'media-overlay-dl';
  dl.textContent = '⬇ Download';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'media-overlay-close';
  closeBtn.textContent = '✕ Close';
  closeBtn.addEventListener('click', () => overlay.remove());

  bar.append(dl, closeBtn);
  overlay.appendChild(bar);
  document.body.appendChild(overlay);
}

// ── Online user blobs ─────────────────────────────────────────────────────
function renderUsers(users) {
  const container = $('user-blobs');
  container.innerHTML = '';
  for (const u of users) {
    // Merge server-provided avatar into cache if present
    if (u.avatar !== undefined) {
      const cached = profileCache.get(u.id) || {};
      profileCache.set(u.id, { ...cached, ...u });
    }
    const profile = profileCache.get(u.id) || u;

    const blob = document.createElement('div');
    blob.className = 'user-blob' + (u.id === me.id ? ' is-me' : '');
    blob.dataset.userId = u.id;
    blob.dataset.name = u.id === me.id ? profile.name + ' (you)' : profile.name;
    applyAvatarToBlob(blob, profile);
    container.appendChild(blob);
  }
}

// ── Typing indicator ──────────────────────────────────────────────────────
const typingPeople = new Map();

function handleTypingEvent({ userId, userName, isTyping: typing }) {
  if (userId === me.id) return;
  if (typing) {
    if (typingPeople.has(userId)) clearTimeout(typingPeople.get(userId).timer);
    const timer = setTimeout(() => { typingPeople.delete(userId); renderTyping(); }, 3000);
    typingPeople.set(userId, { name: userName, timer });
  } else {
    if (typingPeople.has(userId)) { clearTimeout(typingPeople.get(userId).timer); typingPeople.delete(userId); }
  }
  renderTyping();
}

function renderTyping() {
  const bar = $('typing-bar');
  const names = [...typingPeople.values()].map(v => v.name);
  if (!names.length) { bar.textContent = ''; return; }
  bar.textContent = names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0,2).join(', ')} are typing…`;
}

// ── Composer ──────────────────────────────────────────────────────────────
const msgInput = $('msg-input');
const fileInput = $('file-input');
const filePreviews = $('file-previews');

msgInput.addEventListener('input', () => {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
  if (!isTyping) { isTyping = true; send({ type: 'typing', isTyping: true }); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { isTyping = false; send({ type: 'typing', isTyping: false }); }, 1500);
});

msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
});

$('send-btn').addEventListener('click', doSend);
fileInput.addEventListener('change', () => {
  for (const f of fileInput.files) addQueuedFile(f);
  fileInput.value = '';
});

function addQueuedFile(file) {
  const fileId = newId();
  queuedFiles.push({ fileId, file });

  const item = document.createElement('div');
  item.className = 'fp-item';
  item.dataset.fileId = fileId;

  const name = document.createElement('span');
  name.className = 'fp-name'; name.title = file.name; name.textContent = file.name;

  const rm = document.createElement('span');
  rm.className = 'fp-remove'; rm.textContent = '✕';
  rm.addEventListener('click', () => {
    queuedFiles = queuedFiles.filter(f => f.fileId !== fileId);
    item.remove();
  });

  item.append(name, rm);
  filePreviews.appendChild(item);
}

async function doSend() {
  const text = msgInput.value.trim();

  for (const { fileId, file } of queuedFiles) {
    hostedFiles.set(fileId, file);
    send({ type: 'file_announce', fileId, name: file.name,
      size: file.size, mimeType: file.type || 'application/octet-stream' });
  }
  queuedFiles = [];
  filePreviews.innerHTML = '';

  if (text) {
    send({ type: 'message', content: text });
    msgInput.value = '';
    msgInput.style.height = 'auto';
  }

  if (isTyping) { isTyping = false; send({ type: 'typing', isTyping: false }); }
  clearTimeout(typingTimer);
}

// ── Profile panel ─────────────────────────────────────────────────────────
function initProfilePanel() {
  $('my-profile-btn').addEventListener('click', openProfilePanel);
  $('pp-close-btn').addEventListener('click', closeProfilePanel);
  $('profile-backdrop').addEventListener('click', closeProfilePanel);
  $('pp-name-save').addEventListener('click', saveProfileName);
  $('pp-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveProfileName(); });
  $('pp-avatar-input').addEventListener('change', handleAvatarUpload);
  $('pp-avatar-remove').addEventListener('click', removeAvatar);
  $('pp-pass-save').addEventListener('click', savePassword);
}

function openProfilePanel() {
  refreshProfilePanel();
  $('profile-panel').classList.remove('hidden');
  $('profile-backdrop').classList.remove('hidden');
  $('pp-name-input').value = me.name;
  $('pp-name-error').textContent = '';
  $('pp-pass-error').textContent = '';
  $('pp-cur-pass').value = '';
  $('pp-new-pass').value = '';
}

function closeProfilePanel() {
  $('profile-panel').classList.add('hidden');
  $('profile-backdrop').classList.add('hidden');
}

function refreshProfilePanel() {
  // Avatar
  const preview = $('pp-avatar-preview');
  applyAvatarToEl(preview, me);
  preview.style.background = me.avatar ? 'transparent' : userColor(me.id);
  $('pp-avatar-remove').classList.toggle('hidden', !me.avatar);

  // UID badge
  $('pp-uid').textContent = me.uid ? `#${me.uid}` : '';

  // Aliases list
  const list    = $('pp-aliases-list');
  list.innerHTML = '';
  for (const alias of (me.aliases || [me.name])) {
    const row  = document.createElement('div');
    row.className = 'pp-alias-row' + (alias === me.name ? ' active' : '');

    const dot  = document.createElement('div');
    dot.className = 'pp-alias-dot';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'pp-alias-name';
    nameSpan.textContent = alias;

    row.append(dot, nameSpan);

    if (alias === me.name) {
      const badge = document.createElement('span');
      badge.className = 'pp-alias-badge';
      badge.textContent = 'active';
      row.appendChild(badge);
    } else {
      row.title = 'Switch to this name';
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => switchToAlias(alias));
    }
    list.appendChild(row);
  }
}

// No confirmation password needed for name/avatar — session cookie is proof of identity.
// Only password changes require the current password.

async function saveProfileName() {
  const newName = $('pp-name-input').value.trim();
  if (!newName || newName === me.name) { closeProfilePanel(); return; }
  $('pp-name-error').textContent = '';
  try {
    const res  = await fetch('/api/profile', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: me.id, name: newName }) });
    const data = await res.json();
    if (!res.ok) { $('pp-name-error').textContent = data.error; return; }
    me = data;
    profileCache.set(me.id, me);
    updateMyProfileBtn();
    refreshProfilePanel();
  } catch { $('pp-name-error').textContent = 'Failed to save'; }
}

async function switchToAlias(alias) {
  $('pp-name-error').textContent = '';
  try {
    const res  = await fetch('/api/profile', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: me.id, name: alias }) });
    const data = await res.json();
    if (!res.ok) { $('pp-name-error').textContent = data.error; return; }
    me = data;
    profileCache.set(me.id, me);
    updateMyProfileBtn();
    refreshProfilePanel();
    $('pp-name-input').value = me.name;
  } catch { $('pp-name-error').textContent = 'Failed to switch'; }
}

async function savePassword() {
  const currentPassword = $('pp-cur-pass').value;
  const newPassword     = $('pp-new-pass').value;
  $('pp-pass-error').textContent = '';
  if (!currentPassword) { $('pp-pass-error').textContent = 'Enter your current password'; return; }
  if (!newPassword || newPassword.length < 4) {
    $('pp-pass-error').textContent = 'New password must be at least 4 characters'; return;
  }
  try {
    const res  = await fetch('/api/profile', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: me.id, currentPassword, newPassword }) });
    const data = await res.json();
    if (!res.ok) { $('pp-pass-error').textContent = data.error; return; }
    $('pp-cur-pass').value = '';
    $('pp-new-pass').value = '';
    $('pp-pass-error').style.color = '#4ade80';
    $('pp-pass-error').textContent = 'Password updated';
    setTimeout(() => { $('pp-pass-error').textContent = ''; $('pp-pass-error').style.color = ''; }, 2500);
  } catch { $('pp-pass-error').textContent = 'Failed to update'; }
}

function handleAvatarUpload(e) {
  const file = e.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const MAX = 256;
      const canvas = document.createElement('canvas');
      const scale  = Math.min(MAX / img.width, MAX / img.height, 1);
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      uploadAvatar(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

async function uploadAvatar(dataUrl) {
  try {
    const res  = await fetch('/api/profile', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: me.id, avatar: dataUrl }) });
    const data = await res.json();
    if (!res.ok) return;
    me = data;
    profileCache.set(me.id, me);
    updateMyProfileBtn();
    refreshProfilePanel();
  } catch {}
}

async function removeAvatar() {
  try {
    const res  = await fetch('/api/profile', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: me.id, avatar: null }) });
    const data = await res.json();
    if (!res.ok) return;
    me = data;
    profileCache.set(me.id, me);
    updateMyProfileBtn();
    refreshProfilePanel();
  } catch {}
}

// ── Drag & drop ───────────────────────────────────────────────────────────
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => {
  e.preventDefault();
  if (!me) return;
  for (const file of e.dataTransfer.files) addQueuedFile(file);
});
