import { api } from 'sdk';
import {
  LABELS,
  MAX_CAPTION_LENGTH,
  MAX_TEXT_LENGTH,
  USE_RICH_TEXT_REPORTS,
} from '../config.js';
import { buildRichDeletePayloads } from '../rich/deleteFormat.js';
import {
  buildNotificationParams,
  buildReplyParams,
  buildThreadParams,
  safeCall,
  sendHtmlMessage,
  sendTextSafely,
} from './client.js';
import { sendRichReportSequence } from './richSequence.js';
import { sendWithPeerTopic } from './topics.js';
import { reuploadViewOnceMedia } from './viewOnceUpload.js';

const MEDIA_SEND_CONFIG = {
  photo: { method: 'sendPhoto', field: 'photo', supportsCaption: true },
  video: { method: 'sendVideo', field: 'video', supportsCaption: true },
  voice: { method: 'sendVoice', field: 'voice', supportsCaption: true },
  document: { method: 'sendDocument', field: 'document', supportsCaption: true },
  audio: { method: 'sendAudio', field: 'audio', supportsCaption: true },
  animation: { method: 'sendAnimation', field: 'animation', supportsCaption: true },
  video_note: { method: 'sendVideoNote', field: 'video_note', supportsCaption: false },
  sticker: { method: 'sendSticker', field: 'sticker', supportsCaption: false },
};

/** Returns true if the given Telegram media type accepts a `caption` parameter. */
export function mediaSupportsCaption(mediaType) {
  return Boolean(MEDIA_SEND_CONFIG[mediaType]?.supportsCaption);
}

async function sendMediaRecord(ownerChatId, record, replyTargetId, options) {
  const mediaConfig = MEDIA_SEND_CONFIG[record.mediaType];
  const replyParams = buildReplyParams(replyTargetId);
  const rawCaption = typeof record.caption === 'string' ? record.caption : '';
  const captionTooLong = rawCaption.length > MAX_CAPTION_LENGTH;

  const captionParams = {};
  if (mediaConfig.supportsCaption && rawCaption.length > 0 && !captionTooLong) {
    captionParams.caption = rawCaption;
    if (Array.isArray(record.captionEntities) && record.captionEntities.length > 0) {
      captionParams.caption_entities = record.captionEntities;
    }
  }

  let sentMedia = await safeCall(
    () =>
      api[mediaConfig.method]({
        chat_id: ownerChatId,
        [mediaConfig.field]: record.fileId,
        ...captionParams,
        ...buildThreadParams(options.messageThreadId),
        ...buildNotificationParams(options.disableNotification),
        ...replyParams,
      }),
    mediaConfig.method,
    { rethrowTopicError: Boolean(options.rethrowTopicError) }
  );

  if (!sentMedia && options.allowReuploadFallback === true) {
    sentMedia = await reuploadViewOnceMedia(
      ownerChatId,
      record,
      mediaConfig,
      captionParams,
      replyParams,
      replyTargetId,
      options
    );
  }
  if (!sentMedia) return { ok: false, message: null };

  if (mediaConfig.supportsCaption && captionTooLong) {
    await sendTextSafely(ownerChatId, rawCaption, {
      replyToMessageId: sentMedia.message_id ?? replyTargetId,
      messageThreadId: options.messageThreadId,
      disableNotification: options.disableNotification,
      rethrowTopicError: options.rethrowTopicError,
      entities: rawCaption.length <= MAX_TEXT_LENGTH ? record.captionEntities : undefined,
    });
  }
  return { ok: true, message: sentMedia };
}

async function sendClassicArchiveCopy(ownerChatId, record, headerHtml, options) {
  const headerMsg = headerHtml
    ? await sendHtmlMessage(ownerChatId, headerHtml, {
        label: 'sendArchiveHeader',
        replyToMessageId: options.replyToMessageId,
        messageThreadId: options.messageThreadId,
        disableNotification: options.disableNotification,
        rethrowTopicError: options.rethrowTopicError,
      })
    : null;
  const replyTargetId = headerMsg?.message_id ?? options.replyToMessageId;

  if (MEDIA_SEND_CONFIG[record.mediaType] && record.fileId) {
    return await sendMediaRecord(ownerChatId, record, replyTargetId, options);
  }

  const textOpts = {
    replyToMessageId: replyTargetId,
    messageThreadId: options.messageThreadId,
    disableNotification: options.disableNotification,
    rethrowTopicError: options.rethrowTopicError,
  };

  if (record.mediaType === 'text') {
    const body = typeof record.text === 'string' && record.text.length > 0 ? record.text : LABELS.emptyText;
    return await sendTextSafely(ownerChatId, body, {
      ...textOpts,
      entities: record.text === body ? record.entities : undefined,
    });
  }
  if (record.mediaType === 'other') {
    const body = [record.extra?.summary, record.caption].filter(Boolean).join('\n\n') || LABELS.otherContent;
    return await sendTextSafely(ownerChatId, body, textOpts);
  }
  if (record.mediaType === 'view_once_placeholder') {
    const body = record.caption ? `${LABELS.viewOnceUnavailable}\n\n${record.caption}` : LABELS.viewOnceUnavailable;
    return await sendTextSafely(ownerChatId, body, textOpts);
  }
  return await sendTextSafely(ownerChatId, record.caption || record.text || LABELS.otherContent, textOpts);
}

async function sendRichDeleteCopy(ownerChatId, record, headerHtml, options) {
  const meta = options.richDeleteMeta;
  const payloads = buildRichDeletePayloads({
    text: record.text,
    entities: record.entities,
    senderLabel: meta.senderLabel,
    chatLabel: meta.chatLabel,
    sentAt: meta.sentAt ?? record.createdAt,
    deletedAt: meta.deletedAt,
    messageId: meta.messageId ?? record.messageId,
    forwardOrigin: meta.forwardOrigin ?? record.extra?.forwardOrigin ?? null,
    isRichMessage: Boolean(meta.isRichMessage ?? record.extra?.isRichMessage),
  });

  return await sendRichReportSequence(ownerChatId, payloads, {
    label: 'deletedTextRich',
    messageThreadId: options.messageThreadId,
    disableNotification: Boolean(options.disableNotification),
    replyToMessageId: options.replyToMessageId,
    rethrowTopicError: Boolean(options.rethrowTopicError),
    singlePartClassicFallback: async (classicOpts) => {
      const res = await sendClassicArchiveCopy(ownerChatId, record, headerHtml, {
        ...options,
        ...classicOpts,
        richDeleteMeta: undefined,
      });
      return res.ok ? res.message : null;
    },
  });
}

async function sendArchiveCopyInternal(ownerChatId, record, headerHtml, options) {
  const useRich = options.useRichTextReports ?? USE_RICH_TEXT_REPORTS;
  if (record.mediaType === 'text' && options.richDeleteMeta && useRich) {
    return await sendRichDeleteCopy(ownerChatId, record, headerHtml, options);
  }
  return await sendClassicArchiveCopy(ownerChatId, record, headerHtml, options);
}

/** Delivers an archived message copy with optional per-contact topic routing and self-healing. */
export async function sendArchiveCopy(ownerChatId, record, headerHtml, options = {}) {
  if (options.peer && options.messageThreadId === undefined) {
    return await sendWithPeerTopic(ownerChatId, options.peer, (threadId, isRetry) =>
      sendArchiveCopyInternal(ownerChatId, record, headerHtml, {
        ...options,
        messageThreadId: threadId,
        rethrowTopicError: Boolean(threadId) && !isRetry,
      })
    );
  }
  return await sendArchiveCopyInternal(ownerChatId, record, headerHtml, options);
}
