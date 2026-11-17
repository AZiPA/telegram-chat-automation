import { db } from 'sdk';
import { eq } from 'sdk/db';
import { settings } from '../schema.js';

export const RETENTION_DAYS = 30;
export const RAW_UPDATES_RETENTION_DAYS = 3;
export const DELETE_TRIGGER_REPLY = true;
export const CAPTURE_UNARCHIVED_REPLIES = true;
export const NOTIFY_UNARCHIVED_DELETES = true;
export const DEBUG_RAW_UPDATES = false;
export const MAX_GETFILE_BYTES = 20 * 1024 * 1024;
export const MAX_DELETE_BATCH = 25;

export const MAX_TEXT_LENGTH = 4096;
export const MAX_DIGEST_LENGTH = 4000;
export const MAX_CAPTION_LENGTH = 1024;

/**
 * Resolves the configured owner's numeric Telegram user ID from the `settings` table.
 * Returns `null` (fail-closed) when not seeded or invalid.
 *
 * @returns {Promise<number|null>}
 */
export async function getOwnerId() {
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, 'owner_id'))
    .get();

  const id = Number(row?.value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Synchronously checks whether a user ID matches a pre-resolved owner ID.
 *
 * @param {unknown} userId
 * @param {number|null|undefined} resolvedOwnerId
 * @returns {boolean}
 */
export function isOwner(userId, resolvedOwnerId) {
  return Boolean(resolvedOwnerId && Number(userId) === Number(resolvedOwnerId));
}

export const HEADERS = {
  startTitle: '🤖 <b>Telegram Business Assistant Status</b>',
  connectionEnabled: '🔗 <b>Telegram Business Connected</b>',
  connectionDisabled: '🔌 <b>Telegram Business Disconnected</b>',
  deletedMessage: '🗑 <b>Message Deleted</b>',
  deletedBatch: '🗑 <b>Messages Deleted</b>',
  editedMessage: '✏️ <b>Message Edited</b>',
  editedUnarchivedMessage: '✏️ <b>Message Edited (Previous Version Not Archived)</b>',
  editedPreviousMedia: '🔴 <b>Previous Media</b>',
  editedNewMedia: '🟢 <b>New Media</b>',
  viewOnceCaptured: '👁 <b>View-Once Media Saved</b>',
};

export const LABELS = {
  sender: '👤 Sender',
  chat: '💬 Chat',
  count: '🔢 Count',
  messageId: '🆔 Message ID',
  sentAt: '🕒 Sent',
  editedAt: '🕒 Edited',
  deletedAt: '🕒 Deleted',
  updatedAt: '🕒 Last Updated',
  mediaType: '📦 Type',
  forwardOrigin: '↪️ Forwarded From',
  emptyText: '(empty text)',
  otherContent: '[Non-text / Other Content]',
  viewOnceUnavailable:
    '[View-once media — content was hidden by Telegram on initial delivery]',
  divider: '──────────────',
};

export const MEDIA_TYPE_LABELS = {
  text: 'Text',
  photo: 'Photo',
  video: 'Video',
  voice: 'Voice Message',
  document: 'Document',
  video_note: 'Video Note',
  audio: 'Audio',
  animation: 'GIF / Animation',
  sticker: 'Sticker',
  view_once_placeholder: 'View-Once Media',
  other: 'Other',
};

export const RIGHTS_CHECKLIST = [
  ['can_read_messages', 'Read messages (required for archiving)'],
  ['can_reply', 'Send and reply to messages'],
  ['can_delete_sent_messages', 'Delete messages sent by the bot'],
  ['can_delete_all_messages', 'Delete all messages (for auto-deleting trigger replies)'],
];

export function formatTimestamp(value) {
  if (value === null || value === undefined) return 'Unknown';

  const date =
    value instanceof Date
      ? value
      : typeof value === 'number'
        ? new Date(value > 1e12 ? value : value * 1000)
        : new Date(value);

  if (Number.isNaN(date.getTime())) return 'Unknown';

  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

export function getMediaTypeLabel(mediaType) {
  return MEDIA_TYPE_LABELS[mediaType] || MEDIA_TYPE_LABELS.other;
}
