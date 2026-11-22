import { db } from 'sdk';
import { eq, ne } from 'sdk/db';
import { connections, contactTopics, settings } from '../schema.js';

export const RETENTION_DAYS = 30;
export const RAW_UPDATES_RETENTION_DAYS = 3;
export const DELETE_TRIGGER_REPLY = true;
export const DEFAULT_VIEW_ONCE_TRIGGER = '.';
export const MAX_TRIGGER_LENGTH = 32;
export const CAPTURE_UNARCHIVED_REPLIES = true;
export const NOTIFY_UNARCHIVED_DELETES = true;
export const DEBUG_RAW_UPDATES = false;
export const MAX_GETFILE_BYTES = 20 * 1024 * 1024;
export const MAX_DELETE_BATCH = 25;

export const MAX_TEXT_LENGTH = 4096;
export const MAX_DIGEST_LENGTH = 4000;
export const MAX_CAPTION_LENGTH = 1024;

export const USE_RICH_TEXT_REPORTS = true;
export const RICH_MAX_UTF8_BYTES = 28000;
export const RICH_MAX_BLOCKS = 400;
export const RICH_MAX_NESTING = 16;

export const SETTINGS_KEYS = {
  OWNER_ID: 'owner_id',
  VIEW_ONCE_TRIGGER: 'view_once_trigger',
  VIEW_ONCE_AUTODELETE: 'view_once_autodelete',
  TOPICS_DISABLED_UNTIL: 'topics_disabled_until',
};

const OWNER_ID_SETTING_KEY = SETTINGS_KEYS.OWNER_ID;

/**
 * Coerces a number or canonical positive integer string into a positive safe integer.
 *
 * @param {unknown} value
 * @returns {number|null}
 */
function parsePositiveSafeInt(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

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
    .where(eq(settings.key, OWNER_ID_SETTING_KEY))
    .get();

  return parsePositiveSafeInt(row?.value);
}

/**
 * Validates and persists the configured owner's numeric Telegram user ID in the `settings` table,
 * cleaning up stale owner-scoped state (contact topics, connections, and topic cooldown) on rotation
 * or orphan recovery while leaving archived `messages` untouched.
 *
 * @param {unknown} ownerId
 * @returns {Promise<void>}
 */
export async function setOwnerId(ownerId) {
  const id = parsePositiveSafeInt(ownerId);
  if (id === null) {
    throw new Error('Invalid owner_id: must be a positive safe integer');
  }

  const previousOwnerId = await getOwnerId();
  const now = new Date();

  await db
    .insert(settings)
    .values({ key: OWNER_ID_SETTING_KEY, value: String(id), updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(id), updatedAt: now },
    })
    .run();

  await db
    .delete(contactTopics)
    .where(ne(contactTopics.ownerId, id))
    .run();

  await db
    .delete(connections)
    .where(ne(connections.ownerUserId, id))
    .run();

  if (previousOwnerId !== id) {
    await db
      .delete(settings)
      .where(eq(settings.key, SETTINGS_KEYS.TOPICS_DISABLED_UNTIL))
      .run();
  }
}

/**
 * Synchronously checks whether a user ID matches a pre-resolved owner ID.
 *
 * @param {unknown} userId
 * @param {number|string|null|undefined} resolvedOwnerId
 * @returns {boolean}
 */
export function isOwner(userId, resolvedOwnerId) {
  const owner = parsePositiveSafeInt(resolvedOwnerId);
  const user = parsePositiveSafeInt(userId);
  return (
    Number.isSafeInteger(owner) &&
    owner > 0 &&
    Number.isSafeInteger(user) &&
    user === owner
  );
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

const TG_TIME_FORMAT_RE = /^(r|w?[dD]?[tT]?)$/;
const TG_TIME_MAX_UNIX = 2147483647;
const TG_TIME_MAX_FUTURE_DAYS = 1097;
const TG_TIME_MAX_FALLBACK_LENGTH = 31;

/**
 * Parses a Date, unix seconds/milliseconds number, or timestamp string into a positive Date.
 * Returns `null` for unset, non-positive, or invalid inputs.
 *
 * @param {unknown} value
 * @returns {Date|null}
 */
function parseTimestampDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    typeof value === 'boolean'
  ) {
    return null;
  }

  let date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    date = new Date(value > 1e12 ? value : value * 1000);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (!Number.isFinite(numeric) || numeric <= 0) return null;
      date = new Date(numeric > 1e12 ? numeric : numeric * 1000);
    } else {
      const parsedMs = Date.parse(trimmed);
      if (!Number.isFinite(parsedMs)) return null;
      date = new Date(parsedMs);
    }
  } else {
    return null;
  }

  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return null;
  return date;
}

/**
 * Formats a validated positive Date as `YYYY-MM-DD HH:mm:ss UTC`.
 *
 * @param {Date} date
 * @returns {string}
 */
function formatUtcTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

/**
 * Formats a timestamp (Date, unix seconds/milliseconds, or timestamp string) in UTC,
 * returning `'Unknown'` for unset, non-positive, or invalid inputs.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function formatTimestamp(value) {
  const date = parseTimestampDate(value);
  return date ? formatUtcTimestamp(date) : 'Unknown';
}

/**
 * Formats a timestamp for Telegram `HTML` parse_mode using `<tg-time>` so clients
 * render it in the recipient's local timezone, falling back to plain UTC text when
 * the format or timestamp exceeds Telegram's `date_time` entity limits.
 * Returns pre-formatted HTML-safe markup that must be interpolated raw (never via `escapeHtml`).
 *
 * @param {unknown} value
 * @param {string} [format='dT']
 * @returns {string}
 */
export function formatHtmlTimestamp(value, format = 'dT') {
  const date = parseTimestampDate(value);
  if (!date) return 'Unknown';

  const fallback = formatUtcTimestamp(date);
  if (typeof format !== 'string' || format.length === 0 || !TG_TIME_FORMAT_RE.test(format)) {
    return fallback;
  }

  const unixSeconds = Math.floor(date.getTime() / 1000);
  const maxSafeUnix = Math.floor(Date.now() / 1000) + TG_TIME_MAX_FUTURE_DAYS * 86400;
  if (
    !Number.isInteger(unixSeconds) ||
    unixSeconds <= 0 ||
    unixSeconds > TG_TIME_MAX_UNIX ||
    unixSeconds > maxSafeUnix ||
    fallback.length > TG_TIME_MAX_FALLBACK_LENGTH
  ) {
    return fallback;
  }

  return `<tg-time unix="${unixSeconds}" format="${format}">${fallback}</tg-time>`;
}

export function getMediaTypeLabel(mediaType) {
  return MEDIA_TYPE_LABELS[mediaType] || MEDIA_TYPE_LABELS.other;
}
