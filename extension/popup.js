// V2 Client - popup logic. Designed by Alex Anderson.
let S = null, LANG = 'fa', current = '', busy = false, pingBusy = false, sortPing = false;
let setupTimer = null, logOpen = false, lastDownloadId = null, toastTimer = null, rq = 0;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const t = (k) => (I18N[LANG] && I18N[LANG][k]) || I18N.en[k] || k;
const hostOf = (u) => { try { return new URL(u).hostname; } catch (e) { return '?'; } };
const bg = (m) => new Promise((res) => chrome.runtime.sendMessage(m, (r) =>
  res(r || { ok: false, error: (chrome.runtime.lastError || {}).message || 'no answer' })));

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of kids.flat()) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function toast(msg, kind) {
  const el = $('#toast');
  el.textContent = msg; el.className = 'toast ' + (kind || ''); el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3400);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = h('textarea'); ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
}

const p2 = (n) => String(n).padStart(2, '0');
const fmtTime = (ts) => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const fmtBytes = (b) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + ' ' + u[i]; };
function relTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'now'; if (m < 60) return m + ' min'; if (m < 1440) return Math.round(m / 60) + ' h';
  return Math.round(m / 1440) + ' d';
}
function expiryText(info) {
  if (!info || !info.expire) return '';
  const d = Math.ceil((info.expire * 1000 - Date.now()) / 864e5);
  if (d < 0) return ' · ' + t('expired');
  return ` · ${t('expires')}: ${new Date(info.expire * 1000).toISOString().slice(0, 10)} (${d} ${t('days_left')})`;
}

// ------------------------------------------------------------------ screens & language

function show(name) {
  current = name;
  for (const n of ['boot', 'setup', 'main']) $('#screen-' + n).hidden = n !== name;
  if (name !== 'setup') clearInterval(setupTimer);
}

function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'fa' ? 'rtl' : 'ltr';
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $('#langBtn').textContent = LANG === 'fa' ? 'EN' : 'FA';
  if (S) renderAll();
}

async function setLang(l) {
  LANG = l; await setState({ lang: l }); $('#sLang').value = l; applyLang();
}

// ------------------------------------------------------------------ logs

function renderLogs() {
  $('#logCount').textContent = S.logs.length;
  if (!logOpen) return;
  const body = $('#logBody');
  body.textContent = '';
  for (const e of S.logs.slice(-150)) body.append(h('div', { class: 'ln ' + e.l }, h('span', { class: 'tm' }, fmtTime(e.t)), ' ', e.m));
  body.scrollTop = body.scrollHeight;
}

function diagnostics() {
  const m = chrome.runtime.getManifest();
  const lines = [
    `V2 Client ${m.version_name || m.version}`,
    `Helper: ${S.hostVersion || '-'} | Xray: ${S.coreVersion || '-'}`,
    `Browser: ${navigator.userAgent}`,
    `Mode: ${S.mode} | Port: ${S.socksPort} | Connected: ${S.connected}`,
    `Servers: ${S.servers.length} | Subscriptions: ${S.subs.length}`,
    '--- logs ---',
  ];
  S.logs.slice(-150).forEach((e) => lines.push(`${new Date(e.t).toISOString()} [${e.l}] ${e.m}`));
  return lines.join('\n');
}

async function loadCoreLog() {
  try {
    const r = await nativeCall({ action: 'get_log' }, { timeoutMs: 8000 });
    const lines = (r.core || '').split(/\r?\n/).filter(Boolean).slice(-25);
    if (!lines.length) await addLog('info', 'Core log is empty');
    for (const l of lines) await addLog('core', l);
  } catch (e) { await addLog('error', 'Could not read the core log: ' + e.message); }
}

function toggleLogs(force) {
  logOpen = force === undefined ? !logOpen : force;
  $('#logBody').hidden = !logOpen;
  $('#logArrow').innerHTML = logOpen ? '&#9662;' : '&#9656;';
  renderLogs();
}

// ------------------------------------------------------------------ boot: helper + core detection

const STEPS = ['helper', 'core', 'update', 'ready'];
function setStep(id, state, val) {
  const li = $(`.steps li[data-step="${id}"]`);
  li.dataset.state = state;
  li.querySelector('.val').textContent = val || '';
}
function onProgress(m) {
  const b = $('#bootBar');
  b.hidden = false; b.firstElementChild.style.width = (m.pct || 0) + '%';
  $('#bootMsg').textContent = m.msg || '';
}
function bootFail(step, msg) {
  setStep(step, 'err');
  $('#bootBar').hidden = true;
  const m = $('#bootMsg'); m.className = 'msg err'; m.textContent = msg;
  $('#bootRetry').hidden = false; $('#bootCopy').hidden = false;
  addLog('error', `${step}: ${msg}`);
}

async function runBoot() {
  show('boot');
  STEPS.forEach((s) => setStep(s, 'wait', ''));
  $('#readyBox').hidden = true; $('#bootRetry').hidden = true; $('#bootCopy').hidden = true;
  $('#bootBar').hidden = true; $('#bootMsg').className = 'msg'; $('#bootMsg').textContent = '';
  try {
    setStep('helper', 'run');
    let hello;
    try { hello = await nativeCall({ action: 'hello' }, { timeoutMs: 10000 }); }
    catch (e) { addLog('warn', `Helper not reachable [${e.code}]: ${e.message}`); return showSetup(e.code); }
    if (!hello.ok || versionLess(hello.hostVersion, HOST_MIN)) {
      addLog('warn', 'Helper is outdated: ' + hello.hostVersion); return showSetup('outdated');
    }
    setStep('helper', 'ok', 'v' + hello.hostVersion);
    await setState({ hostVersion: hello.hostVersion });
    addLog('ok', `Helper v${hello.hostVersion} detected (${hello.os} ${hello.arch}, Python ${hello.python})`);

    setStep('core', 'run');
    const cs = await nativeCall({ action: 'core_status' }, { timeoutMs: 20000 });
    let version = cs.version;
    if (!cs.installed) {
      $('#bootMsg').textContent = t('downloading');
      addLog('info', 'Xray core not found - downloading the latest release...');
      const up = await nativeCall({ action: 'core_update', force: true }, { timeoutMs: 240000, onProgress });
      $('#bootBar').hidden = true; $('#bootMsg').textContent = '';
      if (!up.ok) return bootFail('core', up.error || up.code);
      version = up.version;
      setStep('core', 'ok', 'Xray v' + version);
      setStep('update', 'ok', t('latest'));
      addLog('ok', `Xray ${version} installed` + (up.verified ? ' (SHA-256 verified)' : ''));
    } else {
      setStep('core', 'ok', 'Xray v' + version);
      addLog('ok', 'Xray core detected: v' + version);
      if (S.autoUpdateCore) {
        setStep('update', 'run');
        let up;
        try { up = await nativeCall({ action: 'core_update' }, { timeoutMs: 240000, onProgress }); }
        catch (e) { up = { ok: false, error: e.message }; }
        $('#bootBar').hidden = true; $('#bootMsg').textContent = '';
        if (up.ok && up.updated) {
          version = up.version;
          setStep('update', 'ok', t('updated') + ' v' + version);
          addLog('ok', 'Xray core updated to v' + version);
          if (up.wasRunning && S.connected) await bg({ type: 'connect', id: S.activeId });
        } else if (up.ok) {
          setStep('update', up.warn ? 'warn' : 'ok', up.warn ? t('offline_ok') : t('latest'));
          if (up.warn) addLog('warn', up.warn);
        } else {
          setStep('update', 'warn', t('update_failed'));
          addLog('warn', 'Core update check failed: ' + (up.error || up.code));
        }
      } else setStep('update', 'ok', t('skipped'));
    }
    await setState({ setupDone: true, coreCheckedAt: Date.now(), coreVersion: version });
    setStep('ready', 'ok');
    $('#readyBox').hidden = false;
    addLog('ok', 'All set - helper and core are ready');
    setTimeout(() => { if (current === 'boot' && !$('#readyBox').hidden) showMain(); }, 2200);
  } catch (e) {
    bootFail('core', e.message);
  }
}

// ------------------------------------------------------------------ setup (one-time helper install)

function showSetup(code) {
  show('setup');
  const map = { forbidden: 'err_forbidden', crashed: 'err_crashed', outdated: 'err_outdated', timeout: 'err_timeout' };
  const el = $('#setupErr');
  el.hidden = !map[code];
  if (map[code]) el.textContent = t(map[code]);
  clearInterval(setupTimer);
  setupTimer = setInterval(async () => {
    try {
      const r = await nativeCall({ action: 'hello' }, { timeoutMs: 6000 });
      if (r.ok && !versionLess(r.hostVersion, HOST_MIN)) { clearInterval(setupTimer); runBoot(); }
    } catch (e) { /* still not installed */ }
  }, 3000);
}

async function downloadInstaller() {
  const [tpl, host] = await Promise.all(['setup/installer.bat', 'setup/host.py']
    .map((p) => fetch(chrome.runtime.getURL(p)).then((r) => r.text())));
  const bytes = new TextEncoder().encode(host.replace(/\r\n/g, '\n'));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const b64 = btoa(bin);
  const out = tpl.replace('@@EXT_ID@@', () => chrome.runtime.id).replace('@@HOST_B64@@', () => b64).replace(/\r?\n/g, '\r\n');
  const url = 'data:application/octet-stream;base64,' + btoa(unescape(encodeURIComponent(out)));
  lastDownloadId = await chrome.downloads.download({ url, filename: 'V2Client-Setup.bat', conflictAction: 'overwrite', saveAs: false });
  $('#dlShow').hidden = false;
  addLog('info', 'Setup file downloaded: V2Client-Setup.bat');
}

// ------------------------------------------------------------------ rendering (main screen)

function pingBadge(s) {
  const v = S.pings[s.id];
  if (v === undefined) return h('span', { class: 'ping n' }, '-');
  if (v < 0) return h('span', { class: 'ping r' }, t('timeout'));
  return h('span', { class: 'ping ' + (v < 200 ? 'g' : v < 500 ? 'y' : 'r') }, v + ' ms');
}

function renderHero() {
  const on = S.connected;
  $('#power').classList.toggle('on', on && !busy);
  $('#power').classList.toggle('busy', busy);
  const st = $('#status');
  st.textContent = busy ? t('connecting') : (on ? t('connected') : t('disconnected'));
  st.classList.toggle('on', on && !busy);
  const act = S.servers.find((s) => s.id === S.activeId);
  $('#active').textContent = act ? `${act.name} · ${act.protocol.toUpperCase()}` : t('no_server');
  $('#realBtn').hidden = !on;
  $('#realBtn').textContent = t('real_delay');
  if (!on) $('#realOut').textContent = '';
  $$('.modes .chip').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.mode));
  renderUptime();
}

function renderUptime() {
  const el = $('#uptime');
  if (!S || !S.connected || !S.connectedAt) { el.textContent = ''; return; }
  const s = Math.floor((Date.now() - S.connectedAt) / 1000);
  el.textContent = `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`;
}

function renderServers() {
  const list = $('#list');
  list.textContent = '';
  $('#emptyHint').hidden = S.servers.length > 0;
  $('#pingBtn').textContent = pingBusy ? t('testing') : t('ping_all');
  $('#pingBtn').disabled = pingBusy;
  $('#sortBtn').style.borderColor = sortPing ? 'var(--acc2)' : '';
  $('#sortBtn').title = t('sort_ping');
  const q = $('#search').value.trim().toLowerCase();
  const arr = S.servers.filter((s) => !q || `${s.name} ${s.protocol} ${s.server}`.toLowerCase().includes(q));
  if (sortPing) {
    const key = (s) => { const v = S.pings[s.id]; return v === undefined ? 1e9 : v < 0 ? 1e9 + 1 : v; };
    arr.sort((a, b) => key(a) - key(b));
  }
  for (const s of arr) {
    list.append(h('li', { class: 'srv' + (s.id === S.activeId ? ' on' : ''), onclick: () => selectServer(s.id) },
      h('span', { class: 'tag ' + s.protocol }, s.protocol.toUpperCase()),
      h('div', { class: 'meta' },
        h('div', { class: 'nm' }, s.name),
        h('div', { class: 'sub' }, s.net + (s.security && s.security !== 'none' ? ' · ' + s.security : ''))),
      pingBadge(s),
      h('button', { class: 'mini', title: t('copy_link'), onclick: (e) => { e.stopPropagation(); copyText(s.raw); toast(t('copied'), 'ok'); } }, '\u29C9'),
      h('button', { class: 'mini del', title: t('remove'), onclick: (e) => { e.stopPropagation(); removeServer(s.id); } }, '\u2715')));
  }
}

function renderSubs() {
  const box = $('#subs');
  box.textContent = '';
  if (!S.subs.length) { box.append(h('p', { class: 'muted' }, t('no_subs'))); return; }
  for (const sb of S.subs) {
    const card = h('div', { class: 'subc' },
      h('div', { class: 'top' },
        h('b', {}, sb.name || hostOf(sb.url)),
        h('button', { class: 'mini', title: t('update'), onclick: () => refreshSub(sb.id) }, '\u27F3'),
        h('button', { class: 'mini del', title: t('remove'), onclick: () => removeSub(sb.id) }, '\u2715')),
      h('div', { class: 'info ltr' }, `${hostOf(sb.url)} · ${sb.count || 0} ${t('servers_n')} · ${t('updated_at')}: ${sb.updated ? relTime(sb.updated) : t('never')}`));
    const inf = sb.info;
    if (inf && inf.total) {
      const used = (inf.upload || 0) + (inf.download || 0);
      card.append(h('div', { class: 'usage' }, h('i', { style: `width:${Math.min(100, Math.round(used * 100 / inf.total))}%` })),
        h('div', { class: 'info ltr' }, `${fmtBytes(used)} / ${fmtBytes(inf.total)}${expiryText(inf)}`));
    } else if (inf && inf.expire) {
      card.append(h('div', { class: 'info ltr' }, expiryText(inf).replace(/^ · /, '')));
    }
    if (sb.error) card.append(h('div', { class: 'err ltr' }, sb.error));
    box.append(card);
  }
}

function renderSettingsInfo() {
  const m = chrome.runtime.getManifest();
  $('#vers').textContent = `Extension v${m.version} · Helper v${S.hostVersion || '-'} · Xray v${S.coreVersion || '-'}`;
  $('#verTag').textContent = 'v' + (m.version_name || m.version);
}

function fillSettings() {
  $('#sLang').value = LANG;
  $('#sMode').value = S.mode;
  $('#sPort').value = S.socksPort;
  $('#sBypass').value = (S.directDomains || []).join('\n');
  $('#sInterval').value = String(S.subInterval);
  $('#sAutoConnect').checked = !!S.autoConnect;
  $('#sAutoCore').checked = !!S.autoUpdateCore;
}

function renderAll() { renderHero(); renderServers(); renderSubs(); renderSettingsInfo(); renderLogs(); }
function scheduleRender() { cancelAnimationFrame(rq); rq = requestAnimationFrame(renderAll); }

function showMain() { show('main'); fillSettings(); renderAll(); }

// ------------------------------------------------------------------ actions

async function reconnect() {
  busy = true; renderHero();
  const r = await bg({ type: 'connect', id: S.activeId });
  busy = false;
  if (!r.ok) toast(r.error, 'err');
  S = await getState(); renderAll();
}

async function toggle() {
  if (busy) return;
  if (!S.connected && !S.activeId) { toast(t('pick_server'), 'err'); return; }
  busy = true; renderHero();
  try {
    const r = await bg({ type: S.connected ? 'disconnect' : 'connect', id: S.activeId });
    if (!r.ok) throw new Error(r.error);
  } catch (e) {
    toast(e.message, 'err');
    if (/native (messaging )?host/i.test(e.message)) showSetup(classifyNativeError(e.message));
  }
  busy = false; S = await getState(); renderAll();
}

async function selectServer(id) {
  if (id === S.activeId && S.connected) return;
  await setState({ activeId: id }); S.activeId = id; renderAll();
  if (S.connected) await reconnect();
}

async function removeServer(id) {
  if (id === S.activeId && S.connected) await bg({ type: 'disconnect' });
  await setState({ servers: S.servers.filter((s) => s.id !== id), activeId: id === S.activeId ? null : S.activeId });
}

async function removeSub(id) {
  const servers = S.servers.filter((s) => s.source !== id);
  let activeId = S.activeId;
  if (activeId && !servers.some((s) => s.id === activeId)) {
    if (S.connected) await bg({ type: 'disconnect' });
    activeId = servers.length ? servers[0].id : null;
  }
  await setState({ servers, subs: S.subs.filter((x) => x.id !== id), activeId });
}

async function refreshSub(id) {
  toast(t('testing'));
  const r = await bg({ type: 'updateSubs', id });
  toast(r.ok ? `OK · ${r.count} ${t('servers_n')}` : (r.errors && r.errors[0]) || r.error, r.ok ? 'ok' : 'err');
}

async function testAll() {
  if (pingBusy || !S.servers.length) return;
  pingBusy = true; renderServers();
  addLog('info', `TCP ping: ${S.servers.length} servers...`);
  try {
    const r = await nativeCall({
      action: 'tcping', timeout: 3,
      targets: S.servers.map((s) => ({ id: s.id, host: s.server, port: s.port })),
    }, { timeoutMs: 180000 });
    if (!r.ok) throw new Error(r.error || r.code);
    const pings = Object.assign({}, S.pings);
    let okc = 0;
    for (const [id, ms] of Object.entries(r.results)) { pings[id] = ms == null ? -1 : ms; if (ms != null) okc++; }
    await setState({ pings });
    addLog('ok', `TCP ping finished: ${okc}/${S.servers.length} reachable`);
  } catch (e) {
    addLog('error', 'Ping failed: ' + e.message);
    toast(e.message, 'err');
    if (/native (messaging )?host/i.test(e.message)) showSetup(classifyNativeError(e.message));
  }
  pingBusy = false; renderServers();
}

async function realDelay() {
  const out = $('#realOut');
  out.textContent = '...';
  const urls = ['http://cp.cloudflare.com/generate_204', 'https://www.gstatic.com/generate_204'];
  let last = '';
  for (const u of urls) {
    const t0 = performance.now();
    try {
      const c = new AbortController();
      const to = setTimeout(() => c.abort(), 8000);
      await fetch(u, { cache: 'no-store', mode: 'no-cors', signal: c.signal });
      clearTimeout(to);
      const ms = Math.round(performance.now() - t0);
      out.textContent = ms + ' ms';
      addLog('ok', `Real delay through the proxy: ${ms} ms (${hostOf(u)})`);
      return;
    } catch (e) { last = e.name === 'AbortError' ? 'timeout' : e.message; }
  }
  out.textContent = '\u2715';
  addLog('error', 'Real delay test failed: ' + last);
}

async function addFromInput() {
  const lines = $('#links').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return;
  const servers = S.servers.slice(), have = new Set(servers.map((s) => s.id)), newSubs = [];
  let added = 0, bad = 0;
  for (const l of lines) {
    if (/^https?:\/\//i.test(l)) {
      if (!S.subs.some((x) => x.url === l) && !newSubs.some((x) => x.url === l)) newSubs.push({ id: hash53(l), url: l, name: '', added: Date.now() });
      continue;
    }
    try {
      const p = parseLink(l);
      if (p && !have.has(p.id)) { p.source = 'manual'; servers.push(p); have.add(p.id); added++; }
    } catch (e) { bad++; addLog('warn', 'Skipped a link: ' + e.message); }
  }
  await setState({ servers, subs: S.subs.concat(newSubs), activeId: S.activeId || (servers[0] && servers[0].id) || null });
  S = await getState();
  $('#links').value = '';
  addLog('info', `Added ${added} server(s) and ${newSubs.length} subscription(s)` + (bad ? `, ${bad} invalid` : ''));
  let msg = `${t('added_msg')}: ${added}` + (bad ? ` · ${bad} ${t('invalid_msg')}` : '');
  for (const sb of newSubs) {
    const r = await bg({ type: 'updateSubs', id: sb.id });
    msg = r.ok ? `${t('added_msg')} · ${r.count} ${t('servers_n')}` : (r.errors && r.errors[0]) || r.error;
  }
  S = await getState();
  toast(msg, bad && !added ? 'err' : 'ok');
  if (S.servers.length) $$('.tabs button')[0].click();
}

// ------------------------------------------------------------------ init & events

function bind() {
  $('#langBtn').onclick = () => setLang(LANG === 'fa' ? 'en' : 'fa');
  $('#sLang').onchange = (e) => setLang(e.target.value);
  $('#power').onclick = toggle;
  $('#realBtn').onclick = realDelay;
  $('#pingBtn').onclick = testAll;
  $('#sortBtn').onclick = () => { sortPing = !sortPing; renderServers(); };
  $('#search').oninput = renderServers;
  $('#addBtn').onclick = addFromInput;
  $('#pasteBtn').onclick = async () => {
    try { const x = await navigator.clipboard.readText(); const a = $('#links'); a.value = a.value ? a.value + '\n' + x : x; }
    catch (e) { toast(e.message, 'err'); }
  };
  $$('.modes .chip').forEach((b) => { b.onclick = async () => {
    await setState({ mode: b.dataset.mode }); S.mode = b.dataset.mode; $('#sMode').value = S.mode; renderHero();
    if (S.connected) reconnect();
  }; });
  $('#sMode').onchange = (e) => { const b = $(`.modes .chip[data-mode="${e.target.value}"]`); if (b) b.click(); };
  $$('.tabs button').forEach((b) => { b.onclick = () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    ['servers', 'add', 'settings'].forEach((n) => { $('#tab-' + n).hidden = n !== b.dataset.tab; });
  }; });
  $('#sPort').onchange = async (e) => {
    const v = +e.target.value;
    if (!(v >= 1024 && v <= 65535)) { e.target.value = S.socksPort; toast('1024 - 65535', 'err'); return; }
    await setState({ socksPort: v }); S.socksPort = v;
    if (S.connected) reconnect();
  };
  $('#sBypass').onchange = async (e) => {
    const list = e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    await setState({ directDomains: list }); S.directDomains = list;
    if (S.connected) reconnect();
  };
  $('#sInterval').onchange = async (e) => { await setState({ subInterval: +e.target.value }); bg({ type: 'alarms' }); };
  $('#sAutoConnect').onchange = (e) => setState({ autoConnect: e.target.checked });
  $('#sAutoCore').onchange = (e) => setState({ autoUpdateCore: e.target.checked });
  $('#coreCheck').onclick = async () => {
    const msg = $('#coreMsg'); msg.textContent = '...';
    try {
      const r = await nativeCall({ action: 'core_update' }, { timeoutMs: 240000, onProgress: (m) => { msg.textContent = m.msg; } });
      if (!r.ok) throw new Error(r.error || r.code);
      await setState({ coreVersion: r.version, coreCheckedAt: Date.now() });
      msg.textContent = r.updated ? `${t('core_updated')} v${r.version}` : (r.warn || `${t('core_up_to_date')} (v${r.version})`);
      addLog(r.warn ? 'warn' : 'ok', msg.textContent);
      if (r.updated && r.wasRunning && S.connected) reconnect();
    } catch (e) { msg.textContent = e.message; addLog('error', 'Core update failed: ' + e.message); }
  };
  $('#rerun').onclick = async () => { try { await downloadInstaller(); toast('V2Client-Setup.bat', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  $('#resetBtn').onclick = async () => {
    if (!confirm(t('s_reset_confirm'))) return;
    if (S.connected) await bg({ type: 'disconnect' });
    await chrome.storage.local.clear();
    location.reload();
  };
  $('#dlSetup').onclick = async () => { try { await downloadInstaller(); } catch (e) { toast(e.message, 'err'); addLog('error', 'Could not create the setup file: ' + e.message); } };
  $('#dlShow').onclick = () => { if (lastDownloadId != null) chrome.downloads.show(lastDownloadId); };
  $('#setupCheck').onclick = runBoot;
  $('#bootRetry').onclick = runBoot;
  $('#bootCopy').onclick = async () => { await copyText(diagnostics()); toast(t('logs_copied'), 'ok'); };
  $('#readyGo').onclick = showMain;
  $('#logToggle').onclick = () => toggleLogs();
  $('#logCopy').onclick = async (e) => { e.stopPropagation(); await copyText(diagnostics()); toast(t('logs_copied'), 'ok'); };
  $('#logClear').onclick = async (e) => { e.stopPropagation(); await setState({ logs: [] }); };
  $('#logCore').onclick = async (e) => { e.stopPropagation(); await loadCoreLog(); toggleLogs(true); };
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !S) return;
    for (const k in ch) S[k] = ch[k].newValue === undefined ? DEFAULTS[k] : ch[k].newValue;
    scheduleRender();
  });
  setInterval(() => { if (S) renderUptime(); }, 1000);
}

async function silentCheck() {
  try {
    const r = await nativeCall({ action: 'hello' }, { timeoutMs: 8000 });
    if (!r.ok || versionLess(r.hostVersion, HOST_MIN)) return showSetup('outdated');
    if (r.hostVersion !== S.hostVersion) setState({ hostVersion: r.hostVersion });
  } catch (e) {
    addLog('warn', `Helper not reachable [${e.code}]: ${e.message}`);
    return showSetup(e.code);
  }
  if (S.connected) await bg({ type: 'health' });
}

async function init() {
  S = await getState();
  LANG = S.lang || 'fa';
  drawLogo($('#logo').getContext('2d'), 88);
  bind();
  applyLang();
  fillSettings();
  const fresh = S.setupDone && Date.now() - S.coreCheckedAt < 12 * 3600 * 1000;
  if (fresh) { showMain(); silentCheck(); } else runBoot();
}

init();
