/**
 * Escapes HTML special characters for Telegram HTML parse_mode messages.
 *
 * @param {unknown} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a Telegram user or chat object into a plain-text display label with ID.
 *
 * @param {object|null|undefined} user
 * @param {object|null|undefined} chat
 * @returns {string}
 */
export function formatSenderRaw(user, chat) {
  const hasUserFields =
    user &&
    typeof user === 'object' &&
    (user.id != null || user.first_name || user.last_name || user.username || user.title);
  const source = hasUserFields ? user : chat;

  if (!source || typeof source !== 'object') {
    return 'Unknown';
  }

  const nameParts = [];
  if (source.first_name) nameParts.push(String(source.first_name).trim());
  if (source.last_name) nameParts.push(String(source.last_name).trim());

  const fullName =
    nameParts.filter(Boolean).join(' ') ||
    (source.title ? String(source.title).trim() : '');
  const username = source.username
    ? `@${String(source.username).replace(/^@/, '').trim()}`
    : '';
  const id = source.id ?? chat?.id;

  let base = 'Unknown';
  if (fullName && username) {
    base = `${fullName} (${username})`;
  } else if (fullName) {
    base = fullName;
  } else if (username) {
    base = username;
  }

  return id !== undefined && id !== null ? `${base} [${id}]` : base;
}

/**
 * Formats a Telegram user or chat object with HTML escaping applied.
 *
 * @param {object|null|undefined} user
 * @param {object|null|undefined} chat
 * @returns {string}
 */
export function formatSender(user, chat) {
  return escapeHtml(formatSenderRaw(user, chat));
}

/**
 * Summarizes a Telegram MessageOrigin object into a readable forward-source string.
 *
 * @param {object|null|undefined} origin
 * @returns {string|null}
 */
export function formatForwardOrigin(origin) {
  if (!origin || typeof origin !== 'object') return null;

  if (origin.type === 'user' && origin.sender_user) {
    return `User ${formatSenderRaw(origin.sender_user)}`;
  }
  if (origin.type === 'hidden_user') {
    return `Hidden user: ${origin.sender_user_name || 'Unknown'}`;
  }
  if (origin.type === 'chat' && origin.sender_chat) {
    const label = formatSenderRaw(null, origin.sender_chat);
    return origin.author_signature ? `${label} (${origin.author_signature})` : label;
  }
  if (origin.type === 'channel' && origin.chat) {
    const label = formatSenderRaw(null, origin.chat);
    const msgRef = typeof origin.message_id === 'number' ? ` #${origin.message_id}` : '';
    const sig = origin.author_signature ? ` (${origin.author_signature})` : '';
    return `Channel ${label}${msgRef}${sig}`;
  }
  return origin.type ? String(origin.type) : 'Unknown';
}
