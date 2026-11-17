import { api } from 'sdk';
import { MAX_CAPTION_LENGTH, MAX_TEXT_LENGTH } from '../config.js';
import {
  buildReplyParams,
  safeCall,
  sendHtmlMessage,
  sendTextSafely,
} from './client.js';
import { sendArchiveCopy } from './archiveCopy.js';

function getAlbumFamily(record) {
  if (!record?.fileId) return null;
  if (record.mediaType === 'photo' || record.mediaType === 'video') return 'visual';
  if (record.mediaType === 'document') return 'document';
  if (record.mediaType === 'audio') return 'audio';
  return null;
}

function partitionAlbumSegments(records) {
  // Partition into contiguous compatible runs so Telegram sendMediaGroup rules hold.
  const segments = [];
  for (const rec of records) {
    const family = getAlbumFamily(rec);
    const lastSeg = segments[segments.length - 1];
    if (family && lastSeg && lastSeg.family === family) {
      lastSeg.items.push(rec);
    } else {
      segments.push({ family, items: [rec] });
    }
  }
  return segments;
}

async function sendFallbackSingles(ownerChatId, items, targetReplyId, deliveredIds, failedIds) {
  for (const rec of items) {
    const res = await sendArchiveCopy(ownerChatId, rec, null, {
      replyToMessageId: targetReplyId,
    });
    if (res.ok) deliveredIds.push(rec.id);
    else failedIds.push(rec.id);
  }
}

function buildMediaGroupPayload(chunk) {
  const overflowCaptions = [];
  const media = chunk.map((rec) => {
    const item = { type: rec.mediaType, media: rec.fileId };
    const rawCaption = typeof rec.caption === 'string' ? rec.caption : '';
    if (rawCaption.length > 0 && rawCaption.length <= MAX_CAPTION_LENGTH) {
      item.caption = rawCaption;
      if (Array.isArray(rec.captionEntities) && rec.captionEntities.length > 0) {
        item.caption_entities = rec.captionEntities;
      }
    } else if (rawCaption.length > MAX_CAPTION_LENGTH) {
      overflowCaptions.push({
        caption: rawCaption,
        captionEntities: rec.captionEntities,
      });
    }
    return item;
  });

  return { media, overflowCaptions };
}

/**
 * Delivers a group of album records using Telegram `sendMediaGroup` (chunks of 2-10),
 * falling back to individual copies when a chunk has 1 item or `sendMediaGroup` fails.
 *
 * @param {number} ownerChatId
 * @param {object[]} records
 * @param {string|null} headerHtml
 * @param {number|undefined} replyToMessageId
 * @returns {Promise<{ ok: boolean, deliveredIds: number[], failedIds: number[] }>}
 */
export async function sendAlbumCopy(ownerChatId, records, headerHtml, replyToMessageId) {
  const deliveredIds = [];
  const failedIds = [];

  if (!Array.isArray(records) || records.length === 0) {
    return { ok: true, deliveredIds, failedIds };
  }

  const headerMsg = headerHtml
    ? await sendHtmlMessage(ownerChatId, headerHtml, { label: 'sendAlbumHeader' })
    : null;
  const targetReplyId = headerMsg?.message_id ?? replyToMessageId;

  for (const segment of partitionAlbumSegments(records)) {
    if (!segment.family) {
      await sendFallbackSingles(ownerChatId, segment.items, targetReplyId, deliveredIds, failedIds);
      continue;
    }

    for (let i = 0; i < segment.items.length; i += 10) {
      const chunk = segment.items.slice(i, i + 10);
      if (chunk.length < 2) {
        await sendFallbackSingles(ownerChatId, chunk, targetReplyId, deliveredIds, failedIds);
        continue;
      }

      const { media, overflowCaptions } = buildMediaGroupPayload(chunk);
      const sentGroup = await safeCall(
        () =>
          api.sendMediaGroup({
            chat_id: ownerChatId,
            media,
            ...buildReplyParams(targetReplyId),
          }),
        'sendMediaGroup'
      );

      if (sentGroup) {
        const groupReplyId = sentGroup[0]?.message_id ?? targetReplyId;
        for (const extraCap of overflowCaptions) {
          await sendTextSafely(ownerChatId, extraCap.caption, {
            replyToMessageId: groupReplyId,
            entities:
              extraCap.caption.length <= MAX_TEXT_LENGTH
                ? extraCap.captionEntities
                : undefined,
          });
        }
        for (const rec of chunk) deliveredIds.push(rec.id);
      } else {
        await sendFallbackSingles(ownerChatId, chunk, targetReplyId, deliveredIds, failedIds);
      }
    }
  }

  return { ok: failedIds.length === 0, deliveredIds, failedIds };
}
