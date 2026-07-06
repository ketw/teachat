# köfi

A minimal local network chat app. Runs on your device — anyone on the same network can connect via your IP, similar to how LM Studio serves models locally.

## Features

- **Local network** — share your IP:port, anyone on your network can join
- **Name-based identity** — pick a name, claim it forever. Switch between past names anytime. Names can never be taken by others
- **Profile photos** — upload an avatar, visible to everyone in real time
- **P2P file sharing** — files stay in the uploader's browser. Downloads stream directly from their tab with chunked resumable transfer
- **Resume on reconnect** — if the uploader goes offline mid-transfer, the download pauses and auto-resumes when they return
- **Media inline** — images preview in-chat, audio plays as a voice note, videos open in a viewer, PDFs open full-screen
- **Real-time** — WebSocket-powered with typing indicators and live online user blobs
- **Persistent history** — messages stored in SQLite (text + metadata only, no files on the server)

## Usage

```bash
npm install
npm start
```

The terminal prints your local network IP on startup. Share it with anyone on the same network.

## Tech

Node.js · Express · WebSocket · sql.js (SQLite, pure JS) · Vanilla HTML/CSS/JS

## Notes

Designed for trusted local networks. Not hardened for public internet exposure.
