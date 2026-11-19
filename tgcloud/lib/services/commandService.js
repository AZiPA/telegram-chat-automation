import { getOwnerId, isOwner } from '../config.js';
import { handleStartCommand } from './startService.js';
import { handleAutoDeleteCommand, handleTriggerCommand } from './viewOnceCommandService.js';

const COMMAND_HANDLERS = {
  start: handleStartCommand,
  trigger: handleTriggerCommand,
  autodelete: handleAutoDeleteCommand,
};

/**
 * Parses a Telegram bot command message into its normalized command name and raw trailing text.
 *
 * @param {unknown} rawText
 * @returns {{ command: string, rawArg: string }|null}
 */
export function parseBotCommand(rawText) {
  if (typeof rawText !== 'string') return null;

  const trimmed = rawText.trim();
  const match = trimmed.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?=$|\s)([\s\S]*)$/i);
  if (!match) return null;

  return {
    command: match[1].toLowerCase(),
    rawArg: match[2] ?? '',
  };
}

/**
 * Routes private chat bot commands from the configured owner, silently ignoring
 * non-private chats, non-owners, and unrecognized messages.
 *
 * @param {object} message
 * @returns {Promise<void>}
 */
export async function handlePrivateMessage(message) {
  if (!message || message.chat?.type !== 'private') return;

  const parsed = parseBotCommand(message.text);
  if (!parsed) return;

  const handler = COMMAND_HANDLERS[parsed.command];
  if (!handler) return;

  const ownerId = await getOwnerId();
  if (ownerId === null) {
    console.warn('[auth] owner_id is not seeded in settings table yet');
    return;
  }

  if (!isOwner(message.from?.id, ownerId)) return;

  await handler(message, ownerId, parsed.rawArg);
}
