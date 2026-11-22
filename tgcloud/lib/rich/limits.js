import { RICH_MAX_BLOCKS, RICH_MAX_UTF8_BYTES } from '../config.js';

const RICH_HTML_LIMIT_BYTES = 32768;
const BASIC_HTML_ENTITY_DECODE_MAP = {
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  amp: '&',
};
const BLOCK_OPEN_TAG_RE =
  /<(?:p|h[1-6]|pre|footer|hr|ul|ol|li|blockquote|aside|table|tr|details|tg-math-block|tg-button-row|figure|tg-collage|tg-slideshow|tg-map)(?=[\s/>])/gi;
const HTML_TAG_STRIP_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*|\/)?>/g;

let cachedTextEncoder = null;

function utf8ByteLengthFallback(str) {
  let bytes = 0;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Computes UTF-8 byte length using `TextEncoder` when available, falling back
 * to a surrogate-pair-aware `charCodeAt` counter in restricted V8 isolates.
 *
 * @param {unknown} str
 * @returns {number}
 */
export function utf8ByteLength(str) {
  if (str === null || str === undefined) return 0;
  const s = String(str);
  if (s.length === 0) return 0;

  if (typeof TextEncoder === 'function') {
    if (!cachedTextEncoder) cachedTextEncoder = new TextEncoder();
    return cachedTextEncoder.encode(s).length;
  }
  return utf8ByteLengthFallback(s);
}

/**
 * Estimates Telegram Rich Message byte and block-count metrics for pre-send validation.
 *
 * @param {unknown} html
 * @returns {{ visibleUtf8Bytes: number, htmlUtf8Bytes: number, estimatedBlocks: number }}
 */
export function estimateRichMetrics(html) {
  if (html === null || html === undefined) {
    return { visibleUtf8Bytes: 0, htmlUtf8Bytes: 0, estimatedBlocks: 0 };
  }
  const str = String(html);
  if (str.length === 0) {
    return { visibleUtf8Bytes: 0, htmlUtf8Bytes: 0, estimatedBlocks: 0 };
  }

  const htmlUtf8Bytes = utf8ByteLength(str);
  const visibleText = str
    .replace(HTML_TAG_STRIP_RE, '')
    .replace(/&(lt|gt|quot|#39|amp);/g, (_, entity) => BASIC_HTML_ENTITY_DECODE_MAP[entity]);
  const visibleUtf8Bytes = utf8ByteLength(visibleText);

  const blockMatches = str.match(BLOCK_OPEN_TAG_RE);
  const estimatedBlocks = Math.max(1, blockMatches ? blockMatches.length : 0);

  return { visibleUtf8Bytes, htmlUtf8Bytes, estimatedBlocks };
}

/**
 * Checks whether computed Rich HTML metrics stay safely within Telegram Rich Message limits.
 *
 * @param {{ visibleUtf8Bytes: number, htmlUtf8Bytes: number, estimatedBlocks: number }|null|undefined} metrics
 * @returns {boolean}
 */
export function isWithinRichLimits(metrics) {
  if (!metrics || typeof metrics !== 'object') return false;
  return (
    Number.isFinite(metrics.visibleUtf8Bytes) &&
    Number.isFinite(metrics.htmlUtf8Bytes) &&
    Number.isFinite(metrics.estimatedBlocks) &&
    metrics.visibleUtf8Bytes <= RICH_MAX_UTF8_BYTES &&
    metrics.htmlUtf8Bytes <= RICH_HTML_LIMIT_BYTES &&
    metrics.estimatedBlocks <= RICH_MAX_BLOCKS
  );
}
