// V2 Client - link & subscription parser (vmess / vless / trojan / ss).
// Designed by Alex Anderson.

function b64decode(s) {
  s = s.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };

function finalize(o, raw) {
  o.raw = raw;
  o.id = hash53(raw);
  o.name = (o.name || '').trim() || o.server;
  return o;
}

function splitHostPort(hp) {
  const m = hp.match(/^\[?([^\]]+?)\]?:(\d+)$/);
  if (!m) throw new Error('invalid host:port');
  return [m[1], +m[2]];
}

function parseVmess(link) {
  const j = JSON.parse(b64decode(link.slice(8).split('#')[0]));
  if (!j.add || !j.id) throw new Error('invalid vmess');
  const net = (j.net || 'tcp').toLowerCase();
  return finalize({
    protocol: 'vmess', name: j.ps, server: j.add, port: +j.port || 443, uuid: j.id,
    aid: +(j.aid || 0), cipher: j.scy || 'auto', net, headerType: j.type || '',
    security: j.tls === 'tls' ? 'tls' : 'none', sni: j.sni || j.host || '',
    host: j.host || '', path: j.path || '', alpn: j.alpn || '', fp: j.fp || '',
    allowInsecure: j.allowInsecure == 1 || j.allowInsecure === true,
    serviceName: net === 'grpc' ? (j.path || '') : '', mode: j.mode || '',
  }, link);
}

function parseUrlLink(link, proto) {
  const u = new URL(link);
  const q = Object.fromEntries(u.searchParams);
  const o = {
    protocol: proto, name: safeDecode(u.hash.slice(1)),
    server: u.hostname.replace(/^\[|\]$/g, ''), port: +u.port || 443,
    net: (q.type || 'tcp').toLowerCase(), security: (q.security || 'none').toLowerCase(),
    sni: q.sni || q.peer || '', host: q.host || '', path: q.path || '',
    alpn: q.alpn || '', fp: q.fp || '', pbk: q.pbk || '', sid: q.sid || '', spx: q.spx || '',
    flow: q.flow || '', encryption: q.encryption || 'none', headerType: q.headerType || '',
    serviceName: q.serviceName || q.path || '', mode: q.mode || '',
    allowInsecure: q.allowInsecure === '1' || q.allowInsecure === 'true' || q.insecure === '1',
  };
  const user = safeDecode(u.username);
  if (proto === 'vless') o.uuid = user; else o.password = user;
  if (!o.server || !(o.uuid || o.password)) throw new Error('invalid link');
  return finalize(o, link);
}

function parseSS(link) {
  let body = link.slice(5), name = '';
  const hi = body.indexOf('#');
  if (hi >= 0) { name = safeDecode(body.slice(hi + 1)); body = body.slice(0, hi); }
  body = body.split('?')[0].replace(/\/$/, '');
  let userinfo, hostport;
  if (body.includes('@')) {
    const at = body.lastIndexOf('@');
    userinfo = body.slice(0, at); hostport = body.slice(at + 1);
    userinfo = userinfo.includes(':') ? safeDecode(userinfo) : b64decode(safeDecode(userinfo));
  } else {
    const d = b64decode(body), at = d.lastIndexOf('@');
    userinfo = d.slice(0, at); hostport = d.slice(at + 1);
  }
  const ci = userinfo.indexOf(':');
  const [server, port] = splitHostPort(hostport);
  return finalize({
    protocol: 'ss', name, server, port, method: userinfo.slice(0, ci), password: userinfo.slice(ci + 1),
    net: 'tcp', security: 'none',
  }, link);
}

// Returns a server object, null for blank/comment lines, throws for bad or unsupported links.
function parseLink(link) {
  link = (link || '').trim();
  if (!link || link.startsWith('#')) return null;
  const m = link.match(/^([a-z0-9]+):\/\//i);
  if (!m) return null;
  const sc = m[1].toLowerCase();
  if (sc === 'vmess') return parseVmess(link);
  if (sc === 'vless' || sc === 'trojan') return parseUrlLink(link, sc);
  if (sc === 'ss') return parseSS(link);
  throw new Error('unsupported:' + sc);
}

// Accepts plain link lists or Base64 subscription bodies.
function parseSubscription(text) {
  let body = (text || '').trim();
  if (/^\s*(proxies|proxy-groups|mixed-port|port):/m.test(body)) return { servers: [], skipped: {}, format: 'clash' };
  if (!/:\/\//.test(body)) { try { body = b64decode(body); } catch (e) { /* plain text */ } }
  const servers = [], skipped = {}, seen = new Set();
  for (const line of body.split(/\r?\n/)) {
    try {
      const p = parseLink(line);
      if (p && !seen.has(p.id)) { seen.add(p.id); servers.push(p); }
    } catch (e) {
      const m = /^unsupported:(.+)$/.exec(e.message);
      const k = m ? m[1] : 'invalid';
      skipped[k] = (skipped[k] || 0) + 1;
    }
  }
  return { servers, skipped, format: 'links' };
}

// "upload=1; download=2; total=3; expire=1700000000" -> numbers
function parseUserInfo(h) {
  if (!h) return null;
  const o = {};
  for (const part of h.split(';')) {
    const [k, v] = part.split('=').map((x) => (x || '').trim());
    if (k && v !== undefined && !isNaN(+v)) o[k] = +v;
  }
  return Object.keys(o).length ? o : null;
}

function decodeProfileTitle(h) {
  if (!h) return '';
  try {
    if (h.startsWith('base64:')) return b64decode(h.slice(7));
    return safeDecode(h);
  } catch (e) { return ''; }
}

// Turn a server object back into its share link (the raw link it was imported from).
const serverLink = (s) => s.raw;
