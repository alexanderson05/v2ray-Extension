const $ = id => document.getElementById(id);
const send = msg => new Promise(r => chrome.runtime.sendMessage(msg, r));
const getState = () => chrome.storage.local.get({
  servers: [], subs: [], activeId: null, connected: false,
});

async function render() {
  const s = await getState();
  $('toggle').classList.toggle('on', s.connected);
  $('status').textContent = s.connected ? 'متصل' : 'قطع';

  const act = s.servers.find(x => x.id === s.activeId);
  $('active').textContent = act ? `${act.name} (${act.protocol})` : 'سروری انتخاب نشده';

  $('list').innerHTML = '';
  for (const srv of s.servers) {
    const li = document.createElement('li');
    if (srv.id === s.activeId) li.classList.add('active');
    const label = document.createElement('span');
    label.textContent = `${srv.name} · ${srv.protocol}`;
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.onclick = e => { e.stopPropagation(); removeServer(srv.id); };
    li.append(label, del);
    li.onclick = () => choose(srv.id);
    $('list').appendChild(li);
  }

  $('subs').innerHTML = '';
  for (const sb of s.subs) {
    const li = document.createElement('li');
    li.textContent = sb.url;
    $('subs').appendChild(li);
  }
}

async function choose(id) {
  await chrome.storage.local.set({ activeId: id });
  const s = await getState();
  if (s.connected) {
    const r = await send({ type: 'connect', id });
    if (!r.ok) alert('خطا: ' + r.error);
  }
  render();
}

async function removeServer(id) {
  const s = await getState();
  await chrome.storage.local.set({
    servers: s.servers.filter(x => x.id !== id),
    activeId: s.activeId === id ? null : s.activeId,
  });
  render();
}

$('toggle').onclick = async () => {
  const s = await getState();
  if (s.connected) {
    await send({ type: 'disconnect' });
  } else {
    if (!s.activeId) return alert('اول یک سرور انتخاب کن');
    const r = await send({ type: 'connect', id: s.activeId });
    if (!r.ok) alert('خطا: ' + r.error);
  }
  render();
};

$('addBtn').onclick = async () => {
  const s = await getState();
  let added = 0;
  for (const line of $('links').value.split('\n')) {
    try {
      const p = parseLink(line);
      if (p) { p.source = 'manual'; s.servers.push(p); added++; }
    } catch { /* خط نامعتبر را نادیده می‌گیریم */ }
  }
  await chrome.storage.local.set({ servers: s.servers });
  $('links').value = '';
  if (!added) alert('هیچ لینک معتبری پیدا نشد');
  render();
};

$('addSub').onclick = async () => {
  const url = $('subUrl').value.trim();
  if (!url) return;
  const s = await getState();
  s.subs.push({ url });
  await chrome.storage.local.set({ subs: s.subs });
  $('subUrl').value = '';
  const r = await send({ type: 'updateSubs' });
  if (!r.ok) alert('خطا: ' + r.error);
  render();
};

$('updSub').onclick = async () => {
  const r = await send({ type: 'updateSubs' });
  alert(r.ok ? `${r.count} سرور بروزرسانی شد` : 'خطا: ' + r.error);
  render();
};

render();
