import { api } from 'sdk';
import { MAX_TEXT_LENGTH } from '../config.js';
import { splitTextSafely } from '../media/textEdit.js';

/**
 * Executes a Bot API call safely without throwing, retrying a single 429 rate-limit
 * response if `retry_after` is at most 5 seconds.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @param {string} [label]
 * @returns {Promise<T|null>}
 */
export async function safeCall(fn, label = '') {
  const prefix = label ? `[${label}] ` : '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code === 429) {
        const retry = err?.parameters?.retry_after;
        if (attempt === 0 && typeof retry === 'number' && retry >= 0 && retry <= 5) {
          console.warn(`${prefix}429 rate limit; retrying after ${retry}s`);
          if (retry > 0) {
            await new Promise((r) => setTimeout(r, retry * 1000));
          }
          continue;
        }
        console.warn(
          `${prefix}429 rate limit; retry_after=${retry}, returning null without waiting`
        );
        return null;
      }

      console.error(`${prefix}Call failed:`, {
        code: err?.code,
        description: err?.description,
        message: err?.message ?? String(err),
      });
      return null;
    }
  }

  return null;
}

/**
 * Builds Telegram Bot API `reply_parameters` when a target message ID is available.
 *
 * @param {number|undefined|null} replyToMessageId
 * @returns {object}
 */
export function buildReplyParams(replyToMessageId) {
  if (!replyToMessageId) return {};
  return {
    reply_parameters: {
      message_id: replyToMessageId,
      allow_sending_without_reply: true,
    },
  };
}

/**
 * Sends a Bot API message formatted with `parse_mode: 'HTML'`.
 *
 * @param {number} chatId
 * @param {string} html
 * @param {{ replyToMessageId?: number, label?: string }} [options]
 * @returns {Promise<object|null>}
 */
export async function sendHtmlMessage(chatId, html, options = {}) {
  if (!html) return null;
  return await safeCall(
    () =>
      api.sendMessage({
        chat_id: chatId,
        text: html,
        parse_mode: 'HTML',
        ...buildReplyParams(options.replyToMessageId),
      }),
    options.label ?? 'sendHtmlMessage'
  );
}

/**
 * Sends plain text safely without HTML parsing, preserving `entities` when within
 * `maxLen` or splitting long messages into UTF-16-safe chunks.
 *
 * @param {number} chatId
 * @param {unknown} text
 * @param {{ maxLen?: number, replyToMessageId?: number, entities?: Array }} [options]
 * @returns {Promise<{ ok: boolean, message: object|null }>}
 */
export async function sendTextSafely(chatId, text, options = {}) {
  const str = text === null || text === undefined ? '' : String(text);
  if (!str) return { ok: false, message: null };

  const maxLen = options.maxLen ?? MAX_TEXT_LENGTH;
  const replyParams = buildReplyParams(options.replyToMessageId);

  if (str.length <= maxLen) {
    const params = { chat_id: chatId, text: str, ...replyParams };
    if (Array.isArray(options.entities) && options.entities.length > 0) {
      params.entities = options.entities;
    }
    const sent = await safeCall(() => api.sendMessage(params), 'sendText');
    return { ok: Boolean(sent), message: sent };
  }

  const chunks = splitTextSafely(str, maxLen);
  if (chunks.length === 0) return { ok: false, message: null };

  let lastSent = null;
  let allOk = true;
  for (const chunk of chunks) {
    const sent = await safeCall(
      () => api.sendMessage({ chat_id: chatId, text: chunk, ...replyParams }),
      'sendTextChunk'
    );
    if (sent) {
      lastSent = sent;
    } else {
      allOk = false;
    }
  }

  return { ok: allOk, message: lastSent };
}
