// Shared by the eventual Android and iOS TDLib adapters. No Telegram messages
// are sent: getInlineQueryResults only asks the bot for an inline result.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const intervalSeconds = new Set([0, 15, 30, 60, 300, 600, 1800, 2700, 3600, 7200, 10800, 21600, 43200]);

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid key or ciphertext.');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function assertId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid Telegram account ID.');
  return value;
}

function command(...parts) {
  const value = `H1:${parts.join(':')}`;
  if (value.length > 256) throw new Error('Telegram inline query is too long.');
  return value;
}

export const invite = id => command('i', assertId(id));
export const accept = id => command('a', assertId(id));
export const allow = id => command('v', assertId(id));
export const revoke = id => command('r', assertId(id));
export const disconnect = id => command('d', assertId(id));
export const getPosition = id => command('g', assertId(id), base64url(crypto.getRandomValues(new Uint8Array(12))));

export function newLocationKey() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function newSharingSession(now = Date.now()) {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid session time.');
  return { epoch: base64url(crypto.getRandomValues(new Uint8Array(16))), generation: now, sequence: 0 };
}

export async function encryptPosition(key, latitude, longitude, at = Date.now()) {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isSafeInteger(at)) {
    throw new Error('Invalid position.');
  }
  const rawKey = fromBase64url(key);
  if (rawKey.length !== 32) throw new Error('Invalid location key.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const secret = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const point = [Math.round(latitude * 1e6) / 1e6, Math.round(longitude * 1e6) / 1e6, at];
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, secret, encoder.encode(JSON.stringify(point))));
  return base64url(new Uint8Array([...iv, ...data]));
}

export async function decryptPosition(key, ciphertext) {
  const rawKey = fromBase64url(key);
  const data = fromBase64url(ciphertext);
  if (rawKey.length !== 32 || data.length < 29) throw new Error('Invalid encrypted position.');
  const secret = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, secret, data.slice(12));
  const [latitude, longitude, at] = JSON.parse(decoder.decode(plain));
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isSafeInteger(at)) throw new Error('Invalid decrypted position.');
  return { latitude, longitude, at };
}

export function startPosition(session, interval, ciphertext) {
  if (!intervalSeconds.has(interval)) throw new Error('Invalid sharing interval.');
  session.sequence += 1;
  return command('s', session.epoch, session.generation, session.sequence, interval, ciphertext);
}

export function updatePosition(session, ciphertext) {
  session.sequence += 1;
  return command('u', session.epoch, session.sequence, ciphertext);
}

export function stopPosition(session) {
  session.sequence += 1;
  return command('x', session.epoch, session.sequence);
}

export function parseAnswer(value) {
  if (typeof value !== 'string' || value.length > 512) throw new Error('Invalid bot response.');
  const parts = value.split(':');
  if (parts[0] !== 'H1') throw new Error('Unexpected bot response.');
  if (parts[1] === 'ok' && parts.length === 3) return { kind: 'ok', code: parts[2] };
  if (parts[1] === 'err' && parts.length === 3) return { kind: 'error', code: parts[2] };
  if (parts[1] === 'pos' && parts.length === 7 && /^[1-9][0-9]*$/.test(parts[2]) && /^[1-9][0-9]*$/.test(parts[4]) && /^[1-9][0-9]*$/.test(parts[5]) && /^[A-Za-z0-9_-]+$/.test(parts[6])) {
    return { kind: 'position', ownerId: Number(parts[2]), epoch: parts[3], sequence: Number(parts[4]), updatedAt: Number(parts[5]), ciphertext: parts[6] };
  }
  throw new Error('Malformed bot response.');
}

export async function sendInlineCommand(tdlib, botUserId, chatId, query) {
  const answer = await tdlib.send({
    '@type': 'getInlineQueryResults', bot_user_id: assertId(botUserId), chat_id: assertId(chatId),
    user_location: null, query, offset: '',
  });
  const article = answer?.results?.[0];
  if (article?.['@type'] !== 'inlineQueryResultArticle' || typeof article.description !== 'string') throw new Error('Halo bot returned no usable result.');
  return parseAnswer(article.description);
}

export async function getSelfChatId(tdlib) {
  const self = await tdlib.send({ '@type': 'getMe' });
  const chat = await tdlib.send({ '@type': 'createPrivateChat', user_id: assertId(self?.id), force: false });
  return assertId(chat?.id);
}

export async function readLatestPosition(tdlib, botUserId, chatId, ownerId, keyForEpoch) {
  const response = await sendInlineCommand(tdlib, botUserId, chatId, getPosition(ownerId));
  if (response.kind === 'error' && response.code === 'unavailable') return null;
  if (response.kind !== 'position' || response.ownerId !== ownerId) throw new Error('Halo bot did not return the requested position.');
  const key = await keyForEpoch(ownerId, response.epoch);
  if (!key) throw new Error('No Secret Chat location key for this sharing session.');
  return { ...await decryptPosition(key, response.ciphertext), updatedAt: response.updatedAt };
}

export const bipperPresets = ['Je vais bien.', 'Je suis bien arrivé.', 'Je pense à toi.', 'Tu me manques.', 'Tout va bien.', 'Je suis en sécurité.'];
