import {
  HEADERS,
  LABELS,
  MAX_DELETE_BATCH,
  NOTIFY_UNARCHIVED_DELETES,
  formatTimestamp,
  getMediaTypeLabel,
} from '../config.js';
import { getActiveOwnerConnection } from '../db/connectionRepo.js';
import { claimDeletedBatch, findMessagesByIds, rollbackDeletedClaim } from '../db/messageRepo.js';
import { sendHtmlMessage } from '../delivery/client.js';
import { sendArchiveCopy } from '../delivery/archiveCopy.js';
import { sendDeletedBatchDigest } from '../delivery/batchDigest.js';
import { sendWithPeerTopic } from '../delivery/topics.js';
import { escapeHtml, formatSenderRaw } from '../media/formatting.js';

function buildSingleDeleteHeader(row, chatRaw, deletedAt) {
  const senderRaw = row.senderName || chatRaw;
  const lines = [
    HEADERS.deletedMessage,
    `${LABELS.sender}: ${escapeHtml(senderRaw)}`,
    `${LABELS.chat}: ${escapeHtml(chatRaw)}`,
    `${LABELS.mediaType}: ${escapeHtml(getMediaTypeLabel(row.mediaType))}`,
    `${LABELS.sentAt}: ${escapeHtml(formatTimestamp(row.createdAt))}`,
    `${LABELS.deletedAt}: ${escapeHtml(formatTimestamp(deletedAt))}`,
  ];
  if (row.extra?.forwardOrigin) lines.push(`${LABELS.forwardOrigin}: ${escapeHtml(row.extra.forwardOrigin)}`);
  lines.push(LABELS.divider);
  return lines.join('\n');
}

function buildBatchDeleteHeader(claimedRows, chatRaw, deletedAt) {
  const firstSenderRaw = claimedRows[0]?.senderName || chatRaw;
  return [
    HEADERS.deletedBatch,
    `${LABELS.count}: ${claimedRows.length} messages`,
    `${LABELS.sender}: ${escapeHtml(firstSenderRaw)}`,
    `${LABELS.chat}: ${escapeHtml(chatRaw)}`,
    `${LABELS.deletedAt}: ${escapeHtml(formatTimestamp(deletedAt))}`,
    LABELS.divider,
  ].join('\n');
}

async function sendPeerNotice(ownerChatId, peer, html, label) {
  await sendWithPeerTopic(ownerChatId, peer, (threadId, isRetry) =>
    sendHtmlMessage(ownerChatId, html, {
      label,
      messageThreadId: threadId,
      rethrowTopicError: Boolean(threadId) && !isRetry,
    })
  );
}

/** Processes `deleted_business_messages`, delivering single or batch digests to the contact's topic. */
export async function handleDeletedBusinessMessages(payload) {
  const conn = await getActiveOwnerConnection(payload.business_connection_id);
  if (!conn) return;

  const uniqueMessageIds = [...new Set(payload.message_ids.filter((id) => typeof id === 'number'))];
  if (uniqueMessageIds.length === 0) return;

  const existingRows = await findMessagesByIds(conn.connectionId, payload.chat.id, uniqueMessageIds);
  const existingByMsgId = new Map(existingRows.map((row) => [row.messageId, row]));
  const unknownIds = uniqueMessageIds.filter((id) => !existingByMsgId.has(id));

  const eligibleIds = existingRows
    .filter((row) => row.isIncoming === true && row.notifiedDeleteAt == null)
    .map((row) => row.messageId)
    .sort((a, b) => a - b);

  let claimedRows = [];
  let overflowCount = 0;
  const deletedAt = new Date();

  if (eligibleIds.length > 0) {
    const idsToClaim = eligibleIds.slice(0, MAX_DELETE_BATCH);
    overflowCount = Math.max(0, eligibleIds.length - MAX_DELETE_BATCH);
    claimedRows = await claimDeletedBatch(conn.connectionId, payload.chat.id, idsToClaim, deletedAt);
  }

  const chatRaw = formatSenderRaw(null, payload.chat);
  const unarchivedSummary =
    NOTIFY_UNARCHIVED_DELETES && unknownIds.length > 0
      ? `ℹ️ ${unknownIds.length} unarchived message${unknownIds.length === 1 ? '' : 's'} (likely sent before the bot was connected) ${unknownIds.length === 1 ? 'was' : 'were'} deleted in chat ${escapeHtml(chatRaw)}.`
      : '';

  if (claimedRows.length === 0 && !unarchivedSummary) return;

  const peer = payload.chat;

  if (claimedRows.length === 1) {
    const row = claimedRows[0];
    const res = await sendArchiveCopy(conn.ownerChatId, row, buildSingleDeleteHeader(row, chatRaw, deletedAt), { peer });
    if (!res.ok) await rollbackDeletedClaim([row.id]);
  } else if (claimedRows.length > 1) {
    const { failedIds } = await sendDeletedBatchDigest(
      conn.ownerChatId,
      claimedRows,
      buildBatchDeleteHeader(claimedRows, chatRaw, deletedAt),
      { peer }
    );
    if (failedIds.length > 0) await rollbackDeletedClaim(failedIds);
  }

  if (claimedRows.length > 0 && overflowCount > 0) {
    await sendPeerNotice(
      conn.ownerChatId,
      peer,
      `⚠️ ${overflowCount} additional deleted message${overflowCount === 1 ? '' : 's'} in chat ${escapeHtml(chatRaw)} ${overflowCount === 1 ? 'was' : 'were'} skipped due to the batch limit (${MAX_DELETE_BATCH} per update).`,
      'deleteOverflowNotice'
    );
  }

  if (unarchivedSummary) {
    await sendPeerNotice(
      conn.ownerChatId,
      peer,
      unarchivedSummary,
      'unarchivedDeleteSummary'
    );
  }
}
