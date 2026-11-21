import { HEADERS, LABELS, MAX_TEXT_LENGTH, formatHtmlTimestamp, getMediaTypeLabel } from '../config.js';
import { escapeHtml } from './formatting.js';

/** Extracts display text and entity list from an archived or newly edited record. */
export function getDisplayTextAndEntities(record) {
  if (record.mediaType === 'text') {
    const hasText = typeof record.text === 'string' && record.text.length > 0;
    return {
      text: hasText ? record.text : LABELS.emptyText,
      entities: hasText ? record.entities ?? null : null,
    };
  }
  if (typeof record.caption === 'string' && record.caption.length > 0) {
    return { text: record.caption, entities: record.captionEntities ?? null };
  }
  if (record.extra?.summary) {
    return { text: record.extra.summary, entities: null };
  }
  return { text: LABELS.emptyText, entities: null };
}

/** Builds HTML header lines for an edit notification. */
export function buildEditHeaderLines(storedRow, newContent, senderRaw, chatRaw, editedAt, mediaChanged) {
  const lines = [
    HEADERS.editedMessage,
    `${LABELS.sender}: ${escapeHtml(senderRaw || storedRow.senderName || 'Unknown')}`,
    `${LABELS.chat}: ${escapeHtml(chatRaw)}`,
    `${LABELS.editedAt}: ${formatHtmlTimestamp(editedAt)}`,
  ];
  if (mediaChanged) {
    lines.push(
      `${LABELS.mediaType}: ${escapeHtml(getMediaTypeLabel(storedRow.mediaType))} → ${escapeHtml(getMediaTypeLabel(newContent.mediaType))}`
    );
  }
  const forwardOrigin = newContent.extra?.forwardOrigin || storedRow.extra?.forwardOrigin;
  if (forwardOrigin) {
    lines.push(`${LABELS.forwardOrigin}: ${escapeHtml(forwardOrigin)}`);
  }
  return lines;
}

/** Returns a single-message expandable HTML diff for plain short text edits, or null otherwise. */
export function tryBuildCompactEditHtml(headerLines, storedRow, newContent) {
  const oldEntitiesLen = Array.isArray(storedRow.entities) ? storedRow.entities.length : 0;
  const newEntitiesLen = Array.isArray(newContent.entities) ? newContent.entities.length : 0;
  const oldText = typeof storedRow.text === 'string' ? storedRow.text : '';
  const newText = typeof newContent.text === 'string' ? newContent.text : '';

  if (
    storedRow.mediaType !== 'text' ||
    newContent.mediaType !== 'text' ||
    oldEntitiesLen > 0 ||
    newEntitiesLen > 0 ||
    oldText.length + newText.length > 3000
  ) {
    return null;
  }

  const oldDisplay = oldText.length > 0 ? oldText : LABELS.emptyText;
  const newDisplay = newText.length > 0 ? newText : LABELS.emptyText;
  const html = [
    headerLines.join('\n'),
    '',
    `<blockquote expandable>🔴 <b>Before:</b>\n<s>${escapeHtml(oldDisplay)}</s>\n\n🟢 <b>After:</b>\n<b>${escapeHtml(newDisplay)}</b></blockquote>`,
  ].join('\n');

  return html.length <= MAX_TEXT_LENGTH ? html : null;
}
