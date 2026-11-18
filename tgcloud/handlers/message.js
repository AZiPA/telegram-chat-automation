import { DEBUG_RAW_UPDATES, setOwnerId } from '../lib/config.js';
import { logRawUpdate } from '../lib/db/maintenance.js';
import { handlePrivateMessage } from '../lib/services/startService.js';

/**
 * Entry point for private `message` updates (handles owner `/start` status dashboard
 * and explicit CI owner bootstrapping).
 *
 * @param {object} message
 * @param {object} [ctx]
 * @returns {Promise<void|{ ok: boolean }>}
 */
export default async function (message, ctx) {
  if (
    ctx?.ci_bootstrap === true &&
    !ctx?.update &&
    !message?.chat &&
    !message?.message_id
  ) {
    await setOwnerId(message?.owner_id);
    return { ok: true };
  }

  if (DEBUG_RAW_UPDATES) {
    await logRawUpdate('message', ctx?.update ?? message);
  }

  if (!message || message.chat?.type !== 'private') return;

  await handlePrivateMessage(message);
}
