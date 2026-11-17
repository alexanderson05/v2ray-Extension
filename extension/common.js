// V2 Client - shared helpers (used by the service worker and the popup).
// Designed by Alex Anderson.

const HOST_NAME = 'com.v2client.host';
const HOST_MIN = '2.0.0';
const GITHUB_URL = 'https://github.com/alexanderson05/v2ray-Extension';

const DEFAULTS = {
  servers: [], subs: [], activeId: null, connected: false, connectedAt: 0,
  lang: 'fa', mode: 'global', socksPort: 10808, directDomains: [],
  autoConnect: false, autoUpdateCore: true, subInterval: 6,
  coreCheckedAt: 0, setupDone: false, pings: {}, logs: [], coreVersion: '', hostVersion: '',
};

const getState = () => chrome.storage.local.get(DEFAULTS);
const setState = (o) => chrome.storage.local.set(o);

// ---- logging (kept in storage so the popup can show it and the user can copy it)
let _logQ = Promise.resolve();
function addLog(level, msg) {
  _logQ = _logQ.then(async () => {
    const { logs } = await chrome.storage.local.get({ logs: [] });
    logs.push({ t: Date.now(), l: level, m: String(msg).slice(0, 400) });
    while (logs.length > 300) logs.shift();
    await chrome.storage.local.set({ logs });
  }).catch(() => {});
  return _logQ;
}

// ---- tiny fast string hash -> short id
function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function versionLess(a, b) {
  const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  }
  return false;
}

// ---- native messaging: one request -> one result (progress messages are optional)
function classifyNativeError(text) {
  const m = String(text || '');
  if (/not found/i.test(m)) return 'not_installed';
  if (/forbidden/i.test(m)) return 'forbidden';
  if (/exited|disconnected/i.test(m)) return 'crashed';
  return 'error';
}

function nativeCall(msg, opts = {}) {
  const { onProgress, timeoutMs = 20000 } = opts;
  return new Promise((resolve, reject) => {
    let port, timer, done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { port && port.disconnect(); } catch (e) { /* already closed */ }
      if (err) reject(err); else resolve(val);
    };
    const arm = () => {
      clearTimeout(timer);
      if (timeoutMs) timer = setTimeout(() => {
        const e = new Error('The helper did not answer in time'); e.code = 'timeout'; finish(e);
      }, timeoutMs);
    };
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (e) {
      const er = new Error(e.message); er.code = 'not_installed'; return reject(er);
    }
    port.onMessage.addListener((m) => {
      if (m && m.type === 'progress') { arm(); if (onProgress) onProgress(m); return; }
      finish(null, m);
    });
    port.onDisconnect.addListener(() => {
      const le = chrome.runtime.lastError;
      const text = le ? le.message : 'Native host disconnected';
      const e = new Error(text); e.code = classifyNativeError(text); finish(e);
    });
    arm();
    try { port.postMessage(msg); } catch (e) { const er = new Error(e.message); er.code = 'error'; finish(er); }
  });
}

// ---- Chrome proxy control
async function applyProxy(st) {
  const bypass = ['localhost', '127.0.0.1', '[::1]', '<local>'];
  for (const d of st.directDomains || []) {
    const v = String(d).trim().replace(/^\*\./, '');
    if (v) { bypass.push(v); bypass.push('*.' + v); }
  }
  await chrome.proxy.settings.set({
    value: {
      mode: 'fixed_servers',
      rules: { singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: Number(st.socksPort) || 10808 }, bypassList: bypass },
    },
    scope: 'regular',
  });
}

async function clearProxy() {
  try { await chrome.proxy.settings.clear({ scope: 'regular' }); } catch (e) { /* ignore */ }
}
