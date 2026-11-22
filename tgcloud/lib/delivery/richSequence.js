import { sendTextSafely } from './client.js';
import { sendRichMessage } from './richClient.js';

function buildPerPartClassicFallback(chatId, part) {
  const fallbackText =
    typeof part?.plainFallbackText === 'string' && part.plainFallbackText.length > 0
      ? part.plainFallbackText
      : part?.plainChunkText;
  if (typeof fallbackText !== 'string' || fallbackText.length === 0) {
    return null;
  }

  return async (classicOpts) => {
    const res = await sendTextSafely(chatId, fallbackText, {
      messageThreadId: classicOpts.messageThreadId,
      disableNotification: Boolean(classicOpts.disableNotification),
      replyToMessageId: classicOpts.replyToMessageId,
      rethrowTopicError: Boolean(classicOpts.rethrowTopicError),
    });
    return res.ok ? res.message : null;
  };
}

/**
 * Delivers 1+ Rich report parts sequentially with:
 * - Part 2+ reply chaining to Part 1's `message_id`
 * - Full classic fallback on 1-part reports, and per-part plain fallback on multi-part reports
 * - Immediate stop on partial failure (never re-sending earlier parts)
 * - Clean `disableNotification` and `rethrowTopicError` propagation on every part & fallback
 *
 * @param {number|string} chatId
 * @param {Array<{ richHtml: string, richEscapedHtml: string, plainChunkText?: string, plainFallbackText?: string }>} payloads
 * @param {object} [options]
 * @returns {Promise<{ ok: boolean, message: object|null }>}
 */
export async function sendRichReportSequence(chatId, payloads, options = {}) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return { ok: false, message: null };
  }

  const label = options.label ?? 'richReport';
  const baseOpts = {
    messageThreadId: options.messageThreadId,
    disableNotification: Boolean(options.disableNotification),
    rethrowTopicError: Boolean(options.rethrowTopicError),
  };

  if (payloads.length === 1) {
    const part = payloads[0];
    const classicFallback =
      typeof options.singlePartClassicFallback === 'function'
        ? options.singlePartClassicFallback
        : buildPerPartClassicFallback(chatId, part);

    const sent = await sendRichMessage(
      chatId,
      {
        richHtml: part.richHtml,
        richEscapedHtml: part.richEscapedHtml,
        classicFallback,
      },
      {
        ...baseOpts,
        replyToMessageId: options.replyToMessageId,
        label,
      }
    );
    return { ok: Boolean(sent), message: sent ?? null };
  }

  let firstSent = null;
  let lastSent = null;

  for (let i = 0; i < payloads.length; i += 1) {
    const part = payloads[i];
    const replyToMessageId =
      i === 0 ? options.replyToMessageId : firstSent?.message_id;

    const sent = await sendRichMessage(
      chatId,
      {
        richHtml: part.richHtml,
        richEscapedHtml: part.richEscapedHtml,
        classicFallback: buildPerPartClassicFallback(chatId, part),
      },
      {
        ...baseOpts,
        replyToMessageId,
        label: `${label}:part${i + 1}`,
      }
    );

    if (!sent) {
      return { ok: false, message: lastSent };
    }

    if (i === 0) firstSent = sent;
    lastSent = sent;
  }

  return { ok: true, message: lastSent };
}
