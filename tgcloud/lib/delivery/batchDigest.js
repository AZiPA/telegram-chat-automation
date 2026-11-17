import { LABELS, MAX_DIGEST_LENGTH, formatTimestamp } from '../config.js';
import { sendHtmlMessage, sendTextSafely } from './client.js';
import { sendArchiveCopy } from './archiveCopy.js';
import { sendAlbumCopy } from './albumCopy.js';

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

/**
 * Delivers a batch of deleted messages under one header: combined text/other digest
 * plus grouped albums and individual media copies.
 *
 * @param {number} ownerChatId
 * @param {object[]} claimedRows
 * @param {string|null} headerHtml
 * @returns {Promise<{ deliveredIds: number[], failedIds: number[] }>}
 */
export async function sendDeletedBatchDigest(ownerChatId, claimedRows, headerHtml) {
  const deliveredIds = [];
  const failedIds = [];

  if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
    return { deliveredIds, failedIds };
  }

  const headerMsg = headerHtml
    ? await sendHtmlMessage(ownerChatId, headerHtml, { label: 'sendDeletedBatchHeader' })
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
          const albumRes = await sendAlbumCopy(ownerChatId, groupRows, null, batchHeaderId);
          deliveredIds.push(...albumRes.deliveredIds);
          failedIds.push(...albumRes.failedIds);
          continue;
        }
      }

      const res = await sendArchiveCopy(ownerChatId, row, null, {
        replyToMessageId: batchHeaderId,
      });
      if (res.ok) deliveredIds.push(row.id);
      else failedIds.push(row.id);
    }
  }

  return { deliveredIds, failedIds };
}
