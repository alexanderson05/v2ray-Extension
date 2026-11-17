// V2 Client - background service worker. Designed by Alex Anderson.
importScripts('common.js', 'parser.js', 'logo.js');

const setBadge = (on) => {
  chrome.action.setBadgeText({ text: on ? 'ON' : '' });
  if (on) chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
};

async function scheduleAlarms() {
  const st = await getState();
  await chrome.alarms.clear('subs');
  if (st.subInterval > 0) chrome.alarms.create('subs', { periodInMinutes: Math.max(15, st.subInterval * 60) });
  chrome.alarms.create('health', { periodInMinutes: 5 });
}

chrome.runtime.onInstalled.addListener(async (d) => {
  await setToolbarIcon();
  await scheduleAlarms();
  if (d.reason === 'install') {
    addLog('info', 'V2 Client installed');
    try { await chrome.action.openPopup(); } catch (e) { /* needs a focused window; ignore */ }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await setToolbarIcon();
  await scheduleAlarms();
  await health();
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === 'subs') await updateSubs();
  if (a.name === 'health') await health();
});

// ------------------------------------------------------------------ connect / disconnect

async function connect(id) {
  const st = await getState();
  const server = st.servers.find((s) => s.id === id);
  if (!server) throw new Error('Server not found');
  const ctl = await chrome.proxy.settings.get({ incognito: false });
  if (ctl.levelOfControl === 'controlled_by_other_extensions') {
    throw new Error('Another extension controls Chrome\'s proxy. Disable it first.');
  }
  if (ctl.levelOfControl === 'not_controllable') {
    throw new Error('Chrome\'s proxy is locked by a policy on this computer.');
  }
  addLog('info', `Connecting to "${server.name}" (${server.protocol}/${server.net}/${server.security})...`);
  const r = await nativeCall({
    action: 'start', server, socksPort: st.socksPort, mode: st.mode, directDomains: st.directDomains,
  }, { timeoutMs: 40000 });
  if (!r.ok) {
    addLog('error', `Start failed [${r.code}]: ${r.error}`);
    throw new Error(r.error || r.code);
  }
  await applyProxy(st);
  await setState({ connected: true, activeId: id, connectedAt: Date.now() });
  setBadge(true);
  addLog('ok', `Connected - local SOCKS5 127.0.0.1:${st.socksPort}`);
}

async function disconnect() {
  try {
    await nativeCall({ action: 'stop' }, { timeoutMs: 10000 });
  } catch (e) {
    addLog('warn', 'Stop request failed: ' + e.message);
  }
  await clearProxy();
  await setState({ connected: false, connectedAt: 0 });
  setBadge(false);
  addLog('info', 'Disconnected');
}

// Keeps Chrome usable: if the core died (e.g. after a reboot) never leave a dead proxy behind.
async function health() {
  const st = await getState();
  if (!st.connected) return { ok: true, running: false };
  let r;
  try { r = await nativeCall({ action: 'status', socksPort: st.socksPort }, { timeoutMs: 8000 }); }
  catch (e) { r = { ok: false, error: e.message }; }
  if (r.ok && r.running) return { ok: true, running: true };
  addLog('warn', 'Core is not running (' + (r.error || 'stopped') + ')');
  if (st.autoConnect && st.activeId) {
    try {
      await connect(st.activeId);
      addLog('ok', 'Reconnected automatically');
      return { ok: true, running: true, reconnected: true };
    } catch (e) {
      addLog('error', 'Auto-reconnect failed: ' + e.message);
    }
  }
  await clearProxy();
  await setState({ connected: false, connectedAt: 0 });
  setBadge(false);
  addLog('warn', 'Proxy switched off so your browsing keeps working');
  return { ok: true, running: false };
}

// ------------------------------------------------------------------ subscriptions

const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return '?'; } };

async function updateSubs(onlyId) {
  const st = await getState();
  const subs = st.subs.slice();
  let servers = st.servers.slice();
  const errors = [];
  for (const sb of subs) {
    if (onlyId && sb.id !== onlyId) continue;
    const label = sb.name || hostOf(sb.url);
    try {
      addLog('info', `Updating subscription "${label}"...`);
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 25000);
      let res;
      try { res = await fetch(sb.url, { cache: 'no-store', signal: ctl.signal }); }
      finally { clearTimeout(to); }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const p = parseSubscription(text);
      if (p.format === 'clash') throw new Error('Clash/YAML format is not supported - ask your provider for the V2Ray (Base64) link');
      const skipped = Object.entries(p.skipped).map(([k, v]) => `${k}:${v}`).join(', ');
      if (!p.servers.length) throw new Error('No supported servers found' + (skipped ? ` (skipped ${skipped})` : ''));
      p.servers.forEach((s) => { s.source = sb.id; });
      servers = servers.filter((s) => s.source !== sb.id).concat(p.servers);
      const title = decodeProfileTitle(res.headers.get('profile-title'));
      Object.assign(sb, {
        updated: Date.now(), count: p.servers.length, error: '',
        info: parseUserInfo(res.headers.get('subscription-userinfo')),
        name: title || sb.name || hostOf(sb.url),
      });
      addLog('ok', `"${sb.name}": ${p.servers.length} servers` + (skipped ? ` (skipped ${skipped})` : ''));
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'timeout' : e.message;
      sb.error = msg;
      errors.push(msg);
      addLog('error', `Subscription "${label}" failed: ${msg}`);
    }
  }
  let activeId = st.activeId;
  if (!activeId && servers.length) activeId = servers[0].id;
  await setState({ subs, servers, activeId });
  return { ok: errors.length === 0, count: servers.length, errors };
}

// ------------------------------------------------------------------ messages from the popup

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'connect': await connect(msg.id); return { ok: true };
      case 'disconnect': await disconnect(); return { ok: true };
      case 'updateSubs': return await updateSubs(msg.id);
      case 'health': return await health();
      case 'alarms': await scheduleAlarms(); return { ok: true };
      default: return { ok: false, error: 'unknown message' };
    }
  })().then(sendResponse).catch((e) => {
    addLog('error', e.message);
    sendResponse({ ok: false, error: e.message });
  });
  return true;
});
