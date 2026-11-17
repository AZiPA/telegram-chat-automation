import { DEBUG_RAW_UPDATES } from '../lib/config.js';
import { logRawUpdate } from '../lib/db/maintenance.js';
import { handleBusinessMessage } from '../lib/services/businessMessageService.js';

/**
 * Entry point for `business_message` updates.
 *
 * @param {object} message
 * @param {object} [ctx]
 * @returns {Promise<void>}
 */
export default async function (message, ctx) {
  if (DEBUG_RAW_UPDATES) {
    await logRawUpdate('business_message', ctx?.update ?? message);
  }

  if (!message?.business_connection_id) return;
  if (message.chat?.type !== 'private') return;
  if (message.chat?.id === undefined || message.chat?.id === null) return;
  if (typeof message.message_id !== 'number') return;

  await handleBusinessMessage(message);
}
