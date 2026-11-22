import { api } from 'sdk';
import { estimateRichMetrics, isWithinRichLimits } from '../rich/limits.js';
import {
  buildNotificationParams,
  buildReplyParams,
  buildThreadParams,
  isDeletedTopicError,
  isRichContentError,
  isRichMethodMissingError,
  safeCall,
  sendHtmlMessage,
  sendTextSafely,
} from './client.js';

let richMethodSupported = true;

/** Resets the cached `api.sendRichMessage` support flag (for deterministic unit tests). */
export function resetRichSupportCache() {
  richMethodSupported = true;
}

async function attemptRichSend(chatId, richHtml, stage, options, label) {
  const metrics = estimateRichMetrics(richHtml);
  if (!isWithinRichLimits(metrics)) {
    return { status: 'content_rejected' };
  }

  try {
    const sent = await safeCall(
      () =>
        api.sendRichMessage({
          chat_id: chatId,
          rich_message: { html: richHtml },
          ...buildThreadParams(options.messageThreadId),
          ...buildNotificationParams(options.disableNotification),
          ...buildReplyParams(options.replyToMessageId),
        }),
      `${label}:stage${stage}`,
      {
        rethrowTopicError: Boolean(options.rethrowTopicError),
        rethrowNotFound: true,
        rethrowBadRequest: true,
      }
    );
    return sent ? { status: 'sent', message: sent } : { status: 'aborted' };
  } catch (err) {
    if (isDeletedTopicError(err)) throw err;

    if (isRichMethodMissingError(err)) {
      richMethodSupported = false;
      return { status: 'method_missing' };
    }

    if (isRichContentError(err)) {
      console.warn(`[${label}] Rich content rejected:`, {
        label,
        stage,
        code: err?.code,
        description: err?.description,
        visibleUtf8Bytes: metrics.visibleUtf8Bytes,
        htmlUtf8Bytes: metrics.htmlUtf8Bytes,
        estimatedBlocks: metrics.estimatedBlocks,
      });
      return { status: 'content_rejected' };
    }

    throw err;
  }
}

async function executeClassicFallback(chatId, classicFallback, options, label) {
  if (!classicFallback) return null;

  const classicOpts = {
    messageThreadId: options.messageThreadId,
    disableNotification: options.disableNotification,
    replyToMessageId: options.replyToMessageId,
    rethrowTopicError: Boolean(options.rethrowTopicError),
  };

  if (typeof classicFallback === 'function') {
    return await classicFallback(classicOpts);
  }

  if (typeof classicFallback === 'object') {
    if (typeof classicFallback.html === 'string' && classicFallback.html.length > 0) {
      return await sendHtmlMessage(chatId, classicFallback.html, {
        ...classicOpts,
        label: `${label}FallbackHtml`,
      });
    }
    if (typeof classicFallback.text === 'string' && classicFallback.text.length > 0) {
      const res = await sendTextSafely(chatId, classicFallback.text, {
        ...classicOpts,
        entities: classicFallback.entities,
      });
      return res.ok ? res.message : null;
    }
  }

  return null;
}

/**
 * Sends a Telegram Rich Message using a 3-stage pipeline:
 * Stage 1 (`richHtml`), Stage 2 (`richEscapedHtml` on 400/limit issues), and Stage 3 (`classicFallback`).
 * Never cascades across stages on 429/403/5xx/network errors and always rethrows deleted-topic errors.
 *
 * @param {number|string} chatId
 * @param {{ richHtml?: string|null, richEscapedHtml?: string|null, classicFallback?: Function|{ html?: string, text?: string, entities?: Array } }} payload
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export async function sendRichMessage(chatId, payload, options = {}) {
  if (!payload || typeof payload !== 'object') return null;

  const label = options.label ?? 'sendRichMessage';
  const { richHtml, richEscapedHtml, classicFallback } = payload;

  if (richMethodSupported && typeof api?.sendRichMessage !== 'function') {
    richMethodSupported = false;
  }

  if (richMethodSupported) {
    let stage1Outcome = { status: 'content_rejected' };
    if (typeof richHtml === 'string' && richHtml.length > 0) {
      stage1Outcome = await attemptRichSend(chatId, richHtml, 1, options, label);
      if (stage1Outcome.status === 'sent') return stage1Outcome.message;
      if (stage1Outcome.status === 'aborted') return null;
    }

    if (
      stage1Outcome.status === 'content_rejected' &&
      richMethodSupported &&
      typeof richEscapedHtml === 'string' &&
      richEscapedHtml.length > 0 &&
      richEscapedHtml !== richHtml
    ) {
      const stage2Outcome = await attemptRichSend(chatId, richEscapedHtml, 2, options, label);
      if (stage2Outcome.status === 'sent') return stage2Outcome.message;
      if (stage2Outcome.status === 'aborted') return null;
    }
  }

  return await executeClassicFallback(chatId, classicFallback, options, label);
}
