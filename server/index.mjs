import http from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLocationStore } from './location-store.mjs';

const dataFile = process.env.DATA_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data.json');
const locationFile = process.env.LOCATION_DB_FILE || `${dataFile}.locations.sqlite`;
const port = Number(process.env.PORT || 8787);
const origins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',');
const allowedKinds = new Set(['chat', 'pulse', 'location']);
const maxBody = 16_000;

let db = { users: [], sessions: [], requests: [], contacts: [], envelopes: [], alerts: [] };
try { db = JSON.parse(await readFile(dataFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const locations = createLocationStore(locationFile);
const viewers = new Map();
let saveChain = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(db);
  saveChain = saveChain.then(async () => {
    await writeFile(`${dataFile}.tmp`, snapshot, { mode: 0o600 });
    await rename(`${dataFile}.tmp`, dataFile);
  });
  return saveChain;
}
const oldLocations = db.envelopes.filter(item => item.kind === 'location');
if (oldLocations.length) {
  for (const item of oldLocations) locations.add({ ...item, mode: 'scheduled', intervalMs: 30_000 });
  db.envelopes = db.envelopes.filter(item => item.kind !== 'location');
  await save();
}
function pushLocation(recipientId, event, data) {
  for (const viewer of viewers.get(recipientId) || []) {
    try { auth(viewer.req); viewer.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
    catch { viewer.res.end(); }
  }
}
const hash = value => createHash('sha256').update(value).digest('hex');
const publicUser = user => ({ id: user.id, handle: user.handle, name: user.name, publicKey: user.publicKey });
const pairKey = (a, b) => [a, b].sort().join(':');
const isContact = (a, b) => db.contacts.some(x => x.key === pairKey(a, b));
const maySeeLocation = (from, to) => isContact(from, to) && db.users.find(x => x.id === from)?.locationShare?.ids.includes(to);
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const text = (value, max = 100) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const b64 = (value, max = 12000) => typeof value === 'string' && value.length > 0 && value.length <= max && /^[A-Za-z0-9+/]+=*$/.test(value);
async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > maxBody) fail(413, 'Requête trop volumineuse.'); }
  try { return raw ? JSON.parse(raw) : {}; } catch { fail(400, 'JSON invalide.'); }
}
function auth(req) {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
  const session = token && db.sessions.find(x => x.hash === hash(token) && x.expires > Date.now());
  const user = session && db.users.find(x => x.id === session.userId);
  if (!user) fail(401, 'Session expirée.');
  return user;
}
const findUser = id => db.users.find(x => x.id === id);

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method;
  if (method === 'GET' && p === '/api/health') return json(res, 200, { ok: true });
  if (method === 'POST' && p === '/api/auth/register') {
    const b = await body(req);
    const handle = String(b.handle || '').toLowerCase().trim();
    if (!/^[a-z0-9_]{3,20}$/.test(handle) || !text(b.name, 40) || !text(b.password, 200) || b.password.length < 10 || !b64(b.publicKey, 80) || Buffer.from(b.publicKey, 'base64').length !== 32) fail(400, 'Nom, identifiant, mot de passe ou clé invalides.');
    if (db.users.some(x => x.handle === handle)) fail(409, 'Cet identifiant est déjà pris.');
    const salt = randomBytes(16).toString('hex');
    const user = { id: randomUUID(), handle, name: b.name.trim(), publicKey: b.publicKey, salt, passwordHash: scryptSync(b.password, salt, 64).toString('hex'), checkinAt: Date.now(), safety: { enabled: false, intervalHours: 24, contactIds: [] }, lastAlertAt: 0 };
    db.users.push(user);
    const token = randomBytes(32).toString('hex');
    db.sessions.push({ hash: hash(token), userId: user.id, expires: Date.now() + 30 * 864e5 });
    await save(); return json(res, 201, { token, user: publicUser(user) });
  }
  if (method === 'POST' && p === '/api/auth/login') {
    const b = await body(req);
    const user = db.users.find(x => x.handle === String(b.handle || '').toLowerCase().trim());
    if (!user || typeof b.password !== 'string') fail(401, 'Identifiants invalides.');
    const actual = scryptSync(b.password, user.salt, 64);
    if (!timingSafeEqual(actual, Buffer.from(user.passwordHash, 'hex'))) fail(401, 'Identifiants invalides.');
    const token = randomBytes(32).toString('hex');
    db.sessions.push({ hash: hash(token), userId: user.id, expires: Date.now() + 30 * 864e5 });
    await save(); return json(res, 200, { token, user: publicUser(user) });
  }
  const user = auth(req);
  if (method === 'GET' && p === '/api/me') return json(res, 200, { user: publicUser(user), checkinAt: user.checkinAt, safety: user.safety });
  if (method === 'POST' && p === '/api/auth/logout') {
    db.sessions = db.sessions.filter(x => !(x.userId === user.id && x.hash === hash((req.headers.authorization || '').slice(7))));
    await save(); return json(res, 200, { ok: true });
  }
  if (method === 'GET' && p.startsWith('/api/users/')) {
    const target = db.users.find(x => x.handle === decodeURIComponent(p.slice(11)).toLowerCase());
    if (!target) fail(404, 'Aucun compte trouvé.');
    return json(res, 200, { user: publicUser(target) });
  }
  if (method === 'GET' && p === '/api/contacts') {
    return json(res, 200, { contacts: db.contacts.filter(x => x.a === user.id || x.b === user.id).map(x => publicUser(findUser(x.a === user.id ? x.b : x.a))) });
  }
  if (method === 'DELETE' && p.startsWith('/api/contacts/')) {
    const target = p.slice(14);
    db.contacts = db.contacts.filter(x => x.key !== pairKey(user.id, target));
    locations.deletePair(user.id, target);
    if (user.locationShare) user.locationShare.ids = user.locationShare.ids.filter(id => id !== target);
    const other = findUser(target);
    if (other?.locationShare) other.locationShare.ids = other.locationShare.ids.filter(id => id !== user.id);
    pushLocation(target, 'revoke', { from: user.id });
    pushLocation(user.id, 'revoke', { from: target });
    user.safety.contactIds = user.safety.contactIds.filter(x => x !== target);
    await save(); return json(res, 200, { ok: true });
  }
  if (method === 'GET' && p === '/api/requests') {
    return json(res, 200, { incoming: db.requests.filter(x => x.to === user.id).map(x => ({ id: x.id, from: publicUser(findUser(x.from)) })), outgoing: db.requests.filter(x => x.from === user.id).map(x => ({ id: x.id, to: publicUser(findUser(x.to)) })) });
  }
  if (method === 'POST' && p === '/api/requests') {
    const b = await body(req);
    const target = db.users.find(x => x.handle === String(b.handle || '').toLowerCase().trim());
    if (!target || target.id === user.id) fail(400, 'Contact introuvable.');
    if (isContact(user.id, target.id)) fail(409, 'Déjà dans vos contacts.');
    if (db.requests.some(x => pairKey(x.from, x.to) === pairKey(user.id, target.id))) fail(409, 'Invitation déjà envoyée.');
    db.requests.push({ id: randomUUID(), from: user.id, to: target.id, at: Date.now() });
    await save(); return json(res, 201, { ok: true });
  }
  const action = /^\/api\/requests\/([^/]+)\/(accept|decline)$/.exec(p);
  if (method === 'POST' && action) {
    const invite = db.requests.find(x => x.id === action[1] && x.to === user.id);
    if (!invite) fail(404, 'Invitation introuvable.');
    db.requests = db.requests.filter(x => x.id !== invite.id);
    if (action[2] === 'accept') db.contacts.push({ key: pairKey(invite.from, invite.to), a: invite.from, b: invite.to, at: Date.now() });
    await save(); return json(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/location/start') {
    const b = await body(req);
    const ids = [...new Set(Array.isArray(b.ids) ? b.ids : [])];
    if (typeof b.shareId !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.shareId) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !isContact(user.id, id))) fail(400, 'Partage de position invalide.');
    for (const recipientId of locations.recipientsOf(user.id)) if (!ids.includes(recipientId)) {
      locations.deleteRecipient(user.id, recipientId);
      pushLocation(recipientId, 'revoke', { from: user.id });
    }
    user.locationShare = { id: b.shareId, ids, at: Date.now() };
    await save(); return json(res, 200, { ok: true });
  }
  if (method === 'POST' && p === '/api/envelopes') {
    const b = await body(req);
    if (!isContact(user.id, b.toId)) fail(403, 'Contact non approuvé.');
    if (!allowedKinds.has(b.kind) || !b64(b.nonce, 80) || Buffer.from(b.nonce, 'base64').length !== 24 || !b64(b.ciphertext) || Buffer.from(b.ciphertext, 'base64').length < 16) fail(400, 'Message chiffré invalide.');
    const mode = b.kind === 'location' ? (b.mode ?? 'scheduled') : null;
    const intervalMs = b.kind === 'location' ? (b.intervalMs ?? 30_000) : 0;
    if (b.kind === 'location' && (!['continuous', 'on-open', 'scheduled'].includes(mode) || !Number.isInteger(intervalMs) || intervalMs < 15_000 || intervalMs > 12 * 60 * 60_000)) fail(400, 'Mode ou intervalle de position invalide.');
    if (b.kind === 'location' && (user.locationShare?.id !== b.shareId || !user.locationShare.ids.includes(b.toId))) fail(403, 'Partage de position inactif.');
    const now = Date.now();
    const locationLifetime = mode === 'on-open' ? 24 * 60 * 60_000 : mode === 'continuous' ? 15 * 60_000 : Math.max(10 * 60_000, intervalMs + 5 * 60_000);
    if (b.kind === 'location') {
      const item = { id: randomUUID(), from: user.id, to: b.toId, kind: 'location', nonce: b.nonce, ciphertext: b.ciphertext, mode, intervalMs, at: now, expires: now + locationLifetime };
      locations.add(item);
      pushLocation(b.toId, 'location', item);
      return json(res, 201, { ok: true });
    }
    db.envelopes.push({ id: randomUUID(), from: user.id, to: b.toId, kind: b.kind, nonce: b.nonce, ciphertext: b.ciphertext, at: now, expires: now + 30 * 864e5 });
    await save(); return json(res, 201, { ok: true });
  }
  if (method === 'POST' && p === '/api/location/revoke') {
    const recipients = locations.recipientsOf(user.id);
    user.locationShare = null;
    locations.deleteSender(user.id);
    for (const id of recipients) pushLocation(id, 'revoke', { from: user.id });
    await save();
    return json(res, 200, { ok: true });
  }
  if (method === 'GET' && p === '/api/location/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let subscribers = viewers.get(user.id);
    if (!subscribers) { subscribers = new Set(); viewers.set(user.id, subscribers); }
    const viewer = { req, res };
    subscribers.add(viewer);
    res.write(`event: snapshot\ndata: ${JSON.stringify(locations.latestFor(user.id, Date.now(), maySeeLocation))}\n\n`);
    const keepalive = setInterval(() => { try { auth(req); if (!res.destroyed) res.write(': keepalive\n\n'); } catch { res.end(); } }, 25_000);
    req.on('close', () => {
      clearInterval(keepalive);
      subscribers.delete(viewer);
      if (!subscribers.size) viewers.delete(user.id);
    });
    return;
  }
  if (method === 'GET' && p === '/api/envelopes') {
    const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
    const now = Date.now();
    const envelopes = db.envelopes.filter(x => x.kind !== 'location' && (x.from === user.id || x.to === user.id) && x.at > after && x.expires > now && isContact(x.from, x.to));
    return json(res, 200, { envelopes });
  }
  if (method === 'POST' && p === '/api/checkin') {
    user.checkinAt = Date.now(); user.lastAlertAt = 0;
    await save(); return json(res, 200, { checkinAt: user.checkinAt });
  }
  if (method === 'POST' && p === '/api/safety') {
    const b = await body(req);
    const ids = [...new Set(Array.isArray(b.contactIds) ? b.contactIds : [])];
    if (ids.length > 8 || ids.some(x => !isContact(user.id, x)) || ![12, 24, 48].includes(b.intervalHours) || typeof b.enabled !== 'boolean') fail(400, 'Configuration invalide.');
    user.safety = { enabled: b.enabled && ids.length > 0, intervalHours: b.intervalHours, contactIds: ids };
    user.checkinAt = Date.now(); user.lastAlertAt = 0;
    await save(); return json(res, 200, { safety: user.safety, checkinAt: user.checkinAt });
  }
  if (method === 'GET' && p === '/api/alerts') {
    return json(res, 200, { alerts: db.alerts.filter(x => x.to === user.id && isContact(x.from, x.to)).map(x => ({ ...x, fromUser: publicUser(findUser(x.from)) })) });
  }
  if (method === 'POST' && p.startsWith('/api/alerts/') && p.endsWith('/read')) {
    const alert = db.alerts.find(x => x.id === p.slice(12, -5) && x.to === user.id);
    if (!alert) fail(404, 'Alerte introuvable.');
    alert.read = true; await save(); return json(res, 200, { ok: true });
  }
  fail(404, 'Route introuvable.');
}

export async function sweep(now = Date.now()) {
  let changed = false;
  for (const user of db.users) {
    const due = user.checkinAt + user.safety.intervalHours * 36e5 + 2 * 36e5;
    if (user.safety.enabled && now > due && user.lastAlertAt < user.checkinAt) {
      for (const to of user.safety.contactIds.filter(id => isContact(user.id, id))) db.alerts.push({ id: randomUUID(), from: user.id, to, at: now, type: 'missed_checkin', read: false });
      user.lastAlertAt = now; changed = true;
    }
  }
  const n = db.envelopes.length;
  db.envelopes = db.envelopes.filter(x => x.expires > now);
  if (db.envelopes.length !== n) changed = true;
  locations.prune(now);
  if (changed) await save();
}
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && (origins.includes(origin) || origin === 'capacitor://localhost' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try { await route(req, res); } catch (error) { json(res, error.status || 500, { error: error.status ? error.message : 'Erreur du serveur.' }); if (!error.status) console.error(error); }
});
if (process.env.NODE_ENV !== 'test') {
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Halo API : http://${host}:${port}`));
  setInterval(() => sweep().catch(console.error), 60_000).unref();
}
export { server, locations };
