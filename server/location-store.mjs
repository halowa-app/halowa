import { DatabaseSync } from 'node:sqlite';

export const HISTORY_MS = 7 * 24 * 60 * 60_000;

export function createLocationStore(filename) {
  const database = new DatabaseSync(filename);
  database.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      mode TEXT NOT NULL,
      interval_ms INTEGER NOT NULL,
      at INTEGER NOT NULL,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS locations_recipient ON locations(to_id, at DESC);
    CREATE INDEX IF NOT EXISTS locations_pair ON locations(to_id, from_id, at DESC);
    CREATE INDEX IF NOT EXISTS locations_expiry ON locations(at);
  `);
  const insert = database.prepare('INSERT OR IGNORE INTO locations (id, from_id, to_id, nonce, ciphertext, mode, interval_ms, at, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const latest = database.prepare(`
    SELECT id, from_id, to_id, nonce, ciphertext, at, expires FROM (
      SELECT id, from_id, to_id, nonce, ciphertext, at, expires,
        ROW_NUMBER() OVER (PARTITION BY from_id ORDER BY at DESC) AS recent
      FROM locations WHERE to_id = ? AND at > ?
    ) WHERE recent = 1
  `);
  const history = database.prepare(`
    SELECT id, from_id, to_id, nonce, ciphertext, at, expires FROM (
      SELECT id, from_id, to_id, nonce, ciphertext, at, expires,
        ROW_NUMBER() OVER (PARTITION BY CAST(at / 60000 AS INTEGER) ORDER BY at DESC) AS sample
      FROM locations WHERE to_id = ? AND from_id = ? AND at >= ? AND at < ?
    ) WHERE sample = 1 ORDER BY at DESC LIMIT ?
  `);
  const recipients = database.prepare('SELECT DISTINCT to_id FROM locations WHERE from_id = ?');
  const removeSender = database.prepare('DELETE FROM locations WHERE from_id = ?');
  const removeRecipient = database.prepare('DELETE FROM locations WHERE from_id = ? AND to_id = ?');
  const removePair = database.prepare('DELETE FROM locations WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)');
  const prune = database.prepare('DELETE FROM locations WHERE at < ?');
  const asEnvelope = row => ({ id: row.id, from: row.from_id, to: row.to_id, kind: 'location', nonce: row.nonce, ciphertext: row.ciphertext, at: row.at, expires: row.expires });

  return {
    add(item) { insert.run(item.id, item.from, item.to, item.nonce, item.ciphertext, item.mode, item.intervalMs, item.at, item.expires); },
    latestFor(recipientId, now, isContact) {
      return latest.all(recipientId, now - HISTORY_MS).filter(row => row.expires > now && isContact(row.from_id, recipientId)).map(asEnvelope);
    },
    historyFor(recipientId, senderId, since, before, limit) {
      return history.all(recipientId, senderId, since, before, limit).map(asEnvelope).reverse();
    },
    recipientsOf(senderId) { return recipients.all(senderId).map(row => row.to_id); },
    deleteSender(senderId) { removeSender.run(senderId); },
    deleteRecipient(senderId, recipientId) { removeRecipient.run(senderId, recipientId); },
    deletePair(a, b) { removePair.run(a, b, b, a); },
    prune(now) { return prune.run(now - HISTORY_MS).changes > 0; },
    close() { database.close(); },
  };
}
