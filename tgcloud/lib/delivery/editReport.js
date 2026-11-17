import {
  HEADERS,
  LABELS,
  MAX_TEXT_LENGTH,
  formatTimestamp,
  getMediaTypeLabel,
} from '../config.js';
import { escapeHtml } from '../media/formatting.js';
import { prependPrefixWithEntities } from '../media/textEdit.js';
import { mediaSupportsCaption, sendArchiveCopy } from './archiveCopy.js';
import { sendHtmlMessage, sendTextSafely } from './client.js';

function getDisplayTextAndEntities(record) {
  if (record.mediaType === 'text') {
    const hasText = typeof record.text === 'string' && record.text.length > 0;
    return {
      text: hasText ? record.text : LABELS.emptyText,
      entities: hasText ? record.entities ?? null : null,
    };
  }
  if (typeof record.caption === 'string' && record.caption.length > 0) {
    return {
      text: record.caption,
      entities: record.captionEntities ?? null,
    };
  }
  if (record.extra?.summary) {
    return {
      text: record.extra.summary,
      entities: null,
    };
  }
  return {
    text: LABELS.emptyText,
    entities: null,
  };
}

async function sendPreparedEditPart(chatId, prepared, replyToMessageId) {
  const entities =
    prepared.text.length <= MAX_TEXT_LENGTH ? prepared.entities : undefined;
  return await sendTextSafely(chatId, prepared.text, {
    replyToMessageId,
    maxLen: MAX_TEXT_LENGTH,
    entities,
  });
}

async function sendLabeledMediaCopy(ownerChatId, record, captionText, labelHtml, headerId) {
  if (!record.fileId) return;

  if (mediaSupportsCaption(record.mediaType)) {
    await sendArchiveCopy(
      ownerChatId,
      { ...record, caption: captionText, captionEntities: null },
      null,
      { replyToMessageId: headerId }
    );
    return;
  }

  const labelMsg = await sendHtmlMessage(ownerChatId, labelHtml, {
    replyToMessageId: headerId,
    label: 'editedMediaLabel',
  });
  await sendArchiveCopy(
    ownerChatId,
    { ...record, caption: null, captionEntities: null },
    null,
    { replyToMessageId: labelMsg?.message_id ?? headerId }
  );
}

/**
 * Reports an edit to an unarchived pre-bot message along with its current snapshot.
 */
export async function deliverUnarchivedEditReport(
  ownerChatId,
  record,
  senderRaw,
  chatRaw,
  editedAt
) {
  const lines = [
    HEADERS.editedUnarchivedMessage,
    `${LABELS.sender}: ${escapeHtml(senderRaw)}`,
    `${LABELS.chat}: ${escapeHtml(chatRaw)}`,
    `${LABELS.mediaType}: ${escapeHtml(getMediaTypeLabel(record.mediaType))}`,
    `${LABELS.editedAt}: ${escapeHtml(formatTimestamp(editedAt))}`,
  ];
  if (record.extra?.forwardOrigin) {
    lines.push(`${LABELS.forwardOrigin}: ${escapeHtml(record.extra.forwardOrigin)}`);
  }
  lines.push(LABELS.divider);

  await sendArchiveCopy(ownerChatId, record, lines.join('\n'));
}

/**
 * Delivers the Before/After text diff (with entity offset shifting) and optional
 * previous/new media copies when a file was replaced.
 */
export async function deliverEditDiffReport(
  ownerChatId,
  storedRow,
  newContent,
  senderRaw,
  chatRaw,
  editedAt
) {
  const mediaChanged =
    (storedRow.fileUniqueId ?? null) !== (newContent.fileUniqueId ?? null);

  const headerLines = [
    HEADERS.editedMessage,
    `${LABELS.sender}: ${escapeHtml(senderRaw || storedRow.senderName || 'Unknown')}`,
    `${LABELS.chat}: ${escapeHtml(chatRaw)}`,
    `${LABELS.editedAt}: ${escapeHtml(formatTimestamp(editedAt))}`,
  ];
  if (mediaChanged) {
    headerLines.push(
      `${LABELS.mediaType}: ${escapeHtml(getMediaTypeLabel(storedRow.mediaType))} → ${escapeHtml(getMediaTypeLabel(newContent.mediaType))}`
    );
  }
  const forwardOrigin = newContent.extra?.forwardOrigin || storedRow.extra?.forwardOrigin;
  if (forwardOrigin) {
    headerLines.push(`${LABELS.forwardOrigin}: ${escapeHtml(forwardOrigin)}`);
  }
  headerLines.push(LABELS.divider);

  const headerMsg = await sendHtmlMessage(ownerChatId, headerLines.join('\n'), {
    label: 'editedHeader',
  });
  const headerId = headerMsg?.message_id;

  const beforePart = getDisplayTextAndEntities(storedRow);
  const afterPart = getDisplayTextAndEntities(newContent);

  await sendPreparedEditPart(
    ownerChatId,
    prependPrefixWithEntities('🔴 Before:\n', beforePart.text, beforePart.entities),
    headerId
  );
  await sendPreparedEditPart(
    ownerChatId,
    prependPrefixWithEntities('🟢 After:\n', afterPart.text, afterPart.entities),
    headerId
  );

  if (mediaChanged) {
    await sendLabeledMediaCopy(
      ownerChatId,
      storedRow,
      '🔴 Previous media',
      HEADERS.editedPreviousMedia,
      headerId
    );
    await sendLabeledMediaCopy(
      ownerChatId,
      newContent,
      '🟢 New media',
      HEADERS.editedNewMedia,
      headerId
    );
  }
}
