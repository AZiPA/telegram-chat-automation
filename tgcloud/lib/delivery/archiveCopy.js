import { api } from 'sdk';
import { LABELS, MAX_CAPTION_LENGTH, MAX_TEXT_LENGTH } from '../config.js';
import {
  buildReplyParams,
  safeCall,
  sendHtmlMessage,
  sendTextSafely,
} from './client.js';
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

/**
 * Returns true if the given Telegram media type accepts a `caption` parameter.
 *
 * @param {string} mediaType
 * @returns {boolean}
 */
export function mediaSupportsCaption(mediaType) {
  return Boolean(MEDIA_SEND_CONFIG[mediaType]?.supportsCaption);
}

async function sendMediaRecord(ownerChatId, record, replyTargetId, allowReuploadFallback) {
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
        ...replyParams,
      }),
    mediaConfig.method
  );

  if (!sentMedia && allowReuploadFallback) {
    sentMedia = await reuploadViewOnceMedia(
      ownerChatId,
      record,
      mediaConfig,
      captionParams,
      replyParams,
      replyTargetId
    );
  }

  if (!sentMedia) return { ok: false };

  if (mediaConfig.supportsCaption && captionTooLong) {
    await sendTextSafely(ownerChatId, rawCaption, {
      replyToMessageId: sentMedia.message_id ?? replyTargetId,
      entities: rawCaption.length <= MAX_TEXT_LENGTH ? record.captionEntities : undefined,
    });
  }

  return { ok: true, message: sentMedia };
}

/**
 * Delivers an archived message copy to the owner chat using two-step HTML header +
 * entity-preserving content delivery (and optional view-once InputFile re-upload).
 *
 * @param {number} ownerChatId
 * @param {object} record
 * @param {string|null} headerHtml
 * @param {{ replyToMessageId?: number, allowReuploadFallback?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, message?: object|null }>}
 */
export async function sendArchiveCopy(ownerChatId, record, headerHtml, options = {}) {
  const headerMsg = headerHtml
    ? await sendHtmlMessage(ownerChatId, headerHtml, { label: 'sendArchiveHeader' })
    : null;
  const replyTargetId = headerMsg?.message_id ?? options.replyToMessageId;

  if (MEDIA_SEND_CONFIG[record.mediaType] && record.fileId) {
    return await sendMediaRecord(
      ownerChatId,
      record,
      replyTargetId,
      options.allowReuploadFallback === true
    );
  }

  if (record.mediaType === 'text') {
    const body =
      typeof record.text === 'string' && record.text.length > 0
        ? record.text
        : LABELS.emptyText;
    return await sendTextSafely(ownerChatId, body, {
      replyToMessageId: replyTargetId,
      entities: record.text === body ? record.entities : undefined,
    });
  }

  if (record.mediaType === 'other') {
    const body =
      [record.extra?.summary, record.caption].filter(Boolean).join('\n\n') ||
      LABELS.otherContent;
    return await sendTextSafely(ownerChatId, body, { replyToMessageId: replyTargetId });
  }

  if (record.mediaType === 'view_once_placeholder') {
    const body = record.caption
      ? `${LABELS.viewOnceUnavailable}\n\n${record.caption}`
      : LABELS.viewOnceUnavailable;
    return await sendTextSafely(ownerChatId, body, { replyToMessageId: replyTargetId });
  }

  const fallbackBody = record.caption || record.text || LABELS.otherContent;
  return await sendTextSafely(ownerChatId, fallbackBody, { replyToMessageId: replyTargetId });
}
