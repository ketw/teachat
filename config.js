/* ── köfi server configuration ────────────────────────────────────────────
   Edit these values before starting the server.
──────────────────────────────────────────────────────────────────────────── */

module.exports = {

  // ── File storage ──────────────────────────────────────────────────────────

  // Maximum file size that can be saved to the server (Save in Chat feature).
  // Files larger than this cannot be saved — users will see an error.
  // Default: 128 MB
  SAVE_SIZE_LIMIT_BYTES: 128 * 1024 * 1024,

  // Directory where saved files are stored on disk.
  // Relative to the project root. Created automatically if it doesn't exist.
  SAVED_FILES_DIR: 'saved_files',


  // ── Dynamic DNS (FreeDNS Afraid) ──────────────────────────────────────────
  //
  // köfi will fetch your current public IP on startup and compare it to the
  // last known IP. If it changed, it hits the FreeDNS update URL and tells
  // you in the console.
  //
  // How to get your FreeDNS update URL:
  //   1. Log in to https://freedns.afraid.org
  //   2. Go to Dynamic DNS → (your hostname) → click the "Direct URL" link
  //   3. Copy the full URL — it looks like:
  //      https://freedns.afraid.org/dynamic/update.php?XXXXXXXXXXXXXXXXXX
  //   4. Paste it below.
  //
  // Leave as null to disable DDNS updating entirely.
  FREEDNS_UPDATE_URL: null,

  // Your domain name — shown in the startup output so you can click it.
  // e.g. 'http://kofi.404.mn'
  DOMAIN: 'http://kofi.404.mn',

  // Port the server listens on. If you want http://kofi.404.mn (port 80)
  // to work without ":3000" in the URL, set up port forwarding on your
  // router: external 80 → this machine:PORT.
  // You can also run as root with PORT=80 but that's not recommended.
  PORT: 3000,

};
