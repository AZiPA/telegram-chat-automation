import { api, BotApiError } from 'sdk';
import { MAX_TEXT_LENGTH } from '../config.js';
import { splitTextSafely } from '../media/textEdit.js';

const TOPIC_DELETED_RE = /message thread not found|TOPIC_DELETED|TOPIC_CLOSED|thread_id_invalid/i;

/** Returns true when `err` is a BotApiError indicating a deleted/closed topic thread. */
export function isDeletedTopicError(err) {
  if (!err) return false;
  const isBotErr = err instanceof BotApiError || err?.name === 'BotApiError';
  return isBotErr && typeof err.description === 'string' && TOPIC_DELETED_RE.test(err.description);
}

/** Executes a Bot API call safely, retrying 429 once (<=5s) and rethrowing topic errors if requested. */
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

/** Sends a Bot API message formatted with `parse_mode: 'HTML'`. */
export async function sendHtmlMessage(chatId, html, options = {}) {
  if (!html) return null;
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
    options.label ?? 'sendHtmlMessage',
    { rethrowTopicError: Boolean(options.rethrowTopicError) }
  );
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
