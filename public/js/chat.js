/* ── Chat — screen builder, WS, messages, composer, users ────────────────
──────────────────────────────────────────────────────────────────────────── */

// ── Build chat screen DOM ─────────────────────────────────────────────────
function buildChatScreen() {
  const root = $('root');
  root.innerHTML = '';

  const screen   = mk('div', { id:'chat-screen' });
  const profBtn  = mk('button', { id:'my-profile-btn', title:'Your profile' });
  profBtn.setAttribute('aria-label', 'Open profile');

  // Profile panel HTML is managed by profile.js but the element lives here
  const panel    = mk('div', { id:'profile-panel', className:'hidden' });
  panel.setAttribute('role', 'dialog');
  panel.innerHTML = `
    <div class="pp-header">
      <span class="pp-title">profile</span>
      <button class="pp-close" id="pp-close-btn" aria-label="Close">✕</button>
    </div>
    <div class="pp-avatar-section">
      <div class="pp-avatar-wrap">
        <div id="pp-avatar-preview" class="pp-avatar-preview"></div>
        <label class="pp-avatar-change" title="Upload photo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <input id="pp-avatar-input" type="file" accept="image/*" hidden />
        </label>
      </div>
      <button id="pp-avatar-remove" class="pp-avatar-remove hidden">remove photo</button>
      <div id="pp-uid" class="pp-uid"></div>
    </div>
    <div class="pp-field-group">
      <label class="pp-label">display name</label>
      <div class="pp-name-row">
        <input id="pp-name-input" type="text" class="pp-input" maxlength="32" spellcheck="false" placeholder="name" />
        <button id="pp-name-save" class="pp-btn-primary">save</button>
      </div>
      <span id="pp-name-error" class="pp-error"></span>
    </div>
    <div class="pp-field-group" id="pp-aliases-group">
      <label class="pp-label">your names <span class="pp-label-sub">— permanently claimed</span></label>
      <div id="pp-aliases-list" class="pp-aliases-list"></div>
    </div>
    <div class="pp-field-group">
      <label class="pp-label">change password</label>
      <input id="pp-cur-pass" type="password" class="pp-input" placeholder="current password" autocomplete="current-password" />
      <input id="pp-new-pass" type="password" class="pp-input" placeholder="new password" autocomplete="new-password" />
      <button id="pp-pass-save" class="pp-btn-primary" style="align-self:flex-start">update</button>
      <span id="pp-pass-error" class="pp-error"></span>
    </div>`;

  const backdrop = mk('div', { id:'profile-backdrop', className:'hidden' });
  const messages = mk('div', { id:'messages' });

  const cWrap = mk('div', { id:'composer-wrap' });
  cWrap.innerHTML = `
    <div id="typing-bar"></div>
    <div id="user-blobs"></div>
    <div id="composer">
      <label id="attach-btn" title="Attach file">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
        </svg>
        <input id="file-input" type="file" multiple hidden />
      </label>
      <div id="file-previews"></div>
      <textarea id="msg-input" placeholder="message" rows="1"></textarea>
      <button id="send-btn" title="Send (Enter)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>`;

  screen.append(profBtn, panel, backdrop, messages, cWrap);
  root.appendChild(screen);
}

// ── Enter chat ────────────────────────────────────────────────────────────
async function enterChat(user) {
  me = user;
  profileCache.set(me.id, me);
  updateMyProfileBtn();
  initProfilePanel();
  wireComposer();

  // Load history in background — don't block showing the chat
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
  ws.onopen    = () => ws.send(JSON.stringify({ type:'join', userId:me.id }));
  ws.onmessage = ({ data }) => { let m; try { m = JSON.parse(data); } catch { return; } handleWS(m); };
  ws.onclose   = () => setTimeout(connectWS, 2000);
}

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
      markUploaderOffline(msg.userId);
      break;
    case 'message':
      renderMessage({ id:msg.id, user_id:msg.userId, user_name:msg.userName,
        type:msg.msgType, content:msg.content, file_meta:msg.fileMeta,
        created_at:msg.createdAt, uploaderSocketId:msg.uploaderSocketId }, true);
      break;
    case 'typing':         handleTypingEvent(msg); break;
    case 'rehost_files':   handleRehostFiles(msg.fileIds); break;
    case 'uploader_online': handleUploaderOnline(msg.userId, msg.socketId); break;
    case 'file_available':
      fileUploaderMap.set(msg.fileId, msg.uploaderSocketId);
      updateFileBubbleStatus(msg.fileId, 'online', msg.uploaderSocketId);
      triggerWaitingCallbacks(msg.fileId);
      break;
    case 'file_chunk':     handleFileChunk(msg); break;
    case 'file_request':   handleIncomingFileRequest(msg); break;
    case 'file_unavailable': handleFileUnavailable(msg); break;
    case 'profile_update': handleProfileUpdate(msg.profile); break;
  }
}

function handleRehostFiles(fileIds) {
  for (const fileId of fileIds) {
    if (!hostedFiles.has(fileId)) continue;
    const file = hostedFiles.get(fileId);
    send({ type:'file_announce', fileId, name:file.name,
      size:file.size, mimeType:file.type || 'application/octet-stream', reannounce:true });
  }
}

// ── Messages ──────────────────────────────────────────────────────────────
function scrollBottom() {
  const el = $('messages');
  if (!el) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
}

function forceScrollBottom() {
  const el = $('messages');
  if (el) el.scrollTop = el.scrollHeight;
}

function appendSystem(text) {
  lastGroup = null;
  const d = mk('div', { className:'msg-system', textContent:text });
  $('messages').appendChild(d);
  scrollBottom();
}

function renderMessage(m, live) {
  const isMe = m.user_id === me.id;
  const messagesEl = $('messages');

  if (m.type === 'file' && m.file_meta?.fileId) {
    fileOwnerMap.set(m.file_meta.fileId, m.user_id);
    if (m.uploaderSocketId) fileUploaderMap.set(m.file_meta.fileId, m.uploaderSocketId);
  }

  const isSameUser = lastGroup && lastGroup.userId === m.user_id;
  const isFollowUp = isSameUser && (m.created_at - (lastGroup.lastTs || 0)) < 5 * 60 * 1000;

  if (isFollowUp) {
    appendBubble(lastGroup.el, m, isMe);
    lastGroup.lastTs = m.created_at;
  } else {
    const group  = mk('div', { className:'msg-group' + (isMe ? ' is-me' : '') });
    group.dataset.userId = m.user_id;

    const avatar = mk('div', { className:'msg-avatar' });
    avatar.dataset.userId = m.user_id;
    const profile = profileCache.get(m.user_id) || { name:m.user_name, avatar:null };
    applyAvatarToEl(avatar, profile);
    avatar.style.background = userColor(m.user_id);

    const body   = mk('div', { className:'msg-body' });
    const header = mk('div', { className:'msg-header' });
    header.append(
      mk('span', { className:'msg-author', textContent:m.user_name }),
      mk('span', { className:'msg-timestamp', textContent:formatTime(m.created_at) })
    );
    body.appendChild(header);
    group.append(avatar, body);
    messagesEl.appendChild(group);
    lastGroup = { userId:m.user_id, el:group, lastTs:m.created_at };
    appendBubble(group, m, isMe);
  }

  if (live) scrollBottom();
}

function appendBubble(group, m, isMe) {
  const body = group.querySelector('.msg-body') || group;

  if (m.type === 'text') {
    const bubble = mk('div', { className:'msg-bubble' });
    bubble.innerHTML = linkify(esc(m.content));
    body.appendChild(bubble);
    return;
  }

  if (m.type === 'file') {
    const meta = m.file_meta || {};
    const mime = meta.mimeType || '';

    if (isMe && hostedFiles.has(meta.fileId)) {
      // File is in memory — instant inline preview
      const url = URL.createObjectURL(hostedFiles.get(meta.fileId));
      if (mime.startsWith('image/')) {
        const img = mk('img', { className:'img-preview', alt:meta.name, src:url });
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
      // Either not the uploader, or uploader reloaded and lost the in-memory file
      buildFileBubble(body, m, isMe, meta);
    }
  }
}

// ── Online user blobs ─────────────────────────────────────────────────────
function renderUsers(users) {
  const container = $('user-blobs');
  if (!container) return;
  container.innerHTML = '';
  for (const u of users) {
    if (u.avatar !== undefined) {
      profileCache.set(u.id, { ...(profileCache.get(u.id) || {}), ...u });
    }
    const profile = profileCache.get(u.id) || u;
    const blob = mk('div', { className:'user-blob' + (u.id === me.id ? ' is-me' : '') });
    blob.dataset.userId = u.id;
    blob.dataset.name   = u.id === me.id ? profile.name + ' (you)' : profile.name;
    applyAvatarToBlob(blob, profile);
    container.appendChild(blob);
  }
}

function markUploaderOffline(userId) {
  for (const [fileId, ownerId] of fileOwnerMap) {
    if (ownerId === userId) updateFileBubbleStatus(fileId, 'offline', null);
  }
}

function updateFileBubbleStatus(fileId, status) {
  const wrapper = document.querySelector(`[data-file-id="${fileId}"]`);
  if (!wrapper) return;
  const faction = wrapper.querySelector('.file-action');
  if (!faction) return;
  if (status === 'online') {
    faction.textContent = 'Click to download';
    faction.style.color = 'var(--accent)';
    const bubble = wrapper.querySelector('.file-bubble');
    if (bubble) bubble.style.cursor = 'pointer';
  } else if (status === 'offline') {
    faction.textContent = 'Uploader offline — will resume when they return';
    faction.style.color = 'var(--muted)';
  }
}

// ── Typing indicator ──────────────────────────────────────────────────────
const typingPeople = new Map();

function handleTypingEvent({ userId, userName, isTyping: typing }) {
  if (userId === me.id) return;
  if (typing) {
    if (typingPeople.has(userId)) clearTimeout(typingPeople.get(userId).timer);
    typingPeople.set(userId, { name:userName,
      timer: setTimeout(() => { typingPeople.delete(userId); renderTyping(); }, 3000) });
  } else {
    if (typingPeople.has(userId)) { clearTimeout(typingPeople.get(userId).timer); typingPeople.delete(userId); }
  }
  renderTyping();
}

function renderTyping() {
  const bar = $('typing-bar');
  if (!bar) return;
  const names = [...typingPeople.values()].map(v => v.name);
  bar.textContent = names.length === 0 ? '' :
    names.length === 1 ? `${names[0]} is typing…` : `${names.slice(0,2).join(', ')} are typing…`;
}

// ── Composer ──────────────────────────────────────────────────────────────
// Called from enterChat() after buildChatScreen() has run
function wireComposer() {
  const msgInput    = $('msg-input');
  const fileInput   = $('file-input');
  const filePreviews = $('file-previews');

  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
    if (!isTyping) { isTyping = true; send({ type:'typing', isTyping:true }); }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { isTyping = false; send({ type:'typing', isTyping:false }); }, 1500);
  });

  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  });

  $('send-btn').addEventListener('click', doSend);

  fileInput.addEventListener('change', () => {
    for (const f of fileInput.files) addQueuedFile(f);
    fileInput.value = '';
  });

  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (!me) return;
    for (const f of e.dataTransfer.files) addQueuedFile(f);
  });
}

function addQueuedFile(file) {
  const fileId = newId();
  queuedFiles.push({ fileId, file });

  const item = mk('div', { className:'fp-item' });
  item.dataset.fileId = fileId;

  const name = mk('span', { className:'fp-name', title:file.name, textContent:file.name });
  const rm   = mk('span', { className:'fp-remove', textContent:'✕' });
  rm.addEventListener('click', () => {
    queuedFiles = queuedFiles.filter(f => f.fileId !== fileId);
    item.remove();
  });

  item.append(name, rm);
  $('file-previews').appendChild(item);
}

async function doSend() {
  const msgInput = $('msg-input');
  const text = msgInput.value.trim();

  for (const { fileId, file } of queuedFiles) {
    hostedFiles.set(fileId, file);
    send({ type:'file_announce', fileId, name:file.name,
      size:file.size, mimeType:file.type || 'application/octet-stream' });
  }
  queuedFiles = [];
  $('file-previews').innerHTML = '';

  if (text) {
    send({ type:'message', content:text });
    msgInput.value = '';
    msgInput.style.height = 'auto';
  }

  if (isTyping) { isTyping = false; send({ type:'typing', isTyping:false }); }
  clearTimeout(typingTimer);
}
