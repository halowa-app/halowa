import { db } from 'sdk';
import { and, eq, lt } from 'sdk/db';
import { contacts, latestPositions, permissions } from '../schema.js';

const pairId = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
const permissionId = (owner, viewer) => `${owner}:${viewer}`;

export const store = {
  async invite(requesterId, inviteeId) {
    const id = pairId(requesterId, inviteeId);
    if (await db.select().from(contacts).where(eq(contacts.id, id)).get()) return false;
    await db.insert(contacts).values({ id, requesterId, inviteeId, approved: false }).run();
    return true;
  },
  async accept(inviteeId, requesterId) {
    const result = await db.update(contacts).set({ approved: true }).where(and(
      eq(contacts.id, pairId(inviteeId, requesterId)),
      eq(contacts.requesterId, requesterId),
      eq(contacts.inviteeId, inviteeId),
    )).run();
    return result.rowsAffected > 0;
  },
  async isApproved(a, b) {
    const contact = await db.select().from(contacts).where(eq(contacts.id, pairId(a, b))).get();
    return contact?.approved === true;
  },
  async allow(ownerId, viewerId) {
    const id = permissionId(ownerId, viewerId);
    await db.insert(permissions).values({ id, ownerId, viewerId }).onConflictDoUpdate({
      target: permissions.id,
      set: { viewerId },
    }).run();
  },
  async revoke(ownerId, viewerId) {
    await db.delete(permissions).where(eq(permissions.id, permissionId(ownerId, viewerId))).run();
  },
  async disconnect(a, b) {
    await db.delete(contacts).where(eq(contacts.id, pairId(a, b))).run();
    await db.delete(permissions).where(eq(permissions.id, permissionId(a, b))).run();
    await db.delete(permissions).where(eq(permissions.id, permissionId(b, a))).run();
  },
  async canRead(ownerId, viewerId) {
    return Boolean(await db.select().from(permissions).where(eq(permissions.id, permissionId(ownerId, viewerId))).get());
  },
  async start(ownerId, command, now) {
    // A generation is a millisecond timestamp created when a new sharing
    // session starts. Older or replayed starts never replace a newer session.
    if (Math.abs(command.generation - now) > 5 * 60_000) return false;
    const result = await db.run(`INSERT INTO latest_positions
      (owner_id, epoch, generation, sequence, interval_seconds, ciphertext, updated_at, active)
      VALUES (:owner_id, :epoch, :generation, :sequence, :interval_seconds, :ciphertext, :updated_at, 1)
      ON CONFLICT(owner_id) DO UPDATE SET
        epoch = excluded.epoch, generation = excluded.generation,
        sequence = excluded.sequence, interval_seconds = excluded.interval_seconds,
        ciphertext = excluded.ciphertext, updated_at = excluded.updated_at, active = 1
      WHERE excluded.generation > latest_positions.generation`, {
      ':owner_id': ownerId,
      ':epoch': command.epoch,
      ':generation': command.generation,
      ':sequence': command.sequence,
      ':interval_seconds': command.intervalSeconds,
      ':ciphertext': command.ciphertext,
      ':updated_at': now,
    });
    return result.rowsAffected > 0;
  },
  async update(ownerId, command, now) {
    const result = await db.update(latestPositions).set({
      sequence: command.sequence,
      ciphertext: command.ciphertext,
      updatedAt: now,
    }).where(and(
      eq(latestPositions.ownerId, ownerId),
      eq(latestPositions.epoch, command.epoch),
      eq(latestPositions.active, true),
      lt(latestPositions.sequence, command.sequence),
    )).run();
    return result.rowsAffected > 0;
  },
  async stop(ownerId, command, now) {
    const result = await db.update(latestPositions).set({
      sequence: command.sequence,
      ciphertext: null,
      updatedAt: now,
      active: false,
    }).where(and(
      eq(latestPositions.ownerId, ownerId),
      eq(latestPositions.epoch, command.epoch),
      eq(latestPositions.active, true),
      lt(latestPositions.sequence, command.sequence),
    )).run();
    if (result.rowsAffected > 0) {
      await db.delete(permissions).where(eq(permissions.ownerId, ownerId)).run();
      return true;
    }
    const previous = await this.read(ownerId);
    if (previous?.epoch === command.epoch && !previous.active && previous.sequence === command.sequence) {
      await db.delete(permissions).where(eq(permissions.ownerId, ownerId)).run();
      return true;
    }
    return false;
  },
  async read(ownerId) {
    return await db.select().from(latestPositions).where(eq(latestPositions.ownerId, ownerId)).get();
  },
};
