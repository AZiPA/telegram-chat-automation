import { DEBUG_RAW_UPDATES } from '../lib/config.js';
import { logRawUpdate } from '../lib/db/maintenance.js';
import { handlePrivateMessage } from '../lib/services/startService.js';

/**
 * Entry point for private `message` updates (handles owner `/start` status dashboard).
 *
 * @param {object} message
 * @param {object} [ctx]
 * @returns {Promise<void>}
 */
export default async function (message, ctx) {
  if (DEBUG_RAW_UPDATES) {
    await logRawUpdate('message', ctx?.update ?? message);
  }

  if (!message || message.chat?.type !== 'private') return;

  await handlePrivateMessage(message);
}
