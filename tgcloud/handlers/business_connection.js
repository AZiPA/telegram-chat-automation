import { DEBUG_RAW_UPDATES } from '../lib/config.js';
import { logRawUpdate } from '../lib/db/maintenance.js';
import { handleBusinessConnection } from '../lib/services/connectionService.js';

/**
 * Entry point for `business_connection` updates.
 *
 * @param {object} connection
 * @param {object} [ctx]
 * @returns {Promise<void>}
 */
export default async function (connection, ctx) {
  if (DEBUG_RAW_UPDATES) {
    await logRawUpdate('business_connection', ctx?.update ?? connection);
  }

  if (
    !connection?.id ||
    connection.user?.id === undefined ||
    connection.user?.id === null ||
    typeof connection.user_chat_id !== 'number'
  ) {
    return;
  }

  await handleBusinessConnection(connection);
}
