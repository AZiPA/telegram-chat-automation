import { LABELS, MAX_DIGEST_LENGTH, formatTimestamp } from '../config.js';
import { sendHtmlMessage, sendTextSafely } from './client.js';
import { sendArchiveCopy } from './archiveCopy.js';
import { sendAlbumCopy } from './albumCopy.js';
import { sendWithPeerTopic } from './topics.js';

function buildTextDigestEntry(row) {
  const metaLine = `#${row.messageId} • ${formatTimestamp(row.createdAt)}`;
  const forwardLine = row.extra?.forwardOrigin
    ? `${LABELS.forwardOrigin}: ${row.extra.forwardOrigin}`
    : null;
  const body =
    row.mediaType === 'text'
      ? (typeof row.text === 'string' && row.text.length > 0 ? row.text : LABELS.emptyText)
      : ([row.extra?.summary, row.caption].filter(Boolean).join('\n') || LABELS.otherContent);
  return [metaLine, forwardLine, body].filter(Boolean).join('\n');
}

async function sendDeletedBatchDigestInternal(ownerChatId, claimedRows, headerHtml, options) {
  const deliveredIds = [];
  const failedIds = [];

  if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
    return { deliveredIds, failedIds };
  }

  const sharedOpts = {
    messageThreadId: options.messageThreadId,
    disableNotification: options.disableNotification,
    rethrowTopicError: options.rethrowTopicError,
  };

  const headerMsg = headerHtml
    ? await sendHtmlMessage(ownerChatId, headerHtml, {
        ...sharedOpts,
        label: 'sendDeletedBatchHeader',
      })
    : null;
  const batchHeaderId = headerMsg?.message_id;

  const textRows = [];
  const mediaRows = [];
  for (const row of claimedRows) {
    if (row.mediaType === 'text' || row.mediaType === 'other') {
      textRows.push(row);
    } else {
      mediaRows.push(row);
    }
  }

  if (textRows.length > 0) {
    const digestText = textRows.map(buildTextDigestEntry).join('\n\n──────────\n\n');
    const digestRes = await sendTextSafely(ownerChatId, digestText, {
      ...sharedOpts,
      replyToMessageId: batchHeaderId,
      maxLen: MAX_DIGEST_LENGTH,
    });
    for (const row of textRows) {
      if (digestRes.ok) deliveredIds.push(row.id);
      else failedIds.push(row.id);
    }
  }

  if (mediaRows.length > 0) {
    const groupsById = new Map();
    for (const row of mediaRows) {
      if (row.mediaGroupId) {
        if (!groupsById.has(row.mediaGroupId)) groupsById.set(row.mediaGroupId, []);
        groupsById.get(row.mediaGroupId).push(row);
      }
    }

    const handledGroups = new Set();
    for (const row of mediaRows) {
      if (row.mediaGroupId) {
        if (handledGroups.has(row.mediaGroupId)) continue;
        handledGroups.add(row.mediaGroupId);

        const groupRows = groupsById.get(row.mediaGroupId);
        if (groupRows.length >= 2) {
          const albumRes = await sendAlbumCopy(ownerChatId, groupRows, null, {
            ...sharedOpts,
            replyToMessageId: batchHeaderId,
          });
          deliveredIds.push(...albumRes.deliveredIds);
          failedIds.push(...albumRes.failedIds);
          continue;
        }
      }

      const res = await sendArchiveCopy(ownerChatId, row, null, {
        ...sharedOpts,
        replyToMessageId: batchHeaderId,
      });
      if (res.ok) deliveredIds.push(row.id);
      else failedIds.push(row.id);
    }
  }

  return { deliveredIds, failedIds };
}

/**
 * Delivers a batch of deleted messages under one header: combined text/other digest
 * plus grouped albums and individual media copies, routed to the contact's topic.
 *
 * @param {number} ownerChatId
 * @param {object[]} claimedRows
 * @param {string|null} headerHtml
 * @param {object} [options]
 * @returns {Promise<{ deliveredIds: number[], failedIds: number[] }>}
 */
export async function sendDeletedBatchDigest(
  ownerChatId,
  claimedRows,
  headerHtml,
  options = {}
) {
  if (options.peer && options.messageThreadId === undefined) {
    return await sendWithPeerTopic(ownerChatId, options.peer, (threadId, isRetry) =>
      sendDeletedBatchDigestInternal(ownerChatId, claimedRows, headerHtml, {
        ...options,
        messageThreadId: threadId,
        rethrowTopicError: Boolean(threadId) && !isRetry,
      })
    );
  }

  return await sendDeletedBatchDigestInternal(ownerChatId, claimedRows, headerHtml, options);
}
