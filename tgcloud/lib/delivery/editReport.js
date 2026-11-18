import { HEADERS, LABELS, MAX_TEXT_LENGTH, formatTimestamp, getMediaTypeLabel } from '../config.js';
import {
  buildEditHeaderLines,
  getDisplayTextAndEntities,
  tryBuildCompactEditHtml,
} from '../media/editFormat.js';
import { escapeHtml } from '../media/formatting.js';
import { prependPrefixWithEntities } from '../media/textEdit.js';
import { mediaSupportsCaption, sendArchiveCopy } from './archiveCopy.js';
import { sendHtmlMessage, sendTextSafely } from './client.js';
import { sendWithPeerTopic } from './topics.js';

async function sendPreparedEditPart(chatId, prepared, replyToMessageId, deliveryOpts) {
  const entities = prepared.text.length <= MAX_TEXT_LENGTH ? prepared.entities : undefined;
  return await sendTextSafely(chatId, prepared.text, {
    ...deliveryOpts,
    replyToMessageId,
    maxLen: MAX_TEXT_LENGTH,
    entities,
  });
}

async function sendLabeledMediaCopy(ownerChatId, record, captionText, labelHtml, headerId, deliveryOpts) {
  if (!record.fileId) return;

  if (mediaSupportsCaption(record.mediaType)) {
    await sendArchiveCopy(
      ownerChatId,
      { ...record, caption: captionText, captionEntities: null },
      null,
      { ...deliveryOpts, replyToMessageId: headerId }
    );
    return;
  }

  const labelMsg = await sendHtmlMessage(ownerChatId, labelHtml, {
    ...deliveryOpts,
    replyToMessageId: headerId,
    label: 'editedMediaLabel',
  });
  await sendArchiveCopy(
    ownerChatId,
    { ...record, caption: null, captionEntities: null },
    null,
    { ...deliveryOpts, replyToMessageId: labelMsg?.message_id ?? headerId }
  );
}

/** Reports an edit to an unarchived pre-bot message silently inside the contact's topic. */
export async function deliverUnarchivedEditReport(ownerChatId, record, senderRaw, chatRaw, editedAt, options = {}) {
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

  await sendArchiveCopy(ownerChatId, record, lines.join('\n'), {
    peer: options.peer,
    disableNotification: true,
  });
}

/** Delivers an edit report silently using Compact 1-Message mode or 3-Message entity-preserving mode. */
export async function deliverEditDiffReport(ownerChatId, storedRow, newContent, senderRaw, chatRaw, editedAt, options = {}) {
  const mediaChanged = (storedRow.fileUniqueId ?? null) !== (newContent.fileUniqueId ?? null);
  const headerLines = buildEditHeaderLines(storedRow, newContent, senderRaw, chatRaw, editedAt, mediaChanged);
  const compactHtml = tryBuildCompactEditHtml(headerLines, storedRow, newContent);

  await sendWithPeerTopic(ownerChatId, options.peer, async (threadId, isRetry) => {
    const deliveryOpts = {
      messageThreadId: threadId,
      disableNotification: true,
      rethrowTopicError: Boolean(threadId) && !isRetry,
    };

    if (compactHtml) {
      await sendHtmlMessage(ownerChatId, compactHtml, { ...deliveryOpts, label: 'editedCompact' });
      return;
    }

    const headerMsg = await sendHtmlMessage(
      ownerChatId,
      [...headerLines, LABELS.divider].join('\n'),
      { ...deliveryOpts, label: 'editedHeader' }
    );
    const headerId = headerMsg?.message_id;

    const beforePart = getDisplayTextAndEntities(storedRow);
    const afterPart = getDisplayTextAndEntities(newContent);

    await sendPreparedEditPart(
      ownerChatId,
      prependPrefixWithEntities('🔴 Before:\n', beforePart.text, beforePart.entities),
      headerId,
      deliveryOpts
    );
    await sendPreparedEditPart(
      ownerChatId,
      prependPrefixWithEntities('🟢 After:\n', afterPart.text, afterPart.entities),
      headerId,
      deliveryOpts
    );

    if (mediaChanged) {
      await sendLabeledMediaCopy(ownerChatId, storedRow, '🔴 Previous media', HEADERS.editedPreviousMedia, headerId, deliveryOpts);
      await sendLabeledMediaCopy(ownerChatId, newContent, '🟢 New media', HEADERS.editedNewMedia, headerId, deliveryOpts);
    }
  });
}
