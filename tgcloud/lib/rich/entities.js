import { RICH_MAX_NESTING, formatHtmlTimestamp } from '../config.js';
import { formatInlineCodeSpan, resolveEntityTags, textToRichHtml } from './html.js';

function splitsSurrogatePair(str, index) {
  if (index <= 0 || index >= str.length) return false;
  const prev = str.charCodeAt(index - 1);
  const curr = str.charCodeAt(index);
  return prev >= 0xd800 && prev <= 0xdbff && curr >= 0xdc00 && curr <= 0xdfff;
}

/**
 * Converts Telegram UTF-16 `MessageEntity` spans into valid inline Rich HTML.
 * Returns `null` if offsets are invalid, split surrogate pairs, partially overlap,
 * violate nesting constraints, or exceed `RICH_MAX_NESTING`.
 *
 * @param {string} text
 * @param {Array<object>} [entities=[]]
 * @returns {string|null}
 */
export function entitiesToRichHtml(text, entities = []) {
  if (text === null || text === undefined) return '';
  const str = String(text);
  if (!Array.isArray(entities) || entities.length === 0) {
    return textToRichHtml(str);
  }

  const normalized = [];
  for (let i = 0; i < entities.length; i += 1) {
    const entity = entities[i];
    if (!entity || typeof entity !== 'object') return null;

    const { offset, length } = entity;
    if (
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length <= 0 ||
      offset + length > str.length
    ) {
      return null;
    }

    const end = offset + length;
    if (splitsSurrogatePair(str, offset) || splitsSurrogatePair(str, end)) {
      return null;
    }
    normalized.push({ entity, start: offset, end, index: i });
  }

  normalized.sort((a, b) => a.start - b.start || b.end - a.end || a.index - b.index);

  const stack = [];
  const parts = [];
  let cursor = 0;

  const closeFramesUpTo = (pos) => {
    while (stack.length > 0 && stack[stack.length - 1].end <= pos) {
      const frame = stack.pop();
      if (!frame.renderedWholeSpan && cursor < frame.end) {
        parts.push(textToRichHtml(str.slice(cursor, frame.end)));
        cursor = frame.end;
      }
      if (frame.closeTag) {
        parts.push(frame.closeTag);
      }
    }
  };

  for (const item of normalized) {
    closeFramesUpTo(item.start);

    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    if (parent) {
      if (item.end > parent.end) return null;
      if (parent.isLeafForbidden) return null;
    }
    if (stack.length + 1 > RICH_MAX_NESTING) return null;

    const spec = resolveEntityTags(
      item.entity,
      stack.length === 0,
      Boolean(parent?.hasLink)
    );
    if (!spec) return null;

    if (cursor < item.start) {
      parts.push(textToRichHtml(str.slice(cursor, item.start)));
      cursor = item.start;
    }

    if (spec.mode === 'code') {
      parts.push(formatInlineCodeSpan(str.slice(item.start, item.end)));
      cursor = item.end;
      stack.push({
        end: item.end,
        closeTag: '',
        isLeafForbidden: true,
        hasLink: spec.hasLink,
        renderedWholeSpan: true,
      });
      continue;
    }

    if (spec.mode === 'date_time') {
      parts.push(
        formatHtmlTimestamp(
          item.entity.unix_time,
          item.entity.date_time_format || 'dT'
        )
      );
      cursor = item.end;
      stack.push({
        end: item.end,
        closeTag: '',
        isLeafForbidden: true,
        hasLink: spec.hasLink,
        renderedWholeSpan: true,
      });
      continue;
    }

    if (spec.openTag) parts.push(spec.openTag);
    stack.push({
      end: item.end,
      closeTag: spec.closeTag,
      isLeafForbidden: spec.isLeafForbidden,
      hasLink: spec.hasLink,
      renderedWholeSpan: false,
    });
  }

  closeFramesUpTo(str.length);
  if (cursor < str.length) {
    parts.push(textToRichHtml(str.slice(cursor)));
  }

  return parts.join('');
}
