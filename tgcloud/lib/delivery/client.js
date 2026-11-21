import { api, BotApiError } from 'sdk';
import { MAX_TEXT_LENGTH } from '../config.js';
import { splitTextSafely } from '../media/textEdit.js';

const TOPIC_DELETED_RE = /message thread not found|TOPIC_DELETED|TOPIC_CLOSED|thread_id_invalid/i;
const HTML_PARSE_ERROR_RE = /can't parse entities|ENTITY_DATE_INVALID|ENTITY_DATE_TOO_LONG/i;
const HTML_ENTITY_DECODE_MAP = {
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  amp: '&',
};

/** Returns true when `err` is a BotApiError indicating a deleted/closed topic thread. */
export function isDeletedTopicError(err) {
  if (!err) return false;
  const isBotErr = err instanceof BotApiError || err?.name === 'BotApiError';
  return isBotErr && typeof err.description === 'string' && TOPIC_DELETED_RE.test(err.description);
}

/** Returns true when `err` is a Bot API 400 error caused by HTML or date_time entity parsing. */
export function isHtmlParseError(err) {
  if (!err) return false;
  return (
    err.code === 400 &&
    typeof err.description === 'string' &&
    HTML_PARSE_ERROR_RE.test(err.description)
  );
}

/**
 * Converts a Bot API HTML string into plain text for non-HTML fallback delivery,
 * unwrapping `<tg-time>` tags to their fallback text, stripping remaining tags, and
 * single-pass unescaping HTML entities.
 *
 * @param {unknown} html
 * @returns {string}
 */
export function stripHtmlForPlainFallback(html) {
  if (html === null || html === undefined) return '';
  return String(html)
    .replace(/<tg-time[^>]*>([^<]*)<\/tg-time>/gi, '$1')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[^>]*)?>/g, '')
    .replace(/&(lt|gt|quot|#39|amp);/g, (_, entity) => HTML_ENTITY_DECODE_MAP[entity]);
}

/** Executes a Bot API call safely, retrying 429 once (<=5s) and rethrowing topic/parse errors if requested. */
export async function safeCall(fn, label = '', options = {}) {
  const prefix = label ? `[${label}] ` : '';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (err?.code === 429) {
        const retry = err?.parameters?.retry_after;
        if (attempt === 0 && typeof retry === 'number' && retry >= 0 && retry <= 5) {
          console.warn(`${prefix}429 rate limit; retrying after ${retry}s`);
          if (retry > 0) await new Promise((r) => setTimeout(r, retry * 1000));
          continue;
        }
        console.warn(`${prefix}429 rate limit; retry_after=${retry}, returning null without waiting`);
        return null;
      }

      if (options.rethrowTopicError && isDeletedTopicError(err)) {
        console.warn(`${prefix}Topic thread error; triggering self-heal:`, err.description);
        throw err;
      }

      if (options.rethrowParseError && isHtmlParseError(err)) {
        console.warn(`${prefix}HTML parse error; falling back to plain text:`, err.description);
        throw err;
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

/** Builds Telegram Bot API `reply_parameters` with `allow_sending_without_reply: true`. */
export function buildReplyParams(replyToMessageId) {
  if (!replyToMessageId) return {};
  return { reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true } };
}

/** Builds `message_thread_id` parameter when a topic thread ID is defined. */
export function buildThreadParams(messageThreadId) {
  return messageThreadId ? { message_thread_id: messageThreadId } : {};
}

/** Builds `disable_notification` parameter when silent delivery is requested. */
export function buildNotificationParams(disableNotification) {
  return disableNotification ? { disable_notification: true } : {};
}

/** Sends a Bot API message formatted with `parse_mode: 'HTML'`, falling back to plain text on 400 parse errors. */
export async function sendHtmlMessage(chatId, html, options = {}) {
  if (!html) return null;
  const label = options.label ?? 'sendHtmlMessage';

  try {
    return await safeCall(
      () =>
        api.sendMessage({
          chat_id: chatId,
          text: html,
          parse_mode: 'HTML',
          ...buildThreadParams(options.messageThreadId),
          ...buildNotificationParams(options.disableNotification),
          ...buildReplyParams(options.replyToMessageId),
        }),
      label,
      {
        rethrowTopicError: Boolean(options.rethrowTopicError),
        rethrowParseError: true,
      }
    );
  } catch (err) {
    if (!isHtmlParseError(err)) throw err;

    const plainText = stripHtmlForPlainFallback(html);
    if (!plainText) return null;

    const fallbackRes = await sendTextSafely(chatId, plainText, {
      messageThreadId: options.messageThreadId,
      disableNotification: options.disableNotification,
      replyToMessageId: options.replyToMessageId,
      rethrowTopicError: Boolean(options.rethrowTopicError),
    });
    return fallbackRes.message;
  }
}

/** Sends an HTML reply inside the caller's thread (if any), falling back to main chat. */
export async function replyToPrivateMessage(message, html, label = 'privateReply') {
  if (!html || message?.chat?.id == null) return null;

  const callerThreadId =
    typeof message.message_thread_id === 'number' && message.message_thread_id !== 0
      ? message.message_thread_id
      : undefined;
  const replyToMessageId =
    typeof message.message_id === 'number' ? message.message_id : undefined;

  const sent = await sendHtmlMessage(message.chat.id, html, {
    label,
    messageThreadId: callerThreadId,
    replyToMessageId: callerThreadId !== undefined ? replyToMessageId : undefined,
  });

  if (!sent && callerThreadId !== undefined) {
    return await sendHtmlMessage(message.chat.id, html, {
      label: `${label}Fallback`,
      replyToMessageId,
    });
  }

  return sent;
}

/** Sends plain text safely without HTML parsing, preserving `entities` or splitting UTF-16 safely. */
export async function sendTextSafely(chatId, text, options = {}) {
  const str = text === null || text === undefined ? '' : String(text);
  if (!str) return { ok: false, message: null };

  const maxLen = options.maxLen ?? MAX_TEXT_LENGTH;
  const commonParams = {
    ...buildThreadParams(options.messageThreadId),
    ...buildNotificationParams(options.disableNotification),
    ...buildReplyParams(options.replyToMessageId),
  };
  const callOpts = { rethrowTopicError: Boolean(options.rethrowTopicError) };

  if (str.length <= maxLen) {
    const params = { chat_id: chatId, text: str, ...commonParams };
    if (Array.isArray(options.entities) && options.entities.length > 0) params.entities = options.entities;
    const sent = await safeCall(() => api.sendMessage(params), 'sendText', callOpts);
    return { ok: Boolean(sent), message: sent };
  }

  const chunks = splitTextSafely(str, maxLen);
  if (chunks.length === 0) return { ok: false, message: null };

  let lastSent = null;
  let allOk = true;
  for (const chunk of chunks) {
    const sent = await safeCall(
      () => api.sendMessage({ chat_id: chatId, text: chunk, ...commonParams }),
      'sendTextChunk',
      callOpts
    );
    if (sent) lastSent = sent;
    else allOk = false;
  }

  return { ok: allOk, message: lastSent };
}
