/* ══════════════════════════════════════════════════════════════
   tunnel.js — production launcher
   Starts köfi + a Cloudflare Tunnel so kofi.404.mn works
   without port forwarding or a static IP.

   Usage:
     node tunnel.js                   ← uses named tunnel from TUNNEL_TOKEN env
     TUNNEL_TOKEN=xxx node tunnel.js  ← same, explicit

   The TUNNEL_TOKEN env var comes from your Cloudflare dashboard.
   See README-DEPLOY.md for the one-time setup steps.
══════════════════════════════════════════════════════════════ */

const { spawn }   = require('child_process');
const { install, bin } = require('cloudflared');
const path        = require('path');

const TUNNEL_TOKEN = process.env.TUNNEL_TOKEN;
const PORT         = process.env.PORT || 3000;

// ── 1. Ensure cloudflared binary is present ────────────────────
async function ensureCloudflared() {
  try {
    await install(bin);
    console.log('  cloudflared binary ready');
  } catch (e) {
    // Already installed or install skipped — fine
  }
}

// ── 2. Start the köfi server ───────────────────────────────────
function startServer() {
  return new Promise((resolve) => {
    const srv = spawn('node', ['server.js'], {
      stdio: 'inherit',
      env: { ...process.env },
    });

    srv.on('error', err => {
      console.error('[server] failed to start:', err.message);
      process.exit(1);
    });

    // Give the server a moment to bind before starting the tunnel
    setTimeout(resolve, 2000);
    console.log(`  köfi server starting on port ${PORT}…`);
  });
}

// ── 3. Start the Cloudflare Tunnel ────────────────────────────
function startTunnel() {
  if (!TUNNEL_TOKEN) {
    // No token — quick-tunnel mode (URL changes on restart, fine for testing)
    console.log('\n  No TUNNEL_TOKEN set — starting quick tunnel (URL changes on restart)');
    console.log('  For a permanent URL at kofi.404.mn, follow README-DEPLOY.md\n');

    const tun = spawn(bin, [
      'tunnel', '--url', `http://localhost:${PORT}`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    tun.stdout.on('data', d => {
      const s = d.toString();
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) console.log(`\n  🌐 Public URL: ${m[0]}\n`);
    });
    tun.stderr.on('data', d => {
      const s = d.toString();
      const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) console.log(`\n  🌐 Public URL: ${m[0]}\n`);
    });

    tun.on('close', code => {
      if (code !== 0) console.error('[tunnel] exited with code', code);
    });
    return;
  }

  // Named tunnel mode — permanent URL, tied to your domain
  console.log('  Starting named Cloudflare Tunnel…');
  const tun = spawn(bin, [
    'tunnel', 'run', '--token', TUNNEL_TOKEN,
  ], { stdio: 'inherit' });

  tun.on('error', err => console.error('[tunnel] error:', err.message));
  tun.on('close', code => {
    if (code !== 0) {
      console.error('[tunnel] exited with code', code, '— restarting in 5s');
      setTimeout(startTunnel, 5000);
    }
  });
}

// ── Boot ───────────────────────────────────────────────────────
(async () => {
  console.log('\n  köfi production launcher\n');
  await ensureCloudflared();
  await startServer();
  startTunnel();
})();
