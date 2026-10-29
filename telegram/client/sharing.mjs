import { allow, encryptPosition, newLocationKey, newSharingSession, revoke, startPosition, stopPosition, updatePosition } from './protocol.mjs';

function requireOk(answer, expected) {
  if (answer?.kind !== 'ok' || answer.code !== expected) throw new Error(`Halo bot rejected ${expected}: ${answer?.code ?? 'no response'}`);
}

// `query` sends one invisible inline query. `deliverKey` must wait for TDLib's
// send-success update for every recipient and reject on failure. `save` must
// use secure storage.
export class SharingController {
  constructor({ query, deliverKey, save }) {
    this.query = query;
    this.deliverKey = deliverKey;
    this.save = save;
    this.current = null;
    this.pending = Promise.resolve();
  }

  enqueue(work) {
    const result = this.pending.then(work);
    this.pending = result.catch(() => {});
    return result;
  }

  start(recipients, intervalSeconds, point) {
    return this.enqueue(() => this.startNow(recipients, intervalSeconds, point));
  }

  async startNow(recipients, intervalSeconds, point) {
    if (this.current) throw new Error('A location share is already active.');
    const ids = recipients.map(recipient => recipient.userId);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Choose distinct approved contacts.');
    const key = newLocationKey();
    const session = newSharingSession();
    const allowed = [];
    try {
      await this.deliverKey(recipients, session.epoch, key);
      for (const id of ids) {
        requireOk(await this.query(allow(id)), 'allowed');
        allowed.push(id);
      }
      const ciphertext = await encryptPosition(key, point.latitude, point.longitude, point.at);
      requireOk(await this.query(startPosition(session, intervalSeconds, ciphertext)), 'started');
      const current = { session, key, ids, intervalSeconds };
      await this.save(current);
      this.current = current;
      return current;
    } catch (error) {
      // Do not leave a partially configured share accessible after failure.
      if (session.sequence > 0) await this.query(stopPosition(session)).catch(() => {});
      await Promise.allSettled(allowed.map(id => this.query(revoke(id))));
      throw error;
    }
  }

  publish(point) {
    return this.enqueue(() => this.publishNow(point));
  }

  async publishNow(point) {
    if (!this.current) throw new Error('Location sharing is off.');
    const { session, key } = this.current;
    const ciphertext = await encryptPosition(key, point.latitude, point.longitude, point.at);
    requireOk(await this.query(updatePosition(session, ciphertext)), 'updated');
  }

  stop() {
    return this.enqueue(() => this.stopNow());
  }

  async stopNow() {
    if (!this.current) return;
    const { session } = this.current;
    this.stopQuery ??= stopPosition(session);
    requireOk(await this.query(this.stopQuery), 'stopped');
    await this.save(null);
    this.current = null;
    this.stopQuery = null;
  }
}
