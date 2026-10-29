import test from 'node:test';
import assert from 'node:assert/strict';
import { processQuery } from '../tgcloud/lib/core.js';
import { parseCommand } from '../tgcloud/lib/protocol.js';
import { accept, allow, decryptPosition, encryptPosition, getPosition, getSelfChatId, invite, newLocationKey, newSharingSession, parseAnswer, readLatestPosition, revoke, sendInlineCommand, startPosition, stopPosition, updatePosition } from '../client/protocol.mjs';
import { receiveLocationKey, sendBipper, sendSecretText, shareLocationKey } from '../client/secretChats.mjs';
import { SharingController } from '../client/sharing.mjs';

function makeStore() {
  const contacts = new Map();
  const permissions = new Set();
  const positions = new Map();
  const pair = (a, b) => [a, b].sort((x, y) => x - y).join(':');
  return {
    positions,
    async invite(a, b) { const id = pair(a, b); if (contacts.has(id)) return false; contacts.set(id, { requester: a, invitee: b, approved: false }); return true; },
    async accept(a, b) { const contact = contacts.get(pair(a, b)); if (!contact || contact.requester !== b || contact.invitee !== a) return false; contact.approved = true; return true; },
    async isApproved(a, b) { return contacts.get(pair(a, b))?.approved === true; },
    async allow(a, b) { permissions.add(`${a}:${b}`); },
    async revoke(a, b) { permissions.delete(`${a}:${b}`); },
    async disconnect(a, b) { contacts.delete(pair(a, b)); permissions.delete(`${a}:${b}`); permissions.delete(`${b}:${a}`); },
    async canRead(a, b) { return permissions.has(`${a}:${b}`); },
    async start(a, c, now) { const previous = positions.get(a); if (Math.abs(c.generation - now) > 300_000 || previous && previous.generation >= c.generation) return false; positions.set(a, { ownerId: a, ...c, active: true, updatedAt: now }); return true; },
    async update(a, c, now) { const previous = positions.get(a); if (!previous?.active || previous.epoch !== c.epoch || previous.sequence >= c.sequence) return false; positions.set(a, { ...previous, ciphertext: c.ciphertext, sequence: c.sequence, updatedAt: now }); return true; },
    async stop(a, c, now) { const previous = positions.get(a); if (!previous || previous.epoch !== c.epoch) return false; if (previous.active && previous.sequence < c.sequence) positions.set(a, { ...previous, ciphertext: null, sequence: c.sequence, active: false, updatedAt: now }); else if (previous.active || previous.sequence !== c.sequence) return false; for (const id of permissions) if (id.startsWith(`${a}:`)) permissions.delete(id); return true; },
    async read(a) { return positions.get(a); },
  };
}

test('only an approved and explicitly allowed contact can read the latest encrypted point', async () => {
  const now = Date.now();
  const store = makeStore();
  const key = newLocationKey();
  const session = newSharingSession(now);
  const first = await encryptPosition(key, 48.8566, 2.3522, now);
  const second = await encryptPosition(key, 48.857, 2.353, now + 15_000);
  assert.equal(await processQuery(invite(2), 1, store, now), 'H1:ok:invited');
  assert.equal(await processQuery(allow(2), 1, store, now), 'H1:err:not_approved');
  assert.equal(await processQuery(accept(1), 2, store, now), 'H1:ok:approved');
  assert.equal(await processQuery(startPosition(session, 15, first), 1, store, now), 'H1:ok:started');
  assert.equal(await processQuery(getPosition(1), 2, store, now), 'H1:err:forbidden');
  assert.equal(await processQuery(allow(2), 1, store, now), 'H1:ok:allowed');
  assert.equal(await processQuery(getPosition(1), 3, store, now), 'H1:err:forbidden');
  assert.equal(await processQuery(updatePosition(session, second), 1, store, now + 15_000), 'H1:ok:updated');
  assert.equal(store.positions.size, 1);
  const result = parseAnswer(await processQuery(getPosition(1), 2, store, now + 15_000));
  assert.equal(result.kind, 'position');
  assert.equal(result.ciphertext, second);
  assert.deepEqual(await decryptPosition(key, result.ciphertext), { latitude: 48.857, longitude: 2.353, at: now + 15_000 });
  assert.equal(await processQuery(revoke(2), 1, store, now + 15_001), 'H1:ok:revoked');
  assert.equal(await processQuery(getPosition(1), 2, store, now + 15_002), 'H1:err:forbidden');
});

test('stop clears the point and delayed updates or starts cannot revive the same session', async () => {
  const now = Date.now();
  const store = makeStore();
  const session = newSharingSession(now);
  const key = newLocationKey();
  const payload = await encryptPosition(key, 45.75, 4.85, now);
  const start = startPosition(session, 15, payload);
  assert.equal(await processQuery(start, 1, store, now), 'H1:ok:started');
  const stop = stopPosition(session);
  assert.equal(await processQuery(stop, 1, store, now + 1), 'H1:ok:stopped');
  assert.equal(await processQuery(stop, 1, store, now + 1), 'H1:ok:stopped');
  assert.equal(store.positions.get(1).ciphertext, null);
  assert.equal(await processQuery(updatePosition(session, payload), 1, store, now + 2), 'H1:err:stale_update');
  assert.equal(await processQuery(start, 1, store, now + 3), 'H1:err:stale_start');
});

test('queries stay within Telegram limits and malformed input is rejected', async () => {
  const now = Date.now();
  const key = newLocationKey();
  const session = newSharingSession(now);
  const cipher = await encryptPosition(key, -89.123456, 179.123456, now);
  const query = startPosition(session, 15, cipher);
  assert.ok(query.length <= 256);
  assert.equal(parseCommand(query)?.ciphertext, cipher);
  assert.equal(parseCommand('H1:s:bad:1:15:plaintext'), null);
  await assert.rejects(() => decryptPosition(newLocationKey(), cipher));
  assert.throws(() => startPosition(session, 7, cipher));
});

test('TDLib adapter reads a result without sending a chat message', async () => {
  const calls = [];
  const tdlib = { async send(input) { calls.push(input); return { results: [{ '@type': 'inlineQueryResultArticle', description: 'H1:ok:allowed' }] }; } };
  assert.deepEqual(await sendInlineCommand(tdlib, 42, 12, allow(2)), { kind: 'ok', code: 'allowed' });
  assert.deepEqual(calls.map(call => call['@type']), ['getInlineQueryResults']);
});

test('inline requests can use Saved Messages as an unsent context', async () => {
  const calls = [];
  const tdlib = { async send(input) { calls.push(input); return input['@type'] === 'getMe' ? { id: 42 } : { id: 42 }; } };
  assert.equal(await getSelfChatId(tdlib), 42);
  assert.deepEqual(calls.map(call => call['@type']), ['getMe', 'createPrivateChat']);
});

test('map read verifies the owner and decrypts with the session key received in Secret Chat', async () => {
  const key = newLocationKey();
  const at = Date.now();
  const cipher = await encryptPosition(key, 48.85, 2.35, at);
  const answer = `H1:pos:2:sessionAAA:1:${at}:${cipher}`;
  const tdlib = { async send() { return { results: [{ '@type': 'inlineQueryResultArticle', description: answer }] }; } };
  assert.deepEqual(await readLatestPosition(tdlib, 99, 1, 2, async (_, epoch) => epoch === 'sessionAAA' ? key : null), { latitude: 48.85, longitude: 2.35, at, updatedAt: at });
  await assert.rejects(() => readLatestPosition(tdlib, 99, 1, 3, async () => key));
});

test('bipper messages can only be sent to a ready Secret Chat for the intended contact', async () => {
  const calls = [];
  const tdlib = { async send(input) {
    calls.push(input);
    if (input['@type'] === 'getChat') return { type: { '@type': 'chatTypeSecret', user_id: 2, secret_chat_id: 7 } };
    if (input['@type'] === 'getSecretChat') return { state: { '@type': 'secretChatStateReady' }, key_hash: 'verified' };
    return { '@type': 'message' };
  } };
  await assert.rejects(() => sendSecretText(tdlib, 9, 3, 'Je vais bien.'));
  assert.equal(calls.some(call => call['@type'] === 'sendMessage'), false);
  assert.deepEqual(await sendBipper(tdlib, [{ chatId: 9, userId: 2 }], 'Je vais bien.'), [{ userId: 2, sent: true, error: undefined }]);
  assert.equal(calls.at(-1)['@type'], 'sendMessage');
  assert.equal(calls.at(-1).input_message_content.text.text, 'Je vais bien.');
});

test('a location key is accepted only from the matching Secret Chat', async () => {
  const key = newLocationKey();
  const message = { sender_id: { '@type': 'messageSenderUser', user_id: 2 }, content: { '@type': 'messageText', text: { text: `HALO-LOCATION-KEY:1:sessionAAA:${key}` } } };
  const tdlib = { async send(input) {
    if (input['@type'] === 'getChat') return { type: { '@type': 'chatTypeSecret', user_id: 2, secret_chat_id: 7 } };
    return { state: { '@type': 'secretChatStateReady' } };
  } };
  assert.deepEqual(await receiveLocationKey(tdlib, -2_000_000_000_007, 2, message), { ownerId: 2, epoch: 'sessionAAA', key });
  await assert.rejects(() => receiveLocationKey(tdlib, -2_000_000_000_007, 3, message));
});

test('location key delivery fails if a recipient cannot receive the Secret Chat message', async () => {
  const tdlib = { async send(input) {
    if (input['@type'] === 'getChat') return { type: { '@type': 'chatTypeSecret', user_id: input.chat_id, secret_chat_id: 7 } };
    if (input['@type'] === 'getSecretChat') return { state: { '@type': 'secretChatStateReady' } };
    throw new Error('Message send failed');
  } };
  await assert.rejects(() => shareLocationKey(tdlib, [{ chatId: 2, userId: 2 }], 'sessionAAA', newLocationKey()), /Message send failed/);
});

test('Secret Chat send waits for TDLib success instead of treating a queued message as delivered', async () => {
  let listener;
  const tdlib = {
    subscribe(callback) { listener = callback; return () => { listener = null; }; },
    async send(input) {
      if (input['@type'] === 'getChat') return { type: { '@type': 'chatTypeSecret', user_id: 2, secret_chat_id: 7 } };
      if (input['@type'] === 'getSecretChat') return { state: { '@type': 'secretChatStateReady' } };
      return { id: 88, chat_id: 9, sending_state: { '@type': 'messageSendingStatePending' } };
    },
  };
  const sending = sendSecretText(tdlib, 9, 2, 'Je vais bien.');
  await new Promise(resolve => setImmediate(resolve));
  listener({ '@type': 'updateMessageSendSucceeded', old_message_id: 88, message: { id: 99, chat_id: 9 } });
  assert.deepEqual(await sending, { id: 99, chat_id: 9 });
  assert.equal(listener, null);
});

test('sharing waits for Secret Chat key delivery and clears the server point on stop', async () => {
  const store = makeStore();
  const now = Date.now();
  await processQuery(invite(2), 1, store, now);
  await processQuery(accept(1), 2, store, now);
  const events = [];
  const client = new SharingController({
    async query(command) { events.push(command.split(':')[1]); return parseAnswer(await processQuery(command, 1, store, Date.now())); },
    async deliverKey(recipients, epoch, key) { events.push('key'); assert.equal(recipients[0].userId, 2); assert.ok(epoch && key); },
    async save(value) { events.push('save'); assert.ok(value === null || value.key); },
  });
  await client.start([{ userId: 2 }], 15, { latitude: 48.85, longitude: 2.35, at: now });
  assert.deepEqual(events.slice(0, 4), ['key', 'v', 's', 'save']);
  const publishing = client.publish({ latitude: 48.86, longitude: 2.36, at: now + 15_000 });
  const stopping = client.stop();
  await Promise.all([publishing, stopping]);
  assert.equal(store.positions.size, 1);
  assert.equal(store.positions.get(1).ciphertext, null);
  assert.equal(await store.canRead(1, 2), false);
  await assert.rejects(() => client.publish({ latitude: 48.87, longitude: 2.37, at: now + 30_000 }));
});
