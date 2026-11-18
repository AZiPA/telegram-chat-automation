import { api } from 'sdk';
import { MAX_CAPTION_LENGTH, MAX_TEXT_LENGTH } from '../config.js';
import {
  buildNotificationParams,
  buildReplyParams,
  buildThreadParams,
  safeCall,
  sendHtmlMessage,
  sendTextSafely,
} from './client.js';
import { sendArchiveCopy } from './archiveCopy.js';
import { sendWithPeerTopic } from './topics.js';

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
    if (family && lastSeg && lastSeg.family === family) lastSeg.items.push(rec);
    else segments.push({ family, items: [rec] });
  }
  return segments;
}

async function sendFallbackSingles(ownerChatId, items, targetReplyId, options, deliveredIds, failedIds) {
  for (const rec of items) {
    const res = await sendArchiveCopy(ownerChatId, rec, null, {
      replyToMessageId: targetReplyId,
      messageThreadId: options.messageThreadId,
      disableNotification: options.disableNotification,
      rethrowTopicError: options.rethrowTopicError,
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
      overflowCaptions.push({ caption: rawCaption, captionEntities: rec.captionEntities });
    }
    return item;
  });
  return { media, overflowCaptions };
}

async function sendAlbumCopyInternal(ownerChatId, records, headerHtml, options) {
  const deliveredIds = [];
  const failedIds = [];
  if (!Array.isArray(records) || records.length === 0) return { ok: true, deliveredIds, failedIds };

  const headerMsg = headerHtml
    ? await sendHtmlMessage(ownerChatId, headerHtml, {
        label: 'sendAlbumHeader',
        replyToMessageId: options.replyToMessageId,
        messageThreadId: options.messageThreadId,
        disableNotification: options.disableNotification,
        rethrowTopicError: options.rethrowTopicError,
      })
    : null;
  const targetReplyId = headerMsg?.message_id ?? options.replyToMessageId;

  for (const segment of partitionAlbumSegments(records)) {
    if (!segment.family) {
      await sendFallbackSingles(ownerChatId, segment.items, targetReplyId, options, deliveredIds, failedIds);
      continue;
    }

    for (let i = 0; i < segment.items.length; i += 10) {
      const chunk = segment.items.slice(i, i + 10);
      if (chunk.length < 2) {
        await sendFallbackSingles(ownerChatId, chunk, targetReplyId, options, deliveredIds, failedIds);
        continue;
      }

      const { media, overflowCaptions } = buildMediaGroupPayload(chunk);
      const sentGroup = await safeCall(
        () =>
          api.sendMediaGroup({
            chat_id: ownerChatId,
            media,
            ...buildThreadParams(options.messageThreadId),
            ...buildNotificationParams(options.disableNotification),
            ...buildReplyParams(targetReplyId),
          }),
        'sendMediaGroup',
        { rethrowTopicError: Boolean(options.rethrowTopicError) }
      );

      if (sentGroup) {
        const groupReplyId = sentGroup[0]?.message_id ?? targetReplyId;
        for (const extraCap of overflowCaptions) {
          await sendTextSafely(ownerChatId, extraCap.caption, {
            replyToMessageId: groupReplyId,
            messageThreadId: options.messageThreadId,
            disableNotification: options.disableNotification,
            rethrowTopicError: options.rethrowTopicError,
            entities: extraCap.caption.length <= MAX_TEXT_LENGTH ? extraCap.captionEntities : undefined,
          });
        }
        for (const rec of chunk) deliveredIds.push(rec.id);
      } else {
        await sendFallbackSingles(ownerChatId, chunk, targetReplyId, options, deliveredIds, failedIds);
      }
    }
  }
  return { ok: failedIds.length === 0, deliveredIds, failedIds };
}

/** Delivers album records using `sendMediaGroup` (2-10 items), with per-item fallback. */
export async function sendAlbumCopy(ownerChatId, records, headerHtml, optionsOrReplyId = {}) {
  const options =
    typeof optionsOrReplyId === 'number' ? { replyToMessageId: optionsOrReplyId } : optionsOrReplyId ?? {};

  if (options.peer && options.messageThreadId === undefined) {
    return await sendWithPeerTopic(ownerChatId, options.peer, (threadId, isRetry) =>
      sendAlbumCopyInternal(ownerChatId, records, headerHtml, {
        ...options,
        messageThreadId: threadId,
        rethrowTopicError: Boolean(threadId) && !isRetry,
      })
    );
  }
  return await sendAlbumCopyInternal(ownerChatId, records, headerHtml, options);
}
