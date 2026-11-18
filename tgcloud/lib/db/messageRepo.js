import { db } from 'sdk';
import { and, eq, inArray, isNull } from 'sdk/db';
import { messages } from '../../schema.js';

/**
 * Finds a single archived message by (connectionId, chatId, messageId).
 *
 * @param {string} connectionId
 * @param {number} chatId
 * @param {number} messageId
 * @returns {Promise<object|null>}
 */
export async function findMessage(connectionId, chatId, messageId) {
  return await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.businessConnectionId, connectionId),
        eq(messages.chatId, chatId),
        eq(messages.messageId, messageId)
      )
    )
    .get();
}

/**
 * Fetches all archived messages matching a set of message IDs in a chat.
 *
 * @param {string} connectionId
 * @param {number} chatId
 * @param {number[]} messageIds
 * @returns {Promise<object[]>}
 */
export async function findMessagesByIds(connectionId, chatId, messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return [];
  return await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.businessConnectionId, connectionId),
        eq(messages.chatId, chatId),
        inArray(messages.messageId, messageIds)
      )
    )
    .all();
}

/**
 * Inserts a message record if it does not already exist, returning the inserted row or null.
 *
 * @param {object} record
 * @returns {Promise<object|null>}
 */
export async function insertMessage(record) {
  const rows = await db
    .insert(messages)
    .values(record)
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

/**
 * Updates only `editDate` when a webhook edit had no meaningful content changes.
 *
 * @param {number} rowId
 * @param {number} editDate
 * @returns {Promise<void>}
 */
export async function touchMessageEditDate(rowId, editDate) {
  await db.update(messages).set({ editDate }).where(eq(messages.id, rowId)).run();
}

/**
 * Applies a meaningful edit update, guarded by previous `editDate` when numeric `edit_date` is present.
 *
 * @param {number} rowId
 * @param {number|null|undefined} prevEditDate
 * @param {object} updateFields
 * @param {boolean} hasNumericEditDate
 * @returns {Promise<boolean>}
 */
export async function applyMessageEdit(rowId, prevEditDate, updateFields, hasNumericEditDate) {
  if (hasNumericEditDate) {
    const editGuard =
      prevEditDate === null || prevEditDate === undefined
        ? isNull(messages.editDate)
        : eq(messages.editDate, prevEditDate);
    const updated = await db
      .update(messages)
      .set(updateFields)
      .where(and(eq(messages.id, rowId), editGuard))
      .returning();
    return updated.length > 0;
  }

  await db.update(messages).set(updateFields).where(eq(messages.id, rowId)).run();
  return true;
}

/**
 * Atomically claims incoming unnotified deleted messages by setting `notifiedDeleteAt`.
 *
 * @param {string} connectionId
 * @param {number} chatId
 * @param {number[]} messageIds
 * @param {Date} deletedAt
 * @returns {Promise<object[]>}
 */
export async function claimDeletedBatch(connectionId, chatId, messageIds, deletedAt) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) return [];
  const rows = await db
    .update(messages)
    .set({ notifiedDeleteAt: deletedAt })
    .where(
      and(
        eq(messages.businessConnectionId, connectionId),
        eq(messages.chatId, chatId),
        inArray(messages.messageId, messageIds),
        eq(messages.isIncoming, true),
        isNull(messages.notifiedDeleteAt)
      )
    )
    .returning();

  return rows.sort((a, b) => a.messageId - b.messageId);
}

/**
 * Clears `notifiedDeleteAt` for rows whose deletion notification failed to deliver.
 *
 * @param {number[]} rowIds
 * @returns {Promise<void>}
 */
export async function rollbackDeletedClaim(rowIds) {
  if (!Array.isArray(rowIds) || rowIds.length === 0) return;

  const condition =
    rowIds.length === 1
      ? eq(messages.id, rowIds[0])
      : inArray(messages.id, rowIds);

  await db
    .update(messages)
    .set({ notifiedDeleteAt: null })
    .where(condition)
    .run();
}
