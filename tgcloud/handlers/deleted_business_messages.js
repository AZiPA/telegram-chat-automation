import { DEBUG_RAW_UPDATES } from '../lib/config.js';
import { logRawUpdate } from '../lib/db/maintenance.js';
import { handleDeletedBusinessMessages } from '../lib/services/deleteService.js';

/**
 * Entry point for `deleted_business_messages` updates.
 *
 * @param {object} payload
 * @param {object} [ctx]
 * @returns {Promise<void>}
 */
export default async function (payload, ctx) {
  if (DEBUG_RAW_UPDATES) {
    await logRawUpdate('deleted_business_messages', ctx?.update ?? payload);
  }

  if (!payload?.business_connection_id || payload?.chat?.id == null) return;
  if (payload.chat.type && payload.chat.type !== 'private') return;
  if (!Array.isArray(payload.message_ids) || payload.message_ids.length === 0) return;

  await handleDeletedBusinessMessages(payload);
}
