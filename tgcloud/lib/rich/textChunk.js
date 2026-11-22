import { RICH_MAX_UTF8_BYTES } from '../config.js';
import { estimateRichMetrics, isWithinRichLimits, utf8ByteLength } from './limits.js';

const RICH_HTML_LIMIT_BYTES = 32768;
const SHRINK_FACTOR = 0.65;
const MAX_SHRINK_ATTEMPTS = 16;
const PROVISIONAL_TOTAL_FLOOR = 999;
const WRAPPER_MARGIN_BYTES = 64;

function readCodePointMeta(str, index) {
  const code = str.charCodeAt(index);
  if (code < 0x80) return { code, step: 1, bytes: 1 };
  if (code < 0x800) return { code, step: 1, bytes: 2 };
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < str.length) {
    const next = str.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) {
      return { code, step: 2, bytes: 4 };
    }
  }
  return { code, step: 1, bytes: 3 };
}

/**
 * Splits raw text on `\n`, then whitespace, then UTF-16-surrogate-safe code-point
 * boundaries so every piece fits within `maxUtf8Bytes` without splitting surrogate pairs.
 *
 * @param {unknown} text
 * @param {number} maxUtf8Bytes
 * @returns {string[]}
 */
export function splitRawTextByUtf8(text, maxUtf8Bytes) {
  if (text === null || text === undefined) return [];
  const str = String(text);
  if (str.length === 0) return [];
  if (!Number.isFinite(maxUtf8Bytes) || maxUtf8Bytes <= 0) return [];

  const limit = Math.floor(maxUtf8Bytes);
  if (utf8ByteLength(str) <= limit) return [str];

  const chunks = [];
  const halfLimit = Math.floor(limit / 2);
  let start = 0;

  while (start < str.length) {
    let pos = start;
    let bytes = 0;
    let lastNewline = -1;
    let lastWhitespace = -1;

    while (pos < str.length) {
      const meta = readCodePointMeta(str, pos);
      if (bytes + meta.bytes > limit) break;

      if (bytes >= halfLimit) {
        if (meta.code === 0x0a) lastNewline = pos;
        else if (meta.code === 0x20 || meta.code === 0x09) lastWhitespace = pos;
      }

      bytes += meta.bytes;
      pos += meta.step;
    }

    if (pos >= str.length) {
      chunks.push(str.slice(start));
      break;
    }

    if (pos === start) {
      const forced = readCodePointMeta(str, start);
      chunks.push(str.slice(start, start + forced.step));
      start += forced.step;
      continue;
    }

    if (lastNewline > start) {
      const end =
        str.charCodeAt(lastNewline - 1) === 0x0d && lastNewline - 1 > start
          ? lastNewline - 1
          : lastNewline;
      chunks.push(str.slice(start, end));
      start = lastNewline + 1;
    } else if (lastWhitespace > start) {
      chunks.push(str.slice(start, lastWhitespace));
      start = lastWhitespace + 1;
    } else {
      chunks.push(str.slice(start, pos));
      start = pos;
    }
  }

  return chunks;
}

function fitChunksPass(initialPieces, initialBudget, renderChunkHtml, totalFloor) {
  const stack = [];
  for (let i = initialPieces.length - 1; i >= 0; i -= 1) {
    stack.push({ text: initialPieces[i], budget: initialBudget, attempts: 0 });
  }

  const fittedTexts = [];

  while (stack.length > 0) {
    const item = stack.pop();
    const provisionalIndex = fittedTexts.length + 1;
    const provisionalTotal = Math.max(totalFloor, fittedTexts.length + stack.length + 1);
    const html = renderChunkHtml(item.text, provisionalIndex, provisionalTotal);

    if (isWithinRichLimits(estimateRichMetrics(html))) {
      fittedTexts.push(item.text);
      continue;
    }

    const currentBytes = utf8ByteLength(item.text);
    if (item.attempts >= MAX_SHRINK_ATTEMPTS || currentBytes <= 1) {
      fittedTexts.push(item.text);
      continue;
    }

    const baseBudget = Math.min(item.budget, currentBytes - 1);
    const nextBudget = Math.max(1, Math.floor(baseBudget * SHRINK_FACTOR));
    const subChunks = splitRawTextByUtf8(item.text, nextBudget);

    if (subChunks.length <= 1) {
      fittedTexts.push(item.text);
      continue;
    }

    for (let i = subChunks.length - 1; i >= 0; i -= 1) {
      stack.push({
        text: subChunks[i],
        budget: nextBudget,
        attempts: item.attempts + 1,
      });
    }
  }

  return fittedTexts;
}

/**
 * Splits `rawText` and adapts chunk sizes post-render so every emitted chunk's full HTML
 * passes `isWithinRichLimits(estimateRichMetrics(html))`, finalizing `(Part i/n)` numbering
 * only after all re-splits settle.
 *
 * @param {unknown} rawText
 * @param {(chunkText: string, partIndex: number, totalParts: number) => string} renderChunkHtml
 * @param {number} [initialRawBudget]
 * @returns {Array<{ text: string, html: string }>}
 */
export function buildFittedRichChunks(rawText, renderChunkHtml, initialRawBudget) {
  const str = rawText === null || rawText === undefined ? '' : String(rawText);
  if (str.length === 0) {
    return [{ text: '', html: renderChunkHtml('', 1, 1) }];
  }

  let startBudget;
  if (Number.isFinite(initialRawBudget) && initialRawBudget > 0) {
    startBudget = Math.min(Math.floor(initialRawBudget), RICH_MAX_UTF8_BYTES);
  } else {
    const wrapperMetrics = estimateRichMetrics(
      renderChunkHtml('', 1, PROVISIONAL_TOTAL_FLOOR)
    );
    const visibleRoom =
      RICH_MAX_UTF8_BYTES - wrapperMetrics.visibleUtf8Bytes - WRAPPER_MARGIN_BYTES;
    const htmlRoom =
      RICH_HTML_LIMIT_BYTES - wrapperMetrics.htmlUtf8Bytes - WRAPPER_MARGIN_BYTES;
    startBudget = Math.max(64, Math.min(visibleRoom, htmlRoom));
  }

  let texts = fitChunksPass(
    splitRawTextByUtf8(str, startBudget),
    startBudget,
    renderChunkHtml,
    PROVISIONAL_TOTAL_FLOOR
  );

  for (let pass = 0; pass < 2; pass += 1) {
    const totalParts = texts.length;
    const rendered = texts.map((text, idx) => ({
      text,
      html: renderChunkHtml(text, idx + 1, totalParts),
    }));
    const allWithinLimits = rendered.every((part) =>
      isWithinRichLimits(estimateRichMetrics(part.html))
    );
    if (allWithinLimits) return rendered;

    const expandedFloor = Math.max(PROVISIONAL_TOTAL_FLOOR, totalParts * 10);
    texts = fitChunksPass(texts, startBudget, renderChunkHtml, expandedFloor);
  }

  const totalParts = texts.length;
  return texts.map((text, idx) => ({
    text,
    html: renderChunkHtml(text, idx + 1, totalParts),
  }));
}
