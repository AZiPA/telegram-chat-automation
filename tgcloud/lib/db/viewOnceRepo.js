import { db } from 'sdk';
import { and, eq, isNull } from 'sdk/db';
import { messages } from '../../schema.js';

/**
 * Inserts a newly captured view-once record atomically, returning the inserted row or null.
 *
 * @param {object} record
 * @returns {Promise<object|null>}
 */
export async function insertCapturedViewOnce(record) {
  const rows = await db
    .insert(messages)
    .values(record)
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

/**
 * Atomically claims a placeholder row for view-once capture.
 *
 * @param {number} rowId
 * @param {object} content
 * @param {object} storedRow
 * @param {Date} capturedAt
 * @returns {Promise<object|null>}
 */
export async function claimViewOnceRow(rowId, content, storedRow, capturedAt) {
  const rows = await db
    .update(messages)
    .set({
      viewOnceCapturedAt: capturedAt,
      mediaType: content.mediaType,
      fileId: content.fileId,
      fileUniqueId: content.fileUniqueId,
      fileSize: content.fileSize,
      fileName: content.fileName,
      mimeType: content.mimeType,
      caption: content.caption ?? storedRow.caption,
      captionEntities: content.captionEntities ?? storedRow.captionEntities,
      extra: content.extra ?? storedRow.extra,
    })
    .where(and(eq(messages.id, rowId), isNull(messages.viewOnceCapturedAt)))
    .returning();
  return rows[0] ?? null;
}

/**
 * Rolls back a view-once capture claim when Telegram delivery fails.
 *
 * @param {number} rowId
 * @param {object|null} storedRow
 * @returns {Promise<void>}
 */
export async function rollbackViewOnceRow(rowId, storedRow) {
  const resetValues = storedRow
    ? {
        viewOnceCapturedAt: null,
        mediaType: storedRow.mediaType,
        fileId: storedRow.fileId,
        fileUniqueId: storedRow.fileUniqueId,
        fileSize: storedRow.fileSize,
        fileName: storedRow.fileName,
        mimeType: storedRow.mimeType,
        caption: storedRow.caption,
        captionEntities: storedRow.captionEntities,
        extra: storedRow.extra,
      }
    : {
        viewOnceCapturedAt: null,
        mediaType: 'view_once_placeholder',
        fileId: null,
        fileUniqueId: null,
      };

  await db.update(messages).set(resetValues).where(eq(messages.id, rowId)).run();
}

/**
 * Updates `fileId` on an archived message (e.g., after re-uploading a view-once file).
 *
 * @param {number} rowId
 * @param {string} fileId
 * @returns {Promise<void>}
 */
export async function updateMessageFileId(rowId, fileId) {
  await db.update(messages).set({ fileId }).where(eq(messages.id, rowId)).run();
}
