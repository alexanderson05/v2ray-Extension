function b64decode(s) {
  s = s.trim().replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// یک لینک را به یک آبجکت سرور نرمال تبدیل می‌کند. ورودی نامعتبر خطا می‌دهد.
function parseLink(link) {
  link = link.trim();
  if (!link) return null;

  if (link.startsWith('vmess://')) {
    const j = JSON.parse(b64decode(link.slice(8)));
    return {
      id: link, protocol: 'vmess', name: j.ps || j.add,
      server: j.add, port: +j.port, id_: j.id, aid: +(j.aid || 0),
      net: j.net || 'tcp', security: j.tls === 'tls' ? 'tls' : 'none',
      sni: j.sni || j.host || '', host: j.host || '', path: j.path || '',
      raw: link,
    };
  }

  const u = new URL(link);
  const proto = u.protocol.replace(':', '');
  const q = Object.fromEntries(u.searchParams);
  const base = {
    id: link, protocol: proto,
    name: decodeURIComponent(u.hash.slice(1)) || u.hostname,
    server: u.hostname, port: +u.port,
    net: q.type || 'tcp', security: q.security || 'none',
    sni: q.sni || '', host: q.host || '', path: q.path || '',
    fp: q.fp || '', pbk: q.pbk || '', sid: q.sid || '', flow: q.flow || '',
    raw: link,
  };

  if (proto === 'vless') return { ...base, uuid: decodeURIComponent(u.username) };
  if (proto === 'trojan') return { ...base, password: decodeURIComponent(u.username) };
  return null; // ss و بقیه را می‌توان بعداً اضافه کرد
}

// هم لینک تکی، هم متن Base64 اشتراک را پشتیبانی می‌کند
function parseSubscription(text) {
  let body = text.trim();
  if (!/:\/\//.test(body)) {
    try { body = b64decode(body); } catch { /* متن ساده است */ }
  }
  return body.split(/\r?\n/)
    .map(l => { try { return parseLink(l); } catch { return null; } })
    .filter(Boolean);
}
