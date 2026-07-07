/* ── File transfer — P2P upload/download, resume logic ───────────────────
──────────────────────────────────────────────────────────────────────────── */

// ── Uploader side ─────────────────────────────────────────────────────────
async function handleIncomingFileRequest({ fileId, requestId, resumeFrom = 0, requesterSocketId }) {
  const file = hostedFiles.get(fileId);
  if (!file) {
    send({ type:'file_chunk', requestId, requesterSocketId, chunk:null, done:true,
      error:'File not available in this browser session' });
    return;
  }
  streamFileTo(file, requestId, requesterSocketId, resumeFrom);
}

async function streamFileTo(file, requestId, requesterSocketId, resumeFrom = 0) {
  const CHUNK_SIZE = 256 * 1024;
  let offset = resumeFrom;
  while (offset < file.size) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buffer = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    const bytes  = new Uint8Array(buffer);
    let binary   = '';
    const STEP   = 8192;
    for (let i = 0; i < bytes.length; i += STEP)
      binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
    offset += buffer.byteLength;
    send({ type:'file_chunk', requestId, requesterSocketId, chunk:btoa(binary), done:offset >= file.size });
    if (offset < file.size) await new Promise(r => setTimeout(r, 0));
  }
}

// ── Downloader side ───────────────────────────────────────────────────────
function handleFileChunk({ requestId, chunk, done, error }) {
  const dl = pendingDownloads.get(requestId);
  if (!dl) return;
  resetStallTimer(requestId);
  if (error) { finishDownload(requestId, null, error); return; }
  if (chunk) {
    const binary = atob(chunk);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    dl.chunks.push(bytes);
    dl.received += bytes.length;
    partialDownloads.set(dl.fileId, { chunks:dl.chunks, received:dl.received });
    dl.onProgress && dl.onProgress(dl.received, dl.fileSize);
  }
  if (done) finishDownload(requestId, null, null);
}

function finishDownload(requestId, forcedBlob, error) {
  const dl = pendingDownloads.get(requestId);
  if (!dl) return;
  clearStallTimer(requestId);
  pendingDownloads.delete(requestId);
  dl.done = true;
  if (error) { dl.onStatusChange && dl.onStatusChange('error', error); dl.reject(new Error(error)); return; }
  partialDownloads.delete(dl.fileId);
  dl.resolve(forcedBlob || new Blob(dl.chunks, { type:dl.mime || 'application/octet-stream' }));
}

function handleFileUnavailable({ fileId, requestId }) {
  const dl = pendingDownloads.get(requestId);
  if (!dl) return;
  clearStallTimer(requestId);
  pendingDownloads.delete(requestId);
  dl.onStatusChange && dl.onStatusChange('waiting', 'Uploader offline — will resume when they return');
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

// ── Stall detection ───────────────────────────────────────────────────────
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
    } else { dl.reject(new Error('Transfer stalled')); }
  }, 15000);
}

function clearStallTimer(requestId) {
  const dl = pendingDownloads.get(requestId);
  if (dl?.stallTimer) { clearTimeout(dl.stallTimer); dl.stallTimer = null; }
}

// ── Start / resume ────────────────────────────────────────────────────────
function startDownload(dl) {
  const requestId = newId();
  dl.stallTimer = null;
  pendingDownloads.set(requestId, dl);
  send({ type:'file_request', fileId:dl.fileId, requestId, resumeFrom:dl.received });
  resetStallTimer(requestId);
}

function runDownload(fileId, meta, { onProgress, onStatusChange }) {
  return new Promise(resolve => {
    const partial = partialDownloads.get(fileId);
    startDownload({
      fileId, mime:meta.mimeType, name:meta.name, fileSize:meta.size,
      chunks:   partial ? partial.chunks   : [],
      received: partial ? partial.received : 0,
      stallTimer:null, done:false,
      resolve: blob => resolve(blob),
      reject:  err  => { onStatusChange('error', err.message); resolve(null); },
      onProgress, onStatusChange,
    });
  });
}

function handleUploaderOnline(userId, socketId) {
  for (const [fileId, ownerId] of fileOwnerMap) {
    if (ownerId !== userId) continue;
    fileUploaderMap.set(fileId, socketId);
    updateFileBubbleStatus(fileId, 'online', socketId);
  }
  for (const [fileId, ownerId] of fileOwnerMap) {
    if (ownerId === userId) triggerWaitingCallbacks(fileId);
  }
}

function triggerWaitingCallbacks(fileId) {
  const cbs = waitingForUploader.get(fileId);
  if (!cbs?.size) return;
  const snapshot = [...cbs]; cbs.clear();
  snapshot.forEach(cb => cb());
}

// ── File bubble ───────────────────────────────────────────────────────────
function buildFileBubble(container, m, isMe, meta) {
  const fileId = meta.fileId;
  const wrapper = mk('div', { className:'file-wrapper' });
  wrapper.dataset.fileId = fileId;

  const bubble  = mk('div', { className:'file-bubble' });
  const icon    = mk('span', { className:'file-icon', textContent:fileIcon(meta.mimeType) });
  const info    = mk('div', { className:'file-info' });
  const fname   = mk('span', { className:'file-name', title:meta.name, textContent:meta.name });
  const fsize   = mk('span', { className:'file-size', textContent:formatSize(meta.size) });
  const faction = mk('span', { className:'file-action' });
  const pWrap   = mk('div', { className:'dl-progress' });
  const pBar    = mk('div', { className:'dl-progress-bar' });
  pWrap.appendChild(pBar);
  info.append(fname, fsize, faction, pWrap);
  bubble.append(icon, info);
  wrapper.appendChild(bubble);
  container.appendChild(wrapper);

  if (isMe) {
    const file = hostedFiles.get(fileId);
    if (file) {
      // File in memory (same session) — open directly, instant, no network needed
      faction.textContent = clickLabel(kind, isPdf);
      bubble.style.cursor = 'pointer';
      bubble.addEventListener('click', () => {
        const url = URL.createObjectURL(file);
        if (kind === 'image') openMediaViewer(url, 'image', meta.name);
        else if (kind === 'video') openMediaViewer(url, 'video', meta.name);
        else if (kind === 'audio') openMediaViewer(url, 'audio', meta.name);
        else if (isPdf) openPdfViewer(url, meta.name);
        else triggerDownload(url, meta.name);
      });
      return;
    }
    // After a page reload the in-memory file is gone — can't serve or download it.
    // Show a clear message rather than silently doing nothing.
    faction.textContent = 'Reload lost the file — re-send to share again';
    faction.style.color = 'var(--muted)';
    bubble.style.cursor = 'default';
    bubble.title = 'The file is only held in your browser tab. Re-uploading will make it available again.';
    return;
  }

  // Downloader side
  const mime = meta.mimeType || '';
  const kind = mime.split('/')[0];
  const isPdf = mime.includes('pdf');
  const uploaderOnline = fileUploaderMap.has(fileId);

  faction.textContent = uploaderOnline
    ? clickLabel(kind, isPdf)
    : 'Uploader offline — will resume when they return';
  if (!uploaderOnline) faction.style.color = 'var(--muted)';

  const partial = partialDownloads.get(fileId);
  if (partial?.received > 0 && meta.size) {
    const pct = Math.round((partial.received / meta.size) * 100);
    faction.textContent = `Resume (${pct}% already downloaded)`;
    pWrap.style.display = 'block';
    pBar.style.width = pct + '%';
  }

  let active = false;
  bubble.style.cursor = uploaderOnline ? 'pointer' : 'default';

  bubble.addEventListener('click', async () => {
    if (active) return;
    if (!fileUploaderMap.has(fileId)) {
      faction.textContent = 'Waiting for uploader…';
      if (!waitingForUploader.has(fileId)) waitingForUploader.set(fileId, new Set());
      waitingForUploader.get(fileId).add(() => bubble.click());
      return;
    }
    active = true;
    pWrap.style.display = 'block';
    faction.textContent = 'Connecting…';

    const blob = await runDownload(fileId, meta, {
      onProgress(received, total) {
        if (!total) return;
        const pct = Math.round((received / total) * 100);
        pBar.style.width = pct + '%';
        faction.textContent = `${formatSize(received)} / ${formatSize(total)} (${pct}%)`;
      },
      onStatusChange(status, detail) {
        faction.textContent = detail;
        faction.style.color = status === 'error' ? 'var(--accent)' : 'var(--muted)';
        if (status !== 'resuming') { active = false; if (status === 'error') pWrap.style.display = 'none'; }
      },
    });

    if (!blob) return;
    faction.style.color = '';
    const url = URL.createObjectURL(blob);

    if (kind === 'image') {
      const img = mk('img', { className:'img-preview', src:url, alt:meta.name });
      img.addEventListener('click', () => openMediaViewer(url, 'image', meta.name));
      wrapper.replaceWith(img);
    } else if (kind === 'audio') {
      wrapper.replaceWith(buildAudioPlayer(url, meta.name));
    } else if (isPdf) {
      wrapper.replaceWith(buildPdfBubble(url, meta.name, false));
    } else if (kind === 'video') {
      pBar.style.width = '100%';
      faction.textContent = 'Click to watch'; faction.style.color = 'var(--accent)';
      active = false;
      bubble.onclick = () => openMediaViewer(url, 'video', meta.name);
    } else {
      triggerDownload(url, meta.name);
      pBar.style.width = '100%';
      faction.textContent = 'Downloaded ✓'; active = false;
    }
  });
}

function clickLabel(kind, isPdf) {
  if (kind === 'audio') return 'Click to play';
  if (isPdf)  return 'Click to view PDF';
  if (kind === 'image') return 'Click to view';
  if (kind === 'video') return 'Click to watch';
  return 'Click to download';
}
