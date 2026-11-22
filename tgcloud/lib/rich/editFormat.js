import { HEADERS, LABELS, formatTimestamp } from '../config.js';
import {
  buildPlainPartText,
  buildSingleOrChunkedPayloads,
  fitsBothRichStages,
  formatPlainFooter,
  formatReportTimestamp,
  renderMetaHeader,
  renderQuoteBlock,
  renderReportFooter,
} from './formatBlocks.js';
import { escapeRichHtml } from './html.js';

const SECTION_PREVIOUS = '🔴 Previous';
const SECTION_NEW = '🟢 New';
const PLAIN_EDIT_TITLE = '✏️ Message Edited';
const PLAIN_UNARCHIVED_TITLE = '✏️ Message Edited (Previous Version Not Archived)';

function buildEditContext({ senderLabel, chatLabel, editedAt, messageId, forwardOrigin, isRichMessage }) {
  const meta = {
    sender: senderLabel || 'Unknown',
    chat: chatLabel || 'Unknown',
    editedAt,
    forwardOrigin: forwardOrigin || null,
  };
  const footerInfo = { messageId, isRichMessage: Boolean(isRichMessage) };
  return {
    meta,
    footerHtml: renderReportFooter(footerInfo),
    plainFooter: formatPlainFooter(footerInfo),
  };
}

function buildEditMetaLines({ sender, chat, editedAt, forwardOrigin }, useHtmlTime) {
  const lines = [
    `${LABELS.sender}: ${escapeRichHtml(sender)}`,
    `${LABELS.chat}: ${escapeRichHtml(chat)}`,
    `${LABELS.editedAt}: ${formatReportTimestamp(editedAt, useHtmlTime)}`,
  ];
  if (forwardOrigin) lines.push(`${LABELS.forwardOrigin}: ${escapeRichHtml(forwardOrigin)}`);
  return lines;
}

function buildPlainFullEditHeader(title, meta) {
  const lines = [
    title,
    `${LABELS.sender}: ${meta.sender}`,
    `${LABELS.chat}: ${meta.chat}`,
    `${LABELS.editedAt}: ${formatTimestamp(meta.editedAt)}`,
  ];
  if (meta.forwardOrigin) lines.push(`${LABELS.forwardOrigin}: ${meta.forwardOrigin}`);
  return lines;
}

function buildSplitSidePayloads(rawText, entities, sectionLabel, includeFullHeader, ctx) {
  const renderPart = (chunkText, chunkEnts, useEntities, partIndex, totalParts, useHtmlTime) => {
    const partSuffix = totalParts > 1 ? ` (Part ${partIndex}/${totalParts})` : '';
    const quote = renderQuoteBlock(chunkText, chunkEnts, useEntities);

    if (includeFullHeader && partIndex === 1) {
      const headerHtml = renderMetaHeader(
        HEADERS.editedMessage,
        buildEditMetaLines(ctx.meta, useHtmlTime)
      );
      const sectionHtml = `<p><b>${escapeRichHtml(sectionLabel)}${partSuffix}</b></p>`;
      return {
        html: [headerHtml, '<hr/>', sectionHtml, quote.html, ctx.footerHtml].join('\n'),
        usedEntities: quote.usedEntities,
      };
    }

    const compactTitle = `${HEADERS.editedMessage} — <b>${escapeRichHtml(sectionLabel)}${partSuffix}</b>`;
    return {
      html: [renderMetaHeader(compactTitle), '<hr/>', quote.html, ctx.footerHtml].join('\n'),
      usedEntities: quote.usedEntities,
    };
  };

  const buildPlainHeader = (partIndex, totalParts) => {
    const partSuffix = totalParts > 1 ? ` (Part ${partIndex}/${totalParts})` : '';
    if (includeFullHeader && partIndex === 1) {
      return [...buildPlainFullEditHeader(PLAIN_EDIT_TITLE, ctx.meta), `${sectionLabel}${partSuffix}`];
    }
    return [`${PLAIN_EDIT_TITLE} — ${sectionLabel}${partSuffix}`];
  };

  return buildSingleOrChunkedPayloads({
    rawText,
    entities,
    renderPart,
    buildPlainHeader,
    plainFooter: ctx.plainFooter,
  });
}

/**
 * Builds 1+ Rich part payloads for an archived text-only edit report.
 * Emits a single combined diff when within limits, or splits cleanly into
 * Previous part(s) followed by New part(s), preserving per-side entities when unchunked.
 *
 * @param {object} params
 * @returns {Array<{ richHtml: string, richEscapedHtml: string, plainChunkText: string, chunkEntities: Array<object>|null, plainFallbackText: string }>}
 */
export function buildRichEditPayloads(params) {
  const prevRaw = typeof params.oldText === 'string' ? params.oldText : '';
  const nextRaw = typeof params.newText === 'string' ? params.newText : '';
  const ctx = buildEditContext(params);

  const renderCombined = (useEntities, useHtmlTime) => {
    const headerHtml = renderMetaHeader(
      HEADERS.editedMessage,
      buildEditMetaLines(ctx.meta, useHtmlTime)
    );
    const prevQuote = renderQuoteBlock(prevRaw, params.oldEntities, useEntities);
    const nextQuote = renderQuoteBlock(nextRaw, params.newEntities, useEntities);
    return {
      html: [
        headerHtml,
        '<hr/>',
        `<p><b>${SECTION_PREVIOUS}</b></p>`,
        prevQuote.html,
        `<p><b>${SECTION_NEW}</b></p>`,
        nextQuote.html,
        ctx.footerHtml,
      ].join('\n'),
      usedNewEntities: nextQuote.usedEntities,
    };
  };

  const stage1 = renderCombined(true, true);
  const stage2 = renderCombined(false, false);
  if (fitsBothRichStages(stage1.html, stage2.html)) {
    const combinedBody = `${SECTION_PREVIOUS}\n${prevRaw || LABELS.emptyText}\n\n${SECTION_NEW}\n${nextRaw || LABELS.emptyText}`;
    return [
      {
        richHtml: stage1.html,
        richEscapedHtml: stage2.html,
        plainChunkText: nextRaw,
        chunkEntities: stage1.usedNewEntities ? params.newEntities : null,
        plainFallbackText: buildPlainPartText(
          buildPlainFullEditHeader(PLAIN_EDIT_TITLE, ctx.meta),
          combinedBody,
          ctx.plainFooter
        ),
      },
    ];
  }

  return [
    ...buildSplitSidePayloads(prevRaw, params.oldEntities, SECTION_PREVIOUS, true, ctx),
    ...buildSplitSidePayloads(nextRaw, params.newEntities, SECTION_NEW, false, ctx),
  ];
}

/**
 * Builds 1+ Rich part payloads for an unarchived text-only edit report.
 *
 * @param {object} params
 * @returns {Array<{ richHtml: string, richEscapedHtml: string, plainChunkText: string, chunkEntities: Array<object>|null, plainFallbackText: string }>}
 */
export function buildRichUnarchivedEditPayloads(params) {
  const rawText = typeof params.text === 'string' ? params.text : '';
  const ctx = buildEditContext(params);

  const renderPart = (chunkText, chunkEnts, useEntities, partIndex, totalParts, useHtmlTime) => {
    const partSuffix = totalParts > 1 ? ` (Part ${partIndex}/${totalParts})` : '';
    const quote = renderQuoteBlock(chunkText, chunkEnts, useEntities);
    const headerHtml =
      partIndex === 1
        ? renderMetaHeader(
            `${HEADERS.editedUnarchivedMessage}${partSuffix}`,
            buildEditMetaLines(ctx.meta, useHtmlTime)
          )
        : renderMetaHeader(`${HEADERS.editedMessage}${partSuffix}`);
    return {
      html: [
        headerHtml,
        '<hr/>',
        `<p><b>${SECTION_NEW}${partSuffix}</b></p>`,
        quote.html,
        ctx.footerHtml,
      ].join('\n'),
      usedEntities: quote.usedEntities,
    };
  };

  const buildPlainHeader = (partIndex, totalParts) => {
    const partSuffix = totalParts > 1 ? ` (Part ${partIndex}/${totalParts})` : '';
    if (partIndex === 1) {
      return [
        ...buildPlainFullEditHeader(`${PLAIN_UNARCHIVED_TITLE}${partSuffix}`, ctx.meta),
        `${SECTION_NEW}${partSuffix}`,
      ];
    }
    return [`${PLAIN_EDIT_TITLE}${partSuffix}`, `${SECTION_NEW}${partSuffix}`];
  };

  return buildSingleOrChunkedPayloads({
    rawText,
    entities: params.entities,
    renderPart,
    buildPlainHeader,
    plainFooter: ctx.plainFooter,
  });
}
