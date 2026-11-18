<div align="center">

# V2 Client

**V2Ray / Xray client for Chrome — paste a subscription, pick a server, connect.**

✦ *Designed by Alex Anderson* ✦

</div>

Only Chrome's own traffic goes through the tunnel; the rest of your system is untouched.

## Features

- Subscription links (Base64 / plain, usage and expiry shown when the provider sends them) and single configs
- `vless://`, `vmess://`, `trojan://`, `ss://` — TCP, WS, gRPC, HTTP/2, HTTPUpgrade, XHTTP, TLS and REALITY
- One-click connect, server search, **TCP ping for all servers**, sort by ping, **real delay** through the proxy
- Routing modes: Global, or **Bypass Iran** (`.ir` domains + Iranian IPs go direct), plus your own always-direct domains
- **Automatic Xray core download and updates** (SHA-256 verified) — nothing to download by hand
- Auto-update of subscriptions, optional auto-reconnect, safety watchdog (never leaves Chrome with a dead proxy)
- **Log panel** at the bottom with one-click *Copy* for bug reports
- Persian and English interface

## Install

1. Download the ZIP from **Releases** and extract it (or clone this repo and use the `extension` folder).
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the extracted folder (the one that contains `manifest.json`).
3. Click the V2 Client icon. The extension checks for its helper and the Xray core:
   - If the helper is missing you get a **one-time setup**: press *Download setup file*, double-click it, then the window detects it automatically. Chrome cannot start programs by itself, so this single step is unavoidable.
   - The Xray core is then downloaded and kept up to date automatically, and a **"Everything is ready"** confirmation appears.
4. Paste your subscription link or configs in **Add**, pick a server, press the power button.

The setup file is plain text (open it in Notepad). It writes the helper to `%LOCALAPPDATA%\V2Client`, uses your Python 3.8+ or downloads a private copy, and registers the helper with Chrome (Edge, Brave and Chromium too). Nothing is installed system-wide.

## Troubleshooting

Open the log panel at the bottom of the popup, press **Copy** and send the text. Logs never contain your server addresses or keys; *Core log* adds the last lines of Xray's own log (may contain addresses).

## How it works

```
Chrome extension (UI) ──native messaging──► helper (Python) ──► xray-core (local SOCKS5 127.0.0.1:10808)
          └──── chrome.proxy ────────────────────────────────────────────────────┘
```

## Limits

Only Chrome traffic is proxied. Hysteria/TUIC links and Clash YAML subscriptions are not supported. Windows is the primary target; the helper also runs on macOS/Linux but the setup file is Windows-only.

## License

MIT — © Alex Anderson
