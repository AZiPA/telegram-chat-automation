import { api } from 'sdk';
import {
  CAPTURE_UNARCHIVED_REPLIES,
  DELETE_TRIGGER_REPLY,
  HEADERS,
  LABELS,
  isOwner,
  formatTimestamp,
  getMediaTypeLabel,
} from '../config.js';
import { findMessage } from '../db/messageRepo.js';
import {
  claimViewOnceRow,
  insertCapturedViewOnce,
  rollbackViewOnceRow,
  updateMessageFileId,
} from '../db/viewOnceRepo.js';
import { safeCall } from '../delivery/client.js';
import { sendArchiveCopy } from '../delivery/archiveCopy.js';
import {
  buildMessageRecord,
  extractMessageContent,
  hasCapturableViewOnceMedia,
} from '../media/extractor.js';
import { escapeHtml, formatSenderRaw } from '../media/formatting.js';

function buildViewOnceHeaderHtml(replySenderRaw, chatRaw, mediaType, replyDate, forwardOrigin) {
  const lines = [
    HEADERS.viewOnceCaptured,
    `${LABELS.sender}: ${escapeHtml(replySenderRaw)}`,
    `${LABELS.chat}: ${escapeHtml(chatRaw)}`,
    `${LABELS.mediaType}: ${escapeHtml(getMediaTypeLabel(mediaType))}`,
    `${LABELS.sentAt}: ${escapeHtml(formatTimestamp(replyDate))}`,
  ];
  if (forwardOrigin) {
    lines.push(`${LABELS.forwardOrigin}: ${escapeHtml(forwardOrigin)}`);
  }
  lines.push(LABELS.divider);
  return lines.join('\n');
}

/**
 * Captures view-once (or unarchived) media when the owner replies to it before opening,
 * rolling back DB state on failure and optionally deleting the trigger reply on success.
 *
 * @param {object} conn
 * @param {object} message
 * @returns {Promise<void>}
 */
export async function handleViewOnceReplyTrigger(conn, message) {
  const replyMsg = message.reply_to_message;
  if (!replyMsg || typeof replyMsg.message_id !== 'number') return;

  const repliedContent = extractMessageContent(replyMsg);
  if (!hasCapturableViewOnceMedia(repliedContent)) return;
  if (isOwner(replyMsg.from?.id, conn.ownerUserId)) return;

  const chatId = message.chat.id;
  const storedRow = await findMessage(conn.connectionId, chatId, replyMsg.message_id);

  if (!storedRow && !CAPTURE_UNARCHIVED_REPLIES) return;
  if (storedRow?.viewOnceCapturedAt != null) return;

  const shouldCapture =
    !storedRow ||
    !storedRow.fileId ||
    storedRow.mediaType === 'view_once_placeholder' ||
    storedRow.fileUniqueId !== repliedContent.fileUniqueId;

  if (!shouldCapture) return;

  const now = new Date();
  const replyDate =
    typeof replyMsg.date === 'number'
      ? new Date(replyMsg.date * 1000)
      : storedRow?.createdAt ?? now;
  const replySenderRaw =
    storedRow?.senderName || formatSenderRaw(replyMsg.from, message.chat);

  const targetRow = storedRow
    ? await claimViewOnceRow(storedRow.id, repliedContent, storedRow, now)
    : await insertCapturedViewOnce(
        buildMessageRecord({
          connectionId: conn.connectionId,
          chatId,
          senderId: replyMsg.from?.id ?? message.chat.id,
          senderName: replySenderRaw,
          isIncoming: true,
          messageId: replyMsg.message_id,
          content: repliedContent,
          editDate: typeof replyMsg.edit_date === 'number' ? replyMsg.edit_date : null,
          createdAt: replyDate,
          viewOnceCapturedAt: now,
        })
      );

  if (!targetRow) return;

  const headerHtml = buildViewOnceHeaderHtml(
    replySenderRaw,
    formatSenderRaw(null, message.chat),
    repliedContent.mediaType,
    replyDate,
    targetRow.extra?.forwardOrigin
  );

  const res = await sendArchiveCopy(conn.ownerChatId, targetRow, headerHtml, {
    allowReuploadFallback: true,
  });

  if (!res.ok) {
    await rollbackViewOnceRow(targetRow.id, storedRow);
    return;
  }

  if (res.message) {
    const sentContent = extractMessageContent(res.message);
    if (sentContent.fileId && sentContent.fileId !== targetRow.fileId) {
      await updateMessageFileId(targetRow.id, sentContent.fileId);
    }
  }

  const rights = conn.rights ?? {};
  if (DELETE_TRIGGER_REPLY && rights.can_delete_all_messages) {
    await safeCall(
      () =>
        api.deleteBusinessMessages({
          business_connection_id: conn.connectionId,
          message_ids: [message.message_id],
        }),
      'deleteTriggerReply'
    );
  }
}
