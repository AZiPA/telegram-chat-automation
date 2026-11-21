import { api } from 'sdk';
import {
  CAPTURE_UNARCHIVED_REPLIES,
  HEADERS,
  LABELS,
  isOwner,
  formatHtmlTimestamp,
  getMediaTypeLabel,
} from '../config.js';
import { findMessage } from '../db/messageRepo.js';
import { getViewOnceConfig, isTriggerReplyMatch } from '../db/settings.js';
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
    `${LABELS.sentAt}: ${formatHtmlTimestamp(replyDate)}`,
  ];
  if (forwardOrigin) {
    lines.push(`${LABELS.forwardOrigin}: ${escapeHtml(forwardOrigin)}`);
  }
  lines.push(LABELS.divider);
  return lines.join('\n');
}

function buildViewOncePeer(message, replyMsg) {
  return {
    id: message.chat.id,
    first_name: message.chat.first_name ?? replyMsg.from?.first_name,
    last_name: message.chat.last_name ?? replyMsg.from?.last_name,
    username: message.chat.username ?? replyMsg.from?.username,
    title: message.chat.title,
  };
}

/**
 * Captures view-once (or unarchived) media when the owner replies to it before opening,
 * routes it to the contact's topic, rolls back DB state on failure, and auto-deletes
 * the reply only when auto-delete is enabled, permitted, and matches the configured trigger.
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
    peer: buildViewOncePeer(message, replyMsg),
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

  const { trigger, autoDelete } = await getViewOnceConfig();
  const canDeleteAll = Boolean((conn.rights ?? {}).can_delete_all_messages);
  if (
    res.ok === true &&
    autoDelete === true &&
    canDeleteAll &&
    isTriggerReplyMatch(message, trigger) === true
  ) {
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
