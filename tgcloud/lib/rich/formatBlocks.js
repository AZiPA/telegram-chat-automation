import { LABELS, formatHtmlTimestamp, formatTimestamp } from '../config.js';
import { entitiesToRichHtml } from './entities.js';
import { escapeRichHtml, textToRichHtml } from './html.js';
import { estimateRichMetrics, isWithinRichLimits } from './limits.js';
import { buildFittedRichChunks } from './textChunk.js';

const EXPANDABLE_CHAR_THRESHOLD = 400;
const EXPANDABLE_LINE_THRESHOLD = 6;
const RICH_FLATTENED_NOTE = '📝 Rich message (flattened text)';

/** Returns true when raw text exceeds > 400 chars OR > 6 normalized lines. */
export function shouldUseExpandableQuote(rawText) {
  const str = typeof rawText === 'string' ? rawText : '';
  if (str.length > EXPANDABLE_CHAR_THRESHOLD) return true;
  return str.replace(/\r\n?/g, '\n').split('\n').length > EXPANDABLE_LINE_THRESHOLD;
}

/** Formats a timestamp for Stage 1 (`<tg-time>`) or Stage 2 (plain UTC text). */
export function formatReportTimestamp(value, useHtmlTime) {
  return useHtmlTime
    ? formatHtmlTimestamp(value, 'dT')
    : escapeRichHtml(formatTimestamp(value));
}

/** Checks that both Stage 1 and Stage 2 HTML pass Telegram Rich Message limits. */
export function fitsBothRichStages(richHtml, richEscapedHtml) {
  return (
    isWithinRichLimits(estimateRichMetrics(richHtml)) &&
    isWithinRichLimits(estimateRichMetrics(richEscapedHtml))
  );
}

/** Renders a Rich blockquote block, preserving valid user entities when requested. */
export function renderQuoteBlock(rawText, entities, useEntities) {
  const str = typeof rawText === 'string' ? rawText : '';
  if (str.length === 0) {
    return {
      html: `<blockquote><i>${escapeRichHtml(LABELS.emptyText)}</i></blockquote>`,
      usedEntities: false,
    };
  }

  const openTag = shouldUseExpandableQuote(str)
    ? '<blockquote expandable>'
    : '<blockquote>';

  if (useEntities && Array.isArray(entities) && entities.length > 0) {
    const rendered = entitiesToRichHtml(str, entities);
    if (rendered !== null) {
      return { html: `${openTag}${rendered}</blockquote>`, usedEntities: true };
    }
  }

  return {
    html: `${openTag}${textToRichHtml(str)}</blockquote>`,
    usedEntities: false,
  };
}

/** Wraps a Rich report title line and optional metadata lines inside a `<p>` block. */
export function renderMetaHeader(titleHtml, metaLines = []) {
  return `<p>${[titleHtml, ...metaLines.filter(Boolean)].join('<br>')}</p>`;
}

/** Renders the Rich `<footer>` with Message ID and optional flattened Rich message note. */
export function renderReportFooter({ messageId, isRichMessage }) {
  const idText =
    messageId !== null && messageId !== undefined ? String(messageId) : 'Unknown';
  const richSuffix = isRichMessage ? ` • ${RICH_FLATTENED_NOTE}` : '';
  return `<footer>${LABELS.messageId}: <code>${escapeRichHtml(idText)}</code>${richSuffix}</footer>`;
}

/** Formats the plain-text footer line used by per-part Stage 3 classic fallbacks. */
export function formatPlainFooter({ messageId, isRichMessage }) {
  const idText =
    messageId !== null && messageId !== undefined ? String(messageId) : 'Unknown';
  const richSuffix = isRichMessage ? ` • ${RICH_FLATTENED_NOTE}` : '';
  return `${LABELS.messageId}: ${idText}${richSuffix}`;
}

/** Assembles a plain-text fallback message for a single part of a report. */
export function buildPlainPartText(headerLines, bodyText, footerLine) {
  const safeBody =
    typeof bodyText === 'string' && bodyText.length > 0 ? bodyText : LABELS.emptyText;
  const parts = [...headerLines.filter(Boolean), LABELS.divider, safeBody];
  if (footerLine) parts.push('', footerLine);
  return parts.join('\n');
}

/**
 * Attempts a single-part Rich payload (preserving entities if within limits),
 * falling back to adaptive multi-part chunking via `buildFittedRichChunks`.
 *
 * @param {object} params
 * @returns {Array<{ richHtml: string, richEscapedHtml: string, plainChunkText: string, chunkEntities: Array<object>|null, plainFallbackText: string }>}
 */
export function buildSingleOrChunkedPayloads({
  rawText,
  entities,
  renderPart,
  buildPlainHeader,
  plainFooter,
}) {
  const trySingle = (useEntities) => {
    const stage1 = renderPart(rawText, entities, useEntities, 1, 1, true);
    const stage2 = renderPart(rawText, null, false, 1, 1, false);
    if (!fitsBothRichStages(stage1.html, stage2.html)) return null;

    return {
      richHtml: stage1.html,
      richEscapedHtml: stage2.html,
      plainChunkText: rawText,
      chunkEntities: stage1.usedEntities ? entities : null,
      plainFallbackText: buildPlainPartText(buildPlainHeader(1, 1), rawText, plainFooter),
    };
  };

  const singleWithEntities = trySingle(true);
  if (singleWithEntities) return [singleWithEntities];

  if (Array.isArray(entities) && entities.length > 0) {
    const singlePlain = trySingle(false);
    if (singlePlain) return [singlePlain];
  }

  const fitted = buildFittedRichChunks(rawText, (chunkText, partIndex, totalParts) =>
    renderPart(chunkText, null, false, partIndex, totalParts, true).html
  );

  const totalParts = fitted.length;
  return fitted.map((chunk, idx) => {
    const partIndex = idx + 1;
    const stage2 = renderPart(chunk.text, null, false, partIndex, totalParts, false);
    return {
      richHtml: chunk.html,
      richEscapedHtml: stage2.html,
      plainChunkText: chunk.text,
      chunkEntities: null,
      plainFallbackText: buildPlainPartText(
        buildPlainHeader(partIndex, totalParts),
        chunk.text,
        plainFooter
      ),
    };
  });
}
