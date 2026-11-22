import {
  HEADERS,
  LABELS,
  MAX_TEXT_LENGTH,
  USE_RICH_TEXT_REPORTS,
  formatHtmlTimestamp,
  getMediaTypeLabel,
} from '../config.js';
import {
  buildEditHeaderLines,
  getDisplayTextAndEntities,
  tryBuildCompactEditHtml,
} from '../media/editFormat.js';
import { escapeHtml } from '../media/formatting.js';
import { prependPrefixWithEntities } from '../media/textEdit.js';
import { buildRichEditPayloads, buildRichUnarchivedEditPayloads } from '../rich/editFormat.js';
import { mediaSupportsCaption, sendArchiveCopy } from './archiveCopy.js';
import { sendHtmlMessage, sendTextSafely } from './client.js';
import { sendRichReportSequence } from './richSequence.js';
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
  if (!record.fileId) return null;

  if (mediaSupportsCaption(record.mediaType)) {
    return await sendArchiveCopy(
      ownerChatId,
      { ...record, caption: captionText, captionEntities: null },
      null,
      { ...deliveryOpts, replyToMessageId: headerId }
    );
  }

  const labelMsg = await sendHtmlMessage(ownerChatId, labelHtml, {
    ...deliveryOpts,
    replyToMessageId: headerId,
    label: 'editedMediaLabel',
  });
  return await sendArchiveCopy(
    ownerChatId,
    { ...record, caption: null, captionEntities: null },
    null,
    { ...deliveryOpts, replyToMessageId: labelMsg?.message_id ?? headerId }
  );
}

function buildUnarchivedHeaderHtml(record, senderRaw, chatRaw, editedAt) {
  const lines = [
    HEADERS.editedUnarchivedMessage,
    `${LABELS.sender}: ${escapeHtml(senderRaw)}`,
    `${LABELS.chat}: ${escapeHtml(chatRaw)}`,
    `${LABELS.mediaType}: ${escapeHtml(getMediaTypeLabel(record.mediaType))}`,
    `${LABELS.editedAt}: ${formatHtmlTimestamp(editedAt)}`,
  ];
  if (record.extra?.forwardOrigin) {
    lines.push(`${LABELS.forwardOrigin}: ${escapeHtml(record.extra.forwardOrigin)}`);
  }
  lines.push(LABELS.divider);
  return lines.join('\n');
}

async function withEditTopic(ownerChatId, options, fn) {
  if (options.peer && options.messageThreadId === undefined) {
    return await sendWithPeerTopic(ownerChatId, options.peer, (threadId, isRetry) =>
      fn({
        messageThreadId: threadId,
        disableNotification: true,
        rethrowTopicError: Boolean(threadId) && !isRetry,
      })
    );
  }
  return await fn({
    messageThreadId: options.messageThreadId,
    disableNotification: true,
    rethrowTopicError: Boolean(options.rethrowTopicError),
  });
}

async function sendClassicEditDiff(ownerChatId, storedRow, newContent, headerLines, compactHtml, mediaChanged, deliveryOpts) {
  if (compactHtml) {
    const sent = await sendHtmlMessage(ownerChatId, compactHtml, { ...deliveryOpts, label: 'editedCompact' });
    return { ok: Boolean(sent), message: sent ?? null };
  }

  const headerMsg = await sendHtmlMessage(ownerChatId, [...headerLines, LABELS.divider].join('\n'), {
    ...deliveryOpts,
    label: 'editedHeader',
  });
  const headerId = headerMsg?.message_id;
  const beforePart = getDisplayTextAndEntities(storedRow);
  const afterPart = getDisplayTextAndEntities(newContent);

  const beforeRes = await sendPreparedEditPart(
    ownerChatId,
    prependPrefixWithEntities('🔴 Before:\n', beforePart.text, beforePart.entities),
    headerId,
    deliveryOpts
  );
  const afterRes = await sendPreparedEditPart(
    ownerChatId,
    prependPrefixWithEntities('🟢 After:\n', afterPart.text, afterPart.entities),
    headerId,
    deliveryOpts
  );

  let allOk = Boolean(headerMsg) && beforeRes.ok && afterRes.ok;
  let lastMsg = afterRes.message ?? beforeRes.message ?? headerMsg ?? null;

  if (mediaChanged) {
    const copies = [
      await sendLabeledMediaCopy(ownerChatId, storedRow, '🔴 Previous media', HEADERS.editedPreviousMedia, headerId, deliveryOpts),
      await sendLabeledMediaCopy(ownerChatId, newContent, '🟢 New media', HEADERS.editedNewMedia, headerId, deliveryOpts),
    ];
    for (const copy of copies) {
      if (!copy) continue;
      allOk = allOk && copy.ok;
      if (copy.message) lastMsg = copy.message;
    }
  }

  return { ok: allOk, message: lastMsg };
}

/** Reports an edit to an unarchived pre-bot message silently inside the contact's topic. */
export async function deliverUnarchivedEditReport(ownerChatId, record, senderRaw, chatRaw, editedAt, options = {}) {
  const headerHtml = buildUnarchivedHeaderHtml(record, senderRaw, chatRaw, editedAt);
  const useRich = options.useRichTextReports ?? USE_RICH_TEXT_REPORTS;

  if (!useRich || record.mediaType !== 'text') {
    const res = await sendArchiveCopy(ownerChatId, record, headerHtml, {
      peer: options.peer,
      messageThreadId: options.messageThreadId,
      rethrowTopicError: options.rethrowTopicError,
      disableNotification: true,
    });
    return { ok: Boolean(res?.ok), message: res?.message ?? null };
  }

  const payloads = buildRichUnarchivedEditPayloads({
    text: record.text,
    entities: record.entities,
    senderLabel: senderRaw || record.senderName || 'Unknown',
    chatLabel: chatRaw,
    editedAt,
    messageId: record.messageId,
    forwardOrigin: record.extra?.forwardOrigin ?? null,
    isRichMessage: Boolean(record.extra?.isRichMessage),
  });

  return await withEditTopic(ownerChatId, options, (deliveryOpts) =>
    sendRichReportSequence(ownerChatId, payloads, {
      ...deliveryOpts,
      label: 'editedUnarchivedRich',
      singlePartClassicFallback: async (classicOpts) => {
        const res = await sendArchiveCopy(ownerChatId, record, headerHtml, {
          ...classicOpts,
          disableNotification: true,
        });
        return res.ok ? res.message : null;
      },
    })
  );
}

/** Delivers an edit report silently using Rich Messages (for text-only edits) or classic Bot API modes. */
export async function deliverEditDiffReport(ownerChatId, storedRow, newContent, senderRaw, chatRaw, editedAt, options = {}) {
  const mediaChanged = (storedRow.fileUniqueId ?? null) !== (newContent.fileUniqueId ?? null);
  const headerLines = buildEditHeaderLines(storedRow, newContent, senderRaw, chatRaw, editedAt, mediaChanged);
  const compactHtml = tryBuildCompactEditHtml(headerLines, storedRow, newContent);
  const useRich = options.useRichTextReports ?? USE_RICH_TEXT_REPORTS;
  const isTextOnlyEdit = storedRow.mediaType === 'text' && newContent.mediaType === 'text' && !mediaChanged;

  return await withEditTopic(ownerChatId, options, async (deliveryOpts) => {
    if (!useRich || !isTextOnlyEdit) {
      return await sendClassicEditDiff(ownerChatId, storedRow, newContent, headerLines, compactHtml, mediaChanged, deliveryOpts);
    }

    const payloads = buildRichEditPayloads({
      oldText: storedRow.text,
      oldEntities: storedRow.entities,
      newText: newContent.text,
      newEntities: newContent.entities,
      senderLabel: senderRaw || storedRow.senderName || 'Unknown',
      chatLabel: chatRaw,
      editedAt,
      messageId: storedRow.messageId,
      forwardOrigin: newContent.extra?.forwardOrigin || storedRow.extra?.forwardOrigin || null,
      isRichMessage: Boolean(storedRow.extra?.isRichMessage || newContent.extra?.isRichMessage),
    });

    return await sendRichReportSequence(ownerChatId, payloads, {
      ...deliveryOpts,
      label: 'editedDiffRich',
      singlePartClassicFallback: async (classicOpts) => {
        const res = await sendClassicEditDiff(
          ownerChatId,
          storedRow,
          newContent,
          headerLines,
          compactHtml,
          mediaChanged,
          { ...classicOpts, disableNotification: true }
        );
        return res.ok ? res.message : null;
      },
    });
  });
}
