import { buildStructuredExtra } from './structured.js';

const VIEW_ONCE_MEDIA_TYPES = new Set(['photo', 'video', 'voice', 'video_note']);

const ORDERED_MEDIA_FIELDS = [
  // Check animation before document because Telegram includes both fields on GIFs.
  ['animation', 'animation'],
  ['video', 'video'],
  ['voice', 'voice'],
  ['video_note', 'video_note'],
  ['audio', 'audio'],
  ['sticker', 'sticker'],
  ['document', 'document'],
];

function buildMediaResult(mediaType, mediaObj, msg, extra) {
  return {
    mediaType,
    text: null,
    caption: typeof msg.caption === 'string' ? msg.caption : null,
    entities: null,
    captionEntities: Array.isArray(msg.caption_entities) ? msg.caption_entities : null,
    fileId: mediaObj.file_id ?? null,
    fileUniqueId: mediaObj.file_unique_id ?? null,
    fileSize: typeof mediaObj.file_size === 'number' ? mediaObj.file_size : null,
    fileName: mediaObj.file_name ?? null,
    mimeType: mediaObj.mime_type ?? null,
    mediaGroupId: typeof msg.media_group_id === 'string' ? msg.media_group_id : null,
    extra,
  };
}

/**
 * Normalizes a Telegram Message object into database-ready content fields.
 *
 * @param {object|null|undefined} msg
 * @returns {object}
 */
export function extractMessageContent(msg) {
  if (!msg || typeof msg !== 'object') {
    return {
      mediaType: 'view_once_placeholder',
      text: null,
      caption: null,
      entities: null,
      captionEntities: null,
      fileId: null,
      fileUniqueId: null,
      fileSize: null,
      fileName: null,
      mimeType: null,
      mediaGroupId: null,
      extra: null,
    };
  }

  const extra = buildStructuredExtra(msg);

  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    const largestPhoto = msg.photo[msg.photo.length - 1];
    return buildMediaResult('photo', largestPhoto, msg, extra);
  }

  for (const [field, mediaType] of ORDERED_MEDIA_FIELDS) {
    if (msg[field]) {
      return buildMediaResult(mediaType, msg[field], msg, extra);
    }
  }

  if (typeof msg.text === 'string') {
    return {
      mediaType: 'text',
      text: msg.text,
      caption: null,
      entities: Array.isArray(msg.entities) ? msg.entities : null,
      captionEntities: null,
      fileId: null,
      fileUniqueId: null,
      fileSize: null,
      fileName: null,
      mimeType: null,
      mediaGroupId: null,
      extra,
    };
  }

  const hasOtherStructuredContent = Boolean(extra && extra.kind);
  return {
    mediaType: hasOtherStructuredContent ? 'other' : 'view_once_placeholder',
    text: null,
    caption: typeof msg.caption === 'string' ? msg.caption : null,
    entities: null,
    captionEntities: Array.isArray(msg.caption_entities) ? msg.caption_entities : null,
    fileId: null,
    fileUniqueId: null,
    fileSize: null,
    fileName: null,
    mimeType: null,
    mediaGroupId: typeof msg.media_group_id === 'string' ? msg.media_group_id : null,
    extra,
  };
}

/**
 * Returns true if the extracted content holds a downloadable/forwardable view-once media type.
 *
 * @param {object|null|undefined} extracted
 * @returns {boolean}
 */
export function hasCapturableViewOnceMedia(extracted) {
  return Boolean(
    extracted &&
      extracted.fileId &&
      VIEW_ONCE_MEDIA_TYPES.has(extracted.mediaType)
  );
}

/**
 * Builds a complete `messages` table record from extracted message content.
 *
 * @param {object} params
 * @returns {object}
 */
export function buildMessageRecord({
  connectionId,
  chatId,
  senderId,
  senderName,
  isIncoming,
  messageId,
  content,
  editDate = null,
  createdAt = new Date(),
  viewOnceCapturedAt = null,
}) {
  return {
    businessConnectionId: connectionId,
    chatId,
    senderId,
    senderName,
    isIncoming,
    messageId,
    mediaGroupId: content.mediaGroupId,
    mediaType: content.mediaType,
    text: content.text,
    caption: content.caption,
    entities: content.entities,
    captionEntities: content.captionEntities,
    fileId: content.fileId,
    fileUniqueId: content.fileUniqueId,
    fileSize: content.fileSize,
    fileName: content.fileName,
    mimeType: content.mimeType,
    extra: content.extra,
    editDate,
    editHistory: [],
    createdAt,
    notifiedDeleteAt: null,
    viewOnceCapturedAt,
  };
}
