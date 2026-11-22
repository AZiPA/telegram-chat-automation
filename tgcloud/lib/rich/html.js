const SIMPLE_ENTITY_TAGS = {
  bold: ['<b>', '</b>'],
  italic: ['<i>', '</i>'],
  underline: ['<u>', '</u>'],
  strikethrough: ['<s>', '</s>'],
  spoiler: ['<tg-spoiler>', '</tg-spoiler>'],
};

const LEAF_FORBIDDEN_TYPES = new Set(['code', 'pre', 'date_time', 'custom_emoji']);
const SAFE_URL_SCHEME_RE = /^(?:https?:\/\/|mailto:|tel:|tg:)/i;

/**
 * Escapes HTML special characters compatibly with both Telegram Rich HTML and classic HTML.
 *
 * @param {unknown} str
 * @returns {string}
 */
export function escapeRichHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes plain text for Rich HTML and converts line breaks (`\r\n` / `\n`) to `<br>`.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function textToRichHtml(text) {
  if (text === null || text === undefined) return '';
  return escapeRichHtml(text).replace(/\r\n|\n/g, '<br>');
}

function normalizeSafeHref(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  if (!SAFE_URL_SCHEME_RE.test(trimmed)) return null;
  return trimmed;
}

export function formatInlineCodeSpan(slice) {
  const lines = slice.split(/\r\n|\n/);
  return lines
    .map((line) => (line.length > 0 ? `<code>${escapeRichHtml(line)}</code>` : ''))
    .join('<br>');
}

export function resolveEntityTags(entity, isTopLevel, parentHasLink) {
  const simple = SIMPLE_ENTITY_TAGS[entity.type];
  if (simple) {
    return {
      openTag: simple[0],
      closeTag: simple[1],
      isLeafForbidden: false,
      hasLink: parentHasLink,
      mode: 'wrap',
    };
  }

  if (entity.type === 'code' || entity.type === 'pre') {
    return {
      openTag: '',
      closeTag: '',
      isLeafForbidden: true,
      hasLink: parentHasLink,
      mode: 'code',
    };
  }

  if (entity.type === 'text_link') {
    const safeHref = normalizeSafeHref(entity.url);
    if (!safeHref) {
      return {
        openTag: '',
        closeTag: '',
        isLeafForbidden: false,
        hasLink: parentHasLink,
        mode: 'wrap',
      };
    }
    if (parentHasLink) return null;
    return {
      openTag: `<a href="${escapeRichHtml(safeHref)}">`,
      closeTag: '</a>',
      isLeafForbidden: false,
      hasLink: true,
      mode: 'wrap',
    };
  }

  if (entity.type === 'text_mention') {
    const userId = entity.user?.id;
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return {
        openTag: '',
        closeTag: '',
        isLeafForbidden: false,
        hasLink: parentHasLink,
        mode: 'wrap',
      };
    }
    if (parentHasLink) return null;
    return {
      openTag: `<a href="tg://user?id=${userId}">`,
      closeTag: '</a>',
      isLeafForbidden: false,
      hasLink: true,
      mode: 'wrap',
    };
  }

  if (entity.type === 'custom_emoji') {
    const emojiId = typeof entity.custom_emoji_id === 'string' ? entity.custom_emoji_id : '';
    if (!/^\d+$/.test(emojiId)) {
      return {
        openTag: '',
        closeTag: '',
        isLeafForbidden: true,
        hasLink: parentHasLink,
        mode: 'wrap',
      };
    }
    return {
      openTag: `<tg-emoji emoji-id="${emojiId}">`,
      closeTag: '</tg-emoji>',
      isLeafForbidden: true,
      hasLink: parentHasLink,
      mode: 'wrap',
    };
  }

  if (entity.type === 'date_time') {
    const hasValidUnix =
      typeof entity.unix_time === 'number' &&
      Number.isFinite(entity.unix_time) &&
      entity.unix_time > 0;
    return {
      openTag: '',
      closeTag: '',
      isLeafForbidden: true,
      hasLink: parentHasLink,
      mode: isTopLevel && hasValidUnix ? 'date_time' : 'wrap',
    };
  }

  return {
    openTag: '',
    closeTag: '',
    isLeafForbidden: LEAF_FORBIDDEN_TYPES.has(entity.type),
    hasLink: parentHasLink,
    mode: 'wrap',
  };
}
