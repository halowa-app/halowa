import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';

export type Person = { id: string; handle: string; name: string; publicKey: string };
export type Envelope = { id: string; from: string; to: string; kind: 'chat' | 'pulse' | 'location'; nonce: string; ciphertext: string; at: number; expires: number };
export type AlertItem = { id: string; from: string; fromUser: Person; to: string; at: number; type: 'missed_checkin'; read: boolean };
export type Safety = { enabled: boolean; intervalHours: 12 | 24 | 48; contactIds: string[] };
export type Session = { token: string; user: Person; secretKey: string };
export type ShareMode = 'continuous' | 'on-open' | 'scheduled';
export type ShareSession = { userId: string; shareId: string; ids: string[]; mode: ShareMode; intervalMs: number };

const storageKey = 'halo.session';
export const isNative = Capacitor.isNativePlatform();
export async function saveSession(session: Session | null) {
  if (session) await SecureStorage.set(storageKey, session);
  else await SecureStorage.remove(storageKey);
}
export async function loadSession(): Promise<Session | null> {
  try { return await SecureStorage.get(storageKey) as Session | null; } catch { return null; }
}
export async function saveIdentity(handle: string, secretKey: string) { await SecureStorage.set(`halo.key.${handle}`, secretKey); }
export async function loadIdentity(handle: string): Promise<string | null> {
  try { return await SecureStorage.get(`halo.key.${handle}`) as string | null; } catch { return null; }
}
export async function saveShareSession(share: ShareSession | null) {
  if (share) await SecureStorage.set('halo.sharing', share);
  else await SecureStorage.remove('halo.sharing');
}
export async function loadShareSession(): Promise<ShareSession | null> {
  try { return await SecureStorage.get('halo.sharing') as ShareSession | null; } catch { return null; }
}
export async function savePendingLocationRevoke(userId: string | null) {
  if (userId) await SecureStorage.set('halo.locationRevokePending', userId);
  else await SecureStorage.remove('halo.locationRevokePending');
}
export async function loadPendingLocationRevoke(): Promise<string | null> {
  try { return await SecureStorage.get('halo.locationRevokePending') as string | null; } catch { return null; }
}
export function makeKeys() {
  const pair = nacl.box.keyPair();
  return { publicKey: util.encodeBase64(pair.publicKey), secretKey: util.encodeBase64(pair.secretKey) };
}
export function seal(payload: object, recipientPublicKey: string, secretKey: string) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const bytes = util.decodeUTF8(JSON.stringify(payload));
  const cipher = nacl.box(bytes, nonce, util.decodeBase64(recipientPublicKey), util.decodeBase64(secretKey));
  return { nonce: util.encodeBase64(nonce), ciphertext: util.encodeBase64(cipher) };
}
export function open(envelope: Envelope, senderPublicKey: string, secretKey: string): unknown {
  try {
    const bytes = nacl.box.open(util.decodeBase64(envelope.ciphertext), util.decodeBase64(envelope.nonce), util.decodeBase64(senderPublicKey), util.decodeBase64(secretKey));
    return bytes ? JSON.parse(util.encodeUTF8(bytes)) : null;
  } catch { return null; }
}
export function fingerprint(publicKey: string) {
  const hash = nacl.hash(util.decodeBase64(publicKey));
  return Array.from(hash.slice(0, 8), x => x.toString(16).padStart(2, '0')).join(' ').toUpperCase();
}

let customApi = localStorage.getItem('halo.api') || '';
export function setApiUrl(url: string) { customApi = url.replace(/\/+$/, ''); localStorage.setItem('halo.api', customApi); }
export function getApiUrl() { return customApi || import.meta.env.VITE_API_URL || ''; }
export async function api<T>(path: string, method = 'GET', data?: unknown, token?: string): Promise<T> {
  const base = getApiUrl();
  if (isNative && !base) throw new Error('Renseignez l’URL HTTPS du serveur dans les réglages.');
  if (isNative && !base.startsWith('https://')) throw new Error('Utilisez une adresse HTTPS pour le serveur Halo.');
  const url = `${base}/api${path}`;
  const headers = { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (isNative) {
    let response;
    try { response = await CapacitorHttp.request({ url, method, headers, ...(data ? { data } : {}) }); }
    catch { throw new Error('Serveur inaccessible. Vérifiez son adresse et votre connexion.'); }
    const result = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    if (response.status < 200 || response.status >= 300) throw new Error(result?.error || 'Une erreur est survenue.');
    return result as T;
  }
  let response: Response;
  try {
    response = await fetch(url, { method, headers, body: data ? JSON.stringify(data) : undefined });
  } catch { throw new Error('Serveur inaccessible. Vérifiez son adresse et votre connexion.'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Une erreur est survenue.');
  return result as T;
}
