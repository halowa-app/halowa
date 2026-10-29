import { boolean, integer, text, table } from 'sdk/db';

// A contact must accept an invitation before either side can use it in Halo.
export const contacts = table('contacts', {
  id: text('id').primaryKey(),
  requesterId: integer('requester_id').notNull(),
  inviteeId: integer('invitee_id').notNull(),
  approved: boolean('approved').notNull().default(false),
});

export const permissions = table('permissions', {
  id: text('id').primaryKey(),
  ownerId: integer('owner_id').notNull(),
  viewerId: integer('viewer_id').notNull(),
});

// One row per owner. Updates replace the previous encrypted position.
export const latestPositions = table('latest_positions', {
  ownerId: integer('owner_id').primaryKey(),
  epoch: text('epoch').notNull(),
  generation: integer('generation').notNull(),
  sequence: integer('sequence').notNull(),
  intervalSeconds: integer('interval_seconds').notNull(),
  ciphertext: text('ciphertext'),
  updatedAt: integer('updated_at').notNull(),
  active: boolean('active').notNull().default(false),
});
