importScripts('parser.js');

const HOST = 'com.v2ray.chrome.host';
const SOCKS_PORT = 10808;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then(sendResponse)
    .catch(e => sendResponse({ ok: false, error: e.message }));
  return true; // پاسخ async
});

async function handle(msg) {
  switch (msg.type) {
    case 'connect': return connect(msg.id);
    case 'disconnect': return disconnect();
    case 'updateSubs': return updateSubs();
  }
  return { ok: false, error: 'unknown message' };
}

function nativeSend(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST, message, resp => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

async function connect(id) {
  const { servers } = await chrome.storage.local.get({ servers: [] });
  const server = servers.find(s => s.id === id);
  if (!server) throw new Error('سرور پیدا نشد');

  const r = await nativeSend({ action: 'start', server, socksPort: SOCKS_PORT });
  if (!r || !r.ok) throw new Error(r?.error || 'هسته اجرا نشد');

  await chrome.proxy.settings.set({
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: SOCKS_PORT },
        bypassList: ['localhost', '127.0.0.1'],
      },
    },
    scope: 'regular',
  });

  await chrome.storage.local.set({ connected: true, activeId: id });
  return { ok: true };
}

async function disconnect() {
  try { await nativeSend({ action: 'stop' }); } catch { /* هسته ممکن است از قبل بسته باشد */ }
  await chrome.proxy.settings.clear({ scope: 'regular' });
  await chrome.storage.local.set({ connected: false });
  return { ok: true };
}

async function updateSubs() {
  const { servers, subs } = await chrome.storage.local.get({ servers: [], subs: [] });
  const manual = servers.filter(s => s.source === 'manual');
  let fromSubs = [];

  for (const sb of subs) {
    const res = await fetch(sb.url, { headers: { 'User-Agent': 'v2ray-chrome' } });
    if (!res.ok) throw new Error(`اشتراک پاسخ نداد: ${res.status}`);
    const list = parseSubscription(await res.text())
      .map(p => ({ ...p, source: sb.url }));
    fromSubs = fromSubs.concat(list);
  }

  const merged = [...manual.map(s => ({ ...s, source: 'manual' })), ...fromSubs];
  await chrome.storage.local.set({ servers: merged });
  return { ok: true, count: merged.length };
}
