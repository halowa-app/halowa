import { freshnessMs, parseCommand, positionResult } from './protocol.js';

// Telegram supplies the authenticated account ID in inlineQuery.from.id.
// The opaque position is encrypted on the phone before this function runs.
export async function processQuery(query, callerId, store, now = Date.now()) {
  const command = parseCommand(query);
  if (!command || !Number.isSafeInteger(callerId) || callerId <= 0) return 'H1:err:invalid';
  const { operation } = command;
  if (operation === 'i') {
    if (command.otherId === callerId) return 'H1:err:self';
    return await store.invite(callerId, command.otherId) ? 'H1:ok:invited' : 'H1:err:contact_exists';
  }
  if (operation === 'a') {
    return await store.accept(callerId, command.otherId) ? 'H1:ok:approved' : 'H1:err:no_invite';
  }
  if (operation === 'v') {
    if (!await store.isApproved(callerId, command.otherId)) return 'H1:err:not_approved';
    await store.allow(callerId, command.otherId);
    return 'H1:ok:allowed';
  }
  if (operation === 'r') {
    await store.revoke(callerId, command.otherId);
    return 'H1:ok:revoked';
  }
  if (operation === 'd') {
    await store.disconnect(callerId, command.otherId);
    return 'H1:ok:removed';
  }
  if (operation === 's') {
    return await store.start(callerId, command, now) ? 'H1:ok:started' : 'H1:err:stale_start';
  }
  if (operation === 'u') {
    return await store.update(callerId, command, now) ? 'H1:ok:updated' : 'H1:err:stale_update';
  }
  if (operation === 'x') {
    return await store.stop(callerId, command, now) ? 'H1:ok:stopped' : 'H1:err:stale_stop';
  }
  if (operation === 'g') {
    if (!await store.isApproved(callerId, command.ownerId) || !await store.canRead(command.ownerId, callerId)) return 'H1:err:forbidden';
    const position = await store.read(command.ownerId);
    if (!position?.active || !position.ciphertext || position.updatedAt + freshnessMs(position.intervalSeconds) < now) return 'H1:err:unavailable';
    return positionResult(position);
  }
  return 'H1:err:invalid';
}
