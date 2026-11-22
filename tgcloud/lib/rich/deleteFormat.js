import { HEADERS, LABELS, formatTimestamp } from '../config.js';
import {
  buildSingleOrChunkedPayloads,
  formatPlainFooter,
  formatReportTimestamp,
  renderMetaHeader,
  renderQuoteBlock,
  renderReportFooter,
} from './formatBlocks.js';
import { escapeRichHtml } from './html.js';

const PLAIN_DELETE_TITLE = '🗑 Message Deleted';

function buildDeleteMetaLines({ sender, chat, sentAt, deletedAt, forwardOrigin }, useHtmlTime) {
  const lines = [
    `${LABELS.sender}: ${escapeRichHtml(sender)}`,
    `${LABELS.chat}: ${escapeRichHtml(chat)}`,
    `${LABELS.sentAt}: ${formatReportTimestamp(sentAt, useHtmlTime)}`,
    `${LABELS.deletedAt}: ${formatReportTimestamp(deletedAt, useHtmlTime)}`,
  ];
  if (forwardOrigin) {
    lines.push(`${LABELS.forwardOrigin}: ${escapeRichHtml(forwardOrigin)}`);
  }
  return lines;
}

function buildPlainDeleteHeaderLines(meta, partIndex, totalParts) {
  const partSuffix = totalParts > 1 ? ` (Part ${partIndex}/${totalParts})` : '';
  if (partIndex > 1) return [`${PLAIN_DELETE_TITLE}${partSuffix}`];

  const lines = [
    `${PLAIN_DELETE_TITLE}${partSuffix}`,
    `${LABELS.sender}: ${meta.sender}`,
    `${LABELS.chat}: ${meta.chat}`,
    `${LABELS.sentAt}: ${formatTimestamp(meta.sentAt)}`,
    `${LABELS.deletedAt}: ${formatTimestamp(meta.deletedAt)}`,
  ];
  if (meta.forwardOrigin) {
    lines.push(`${LABELS.forwardOrigin}: ${meta.forwardOrigin}`);
  }
  return lines;
}

/**
 * Builds 1+ Rich message part payloads for a single deleted text message.
 * Preserves user formatting entities in single-part reports; splits oversized
 * messages adaptively with `(Part i/n)` continuation headers and plain escaped chunks.
 *
 * @param {object} params
 * @returns {Array<{ richHtml: string, richEscapedHtml: string, plainChunkText: string, chunkEntities: Array<object>|null, plainFallbackText: string }>}
 */
export function buildRichDeletePayloads({
  text,
  entities,
  senderLabel,
  chatLabel,
  sentAt,
  deletedAt,
  messageId,
  forwardOrigin,
  isRichMessage,
}) {
  const rawText = typeof text === 'string' ? text : '';
  const meta = {
    sender: senderLabel || chatLabel || 'Unknown',
    chat: chatLabel || 'Unknown',
    sentAt,
    deletedAt,
    forwardOrigin: forwardOrigin || null,
  };
  const footerInfo = { messageId, isRichMessage: Boolean(isRichMessage) };
  const footerHtml = renderReportFooter(footerInfo);
  const plainFooter = formatPlainFooter(footerInfo);

  const renderPart = (chunkText, chunkEnts, useEntities, partIndex, totalParts, useHtmlTime) => {
    const partSuffix = totalParts > 1 ? ` (Part ${partIndex}/${totalParts})` : '';
    const titleHtml = `${HEADERS.deletedMessage}${partSuffix}`;
    const headerHtml =
      partIndex === 1
        ? renderMetaHeader(titleHtml, buildDeleteMetaLines(meta, useHtmlTime))
        : renderMetaHeader(titleHtml);
    const quote = renderQuoteBlock(chunkText, chunkEnts, useEntities);
    return {
      html: [headerHtml, '<hr/>', quote.html, footerHtml].join('\n'),
      usedEntities: quote.usedEntities,
    };
  };

  return buildSingleOrChunkedPayloads({
    rawText,
    entities,
    renderPart,
    buildPlainHeader: (partIndex, totalParts) =>
      buildPlainDeleteHeaderLines(meta, partIndex, totalParts),
    plainFooter,
  });
}
