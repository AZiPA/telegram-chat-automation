import { api, InputFile } from 'sdk';
import { MAX_GETFILE_BYTES } from '../config.js';
import {
  buildNotificationParams,
  buildThreadParams,
  safeCall,
  sendTextSafely,
} from './client.js';

const DEFAULT_FILE_META = {
  photo: { filename: 'photo.jpg', mimeType: 'image/jpeg' },
  video: { filename: 'video.mp4', mimeType: 'video/mp4' },
  voice: { filename: 'voice.ogg', mimeType: 'audio/ogg' },
  video_note: { filename: 'video_note.mp4', mimeType: 'video/mp4' },
  audio: { filename: 'audio.mp3', mimeType: 'audio/mpeg' },
  animation: { filename: 'animation.mp4', mimeType: 'video/mp4' },
  document: { filename: 'document.bin', mimeType: undefined },
  sticker: { filename: 'sticker.webp', mimeType: undefined },
};

function buildInputFile(bytes, record) {
  const defaults = DEFAULT_FILE_META[record.mediaType] || DEFAULT_FILE_META.document;
  const filename = record.fileName || defaults.filename;
  const mimeType = record.mimeType || defaults.mimeType;
  return mimeType
    ? new InputFile(bytes, filename, { type: mimeType })
    : new InputFile(bytes, filename);
}

/**
 * Downloads view-once media bytes via `getFileContent` (even when `fileSize` is null,
 * blocking only known sizes above Telegram's 20 MB cap) and re-uploads via `InputFile`.
 *
 * @param {number} ownerChatId
 * @param {object} record
 * @param {{ method: string, field: string }} mediaConfig
 * @param {object} captionParams
 * @param {object} replyParams
 * @param {number|undefined} replyTargetId
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export async function reuploadViewOnceMedia(
  ownerChatId,
  record,
  mediaConfig,
  captionParams,
  replyParams,
  replyTargetId,
  options = {}
) {
  const noticeOpts = {
    replyToMessageId: replyTargetId,
    messageThreadId: options.messageThreadId,
    disableNotification: options.disableNotification,
    rethrowTopicError: options.rethrowTopicError,
  };

  if (typeof record.fileSize === 'number' && record.fileSize > MAX_GETFILE_BYTES) {
    await sendTextSafely(
      ownerChatId,
      "⚠️ This media exceeds Telegram's 20 MB bot download limit and cannot be saved automatically.",
      noticeOpts
    );
    return null;
  }

  const bytes = await safeCall(() => api.getFileContent(record.fileId), 'getFileContent');
  if (!bytes) {
    await sendTextSafely(
      ownerChatId,
      '⚠️ Failed to download view-once media (it may have expired or become inaccessible).',
      noticeOpts
    );
    return null;
  }

  const inputFile = buildInputFile(bytes, record);
  const sentMedia = await safeCall(
    () =>
      api[mediaConfig.method]({
        chat_id: ownerChatId,
        [mediaConfig.field]: inputFile,
        ...captionParams,
        ...buildThreadParams(options.messageThreadId),
        ...buildNotificationParams(options.disableNotification),
        ...replyParams,
      }),
    `${mediaConfig.method}:reupload`,
    { rethrowTopicError: Boolean(options.rethrowTopicError) }
  );

  if (!sentMedia) {
    await sendTextSafely(
      ownerChatId,
      '⚠️ Failed to re-upload the view-once media to Telegram.',
      noticeOpts
    );
    return null;
  }

  return sentMedia;
}
