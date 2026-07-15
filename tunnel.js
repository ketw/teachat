/* ── tunnel.js — personal hosting launcher ───────────────────────────────────
   Boots the köfi server locally and punches it out to the internet via a
   Cloudflare quick-tunnel (trycloudflare.com). No account, no token, no
   port-forwarding required.

   Usage:
     node tunnel.js            ← picks up PORT from env or defaults to 3000
     PORT=8080 node tunnel.js

   The printed URL is live for as long as this process is running.
   Share it with friends — closing the terminal ends the session.
──────────────────────────────────────────────────────────────────────────── */

const { spawn }        = require('child_process');
const { install, bin } = require('cloudflared');

const PORT = process.env.PORT || 3000;

// ── Step 1: ensure the cloudflared binary is present ─────────────────────
async function ensureCloudflared() {
  try {
    await install(bin);
  } catch {
    // Already installed, or install not needed — fine either way
  }
}

// ── Step 2: start the köfi server as a child process ─────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn('node', ['serve.js'], {
      stdio: 'inherit',
      env: { ...process.env, PORT: String(PORT) },
    });

    srv.on('error', err => {
      console.error('[köfi] server failed to start:', err.message);
      reject(err);
    });

    // Give the server enough time to bind before the tunnel tries to connect
    setTimeout(resolve, 1500);
  });
}

// ── Step 3: open a Cloudflare quick-tunnel pointing at the local server ───
function startTunnel() {
  return new Promise((resolve) => {
    const tun = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // The public URL appears on stderr; also check stdout just in case
    const onData = (data) => {
      const line = data.toString();
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        console.log('\n  köfi is live\n');
        console.log(`  Share this link:  ${match[0]}\n`);
        console.log('  The link works as long as this window stays open.\n');
        resolve(match[0]);
      }
    };

    tun.stdout.on('data', onData);
    tun.stderr.on('data', onData);

    tun.on('close', code => {
      if (code !== 0) {
        console.error(`[tunnel] exited with code ${code}`);
      }
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────
(async () => {
  console.log('\n  starting köfi...\n');

  await ensureCloudflared();
  await startServer();
  await startTunnel();
})();
