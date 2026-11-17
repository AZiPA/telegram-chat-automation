import { MAX_TEXT_LENGTH } from '../config.js';

function normalizeEntities(entities) {
  if (!Array.isArray(entities) || entities.length === 0) return [];
  return entities.map((e) => ({
    type: e.type ?? null,
    offset: e.offset ?? 0,
    length: e.length ?? 0,
    url: e.url ?? null,
    custom_emoji_id: e.custom_emoji_id ?? null,
    language: e.language ?? null,
    userId: e.user?.id ?? null,
  }));
}

/**
 * Compares archived content against an edited payload, ignoring false-positive
 * updates such as auto-generated link previews where text/entities/media did not change.
 *
 * @param {object} oldRow
 * @param {object} newContent
 * @returns {boolean}
 */
export function isMeaningfulEdit(oldRow, newContent) {
  if (!oldRow || !newContent) return true;

  if ((oldRow.text ?? null) !== (newContent.text ?? null)) return true;
  if ((oldRow.caption ?? null) !== (newContent.caption ?? null)) return true;
  if ((oldRow.fileUniqueId ?? null) !== (newContent.fileUniqueId ?? null)) return true;
  if ((oldRow.mediaType ?? null) !== (newContent.mediaType ?? null)) return true;

  if (JSON.stringify(oldRow.extra ?? null) !== JSON.stringify(newContent.extra ?? null)) {
    return true;
  }

  if (
    JSON.stringify(normalizeEntities(oldRow.entities)) !==
    JSON.stringify(normalizeEntities(newContent.entities))
  ) {
    return true;
  }

  if (
    JSON.stringify(normalizeEntities(oldRow.captionEntities)) !==
    JSON.stringify(normalizeEntities(newContent.captionEntities))
  ) {
    return true;
  }

  return false;
}

/**
 * Splits long text into chunks <= `maxLen` UTF-16 code units, preferring line/space
 * boundaries and never splitting between UTF-16 high/low surrogate pairs.
 *
 * @param {unknown} text
 * @param {number} [maxLen]
 * @returns {string[]}
 */
export function splitTextSafely(text, maxLen = MAX_TEXT_LENGTH) {
  if (text === null || text === undefined) return [];
  const str = String(text);
  if (str.length === 0) return [];
  if (str.length <= maxLen) return [str];

  const chunks = [];
  let start = 0;

  while (start < str.length) {
    if (str.length - start <= maxLen) {
      const tail = str.slice(start);
      if (tail.trim().length > 0) chunks.push(tail);
      break;
    }

    const minPreferred = start + Math.floor(maxLen / 2);
    let splitIdx = start + maxLen;
    let snappedBoundary = false;

    const nlIdx = str.lastIndexOf('\n', start + maxLen);
    if (nlIdx >= minPreferred) {
      splitIdx = nlIdx;
      snappedBoundary = true;
    } else {
      const spaceIdx = str.lastIndexOf(' ', start + maxLen);
      if (spaceIdx >= minPreferred) {
        splitIdx = spaceIdx;
        snappedBoundary = true;
      }
    }

    // Never split between a UTF-16 high surrogate (0xD800-0xDBFF) and low surrogate.
    if (splitIdx > start && splitIdx < str.length) {
      const prevCode = str.charCodeAt(splitIdx - 1);
      if (prevCode >= 0xd800 && prevCode <= 0xdbff) {
        splitIdx -= 1;
        snappedBoundary = false;
      }
    }

    if (splitIdx <= start) {
      splitIdx = Math.min(str.length, start + Math.max(2, maxLen));
      snappedBoundary = false;
    }

    const part = str.slice(start, splitIdx);
    if (part.trim().length > 0) {
      chunks.push(part);
    }

    start = snappedBoundary ? splitIdx + 1 : splitIdx;
  }

  return chunks;
}

/**
 * Prepends a prefix to text and shifts all Telegram entity offsets by the prefix's
 * UTF-16 length (dropping entities if the combined length exceeds Telegram's 4096 cap).
 *
 * @param {string} prefix
 * @param {string} text
 * @param {Array|null|undefined} entities
 * @returns {{ text: string, entities: Array|undefined }}
 */
export function prependPrefixWithEntities(prefix, text, entities) {
  const safePrefix = typeof prefix === 'string' ? prefix : '';
  const safeText = typeof text === 'string' ? text : '';
  const fullText = `${safePrefix}${safeText}`;

  if (fullText.length > MAX_TEXT_LENGTH) {
    return { text: fullText, entities: undefined };
  }

  if (Array.isArray(entities) && entities.length > 0) {
    const shift = safePrefix.length;
    return {
      text: fullText,
      entities: entities.map((e) => ({
        ...e,
        offset: (e.offset ?? 0) + shift,
      })),
    };
  }

  return { text: fullText, entities: undefined };
}
