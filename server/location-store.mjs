import { DatabaseSync } from 'node:sqlite';

export function createLocationStore(filename) {
  const database = new DatabaseSync(filename);
  database.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS latest_locations (
      id TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      ciphertext TEXT NOT NULL,
      mode TEXT NOT NULL,
      interval_ms INTEGER NOT NULL,
      at INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      PRIMARY KEY (from_id, to_id)
    );
    CREATE INDEX IF NOT EXISTS latest_locations_recipient ON latest_locations(to_id, expires);
  `);

  // Keep only the most recent entry for each pair when upgrading a database
  // created by the earlier seven-day history implementation.
  const legacy = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'locations'").get();
  if (legacy) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const migrate = database.prepare(`INSERT OR IGNORE INTO latest_locations
        (id, from_id, to_id, nonce, ciphertext, mode, interval_ms, at, expires)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const rows = database.prepare('SELECT id, from_id, to_id, nonce, ciphertext, mode, interval_ms, at, expires FROM locations ORDER BY at DESC');
      for (const row of rows.iterate()) migrate.run(row.id, row.from_id, row.to_id, row.nonce, row.ciphertext, row.mode, row.interval_ms, row.at, row.expires);
      database.exec('DROP TABLE locations; COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  const insert = database.prepare(`INSERT INTO latest_locations
    (id, from_id, to_id, nonce, ciphertext, mode, interval_ms, at, expires)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_id, to_id) DO UPDATE SET
      id = excluded.id, nonce = excluded.nonce, ciphertext = excluded.ciphertext,
      mode = excluded.mode, interval_ms = excluded.interval_ms,
      at = excluded.at, expires = excluded.expires
    WHERE excluded.at >= latest_locations.at`);
  const latest = database.prepare('SELECT id, from_id, to_id, nonce, ciphertext, at, expires FROM latest_locations WHERE to_id = ? AND expires > ?');
  const recipients = database.prepare('SELECT to_id FROM latest_locations WHERE from_id = ?');
  const removeSender = database.prepare('DELETE FROM latest_locations WHERE from_id = ?');
  const removeRecipient = database.prepare('DELETE FROM latest_locations WHERE from_id = ? AND to_id = ?');
  const removePair = database.prepare('DELETE FROM latest_locations WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)');
  const prune = database.prepare('DELETE FROM latest_locations WHERE expires <= ?');
  const asEnvelope = row => ({ id: row.id, from: row.from_id, to: row.to_id, kind: 'location', nonce: row.nonce, ciphertext: row.ciphertext, at: row.at, expires: row.expires });

  return {
    add(item) { insert.run(item.id, item.from, item.to, item.nonce, item.ciphertext, item.mode, item.intervalMs, item.at, item.expires); },
    latestFor(recipientId, now, isContact) {
      return latest.all(recipientId, now).filter(row => isContact(row.from_id, recipientId)).map(asEnvelope);
    },
    recipientsOf(senderId) { return recipients.all(senderId).map(row => row.to_id); },
    deleteSender(senderId) { removeSender.run(senderId); },
    deleteRecipient(senderId, recipientId) { removeRecipient.run(senderId, recipientId); },
    deletePair(a, b) { removePair.run(a, b, b, a); },
    prune(now) { return prune.run(now).changes > 0; },
    close() { database.close(); },
  };
}
