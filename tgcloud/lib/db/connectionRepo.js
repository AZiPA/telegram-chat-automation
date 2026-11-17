import { db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { connections } from '../../schema.js';
import { getOwnerId, isOwner } from '../config.js';

/**
 * Fetches an enabled Telegram Business connection belonging to the configured owner.
 *
 * @param {string} businessConnectionId
 * @returns {Promise<object|null>}
 */
export async function getActiveOwnerConnection(businessConnectionId) {
  if (!businessConnectionId) return null;

  const ownerId = await getOwnerId();
  if (!ownerId) return null;

  const conn = await db
    .select()
    .from(connections)
    .where(eq(connections.connectionId, businessConnectionId))
    .get();

  if (!conn) return null;
  if (!isOwner(conn.ownerUserId, ownerId) || conn.isEnabled !== true) return null;
  return conn;
}

/**
 * Lists all registered Business connections for the given owner, newest first.
 *
 * @param {number} ownerUserId
 * @returns {Promise<object[]>}
 */
export async function listOwnerConnections(ownerUserId) {
  return await db
    .select()
    .from(connections)
    .where(eq(connections.ownerUserId, Number(ownerUserId)))
    .orderBy(desc(connections.updatedAt))
    .all();
}

/**
 * Inserts or updates a Telegram Business connection record.
 *
 * @param {object} params
 * @returns {Promise<void>}
 */
export async function upsertBusinessConnection({
  connectionId,
  ownerUserId,
  ownerChatId,
  rights,
  isEnabled,
  updatedAt = new Date(),
}) {
  await db
    .insert(connections)
    .values({
      connectionId,
      ownerUserId,
      ownerChatId,
      rights,
      isEnabled,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: connections.connectionId,
      set: {
        ownerUserId,
        ownerChatId,
        rights,
        isEnabled,
        updatedAt,
      },
    })
    .run();
}
