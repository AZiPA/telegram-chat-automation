import {
  HEADERS,
  LABELS,
  getOwnerId,
  isOwner,
  formatHtmlTimestamp,
} from '../config.js';
import { upsertBusinessConnection } from '../db/connectionRepo.js';
import { sendHtmlMessage } from '../delivery/client.js';
import { escapeHtml } from '../media/formatting.js';

/**
 * Persists an owner's Telegram Business connection state & rights and sends a status notice.
 *
 * @param {object} connection
 * @returns {Promise<void>}
 */
export async function handleBusinessConnection(connection) {
  const connectionId = connection.id;
  const userId = connection.user.id;
  const userChatId = connection.user_chat_id;

  const ownerId = await getOwnerId();
  if (ownerId === null) {
    console.warn('[auth] owner_id is not seeded in settings table yet');
    return;
  }

  if (!isOwner(userId, ownerId)) return;

  const storedRights = connection.rights ?? null;
  const rights = storedRights ?? {};
  const isEnabled = Boolean(connection.is_enabled);
  const now = new Date();

  await upsertBusinessConnection({
    connectionId,
    ownerUserId: userId,
    ownerChatId: userChatId,
    rights: storedRights,
    isEnabled,
    updatedAt: now,
  });

  const statusHeader = isEnabled
    ? HEADERS.connectionEnabled
    : HEADERS.connectionDisabled;

  const lines = [
    statusHeader,
    `${LABELS.sentAt}: ${formatHtmlTimestamp(connection.date ?? now)}`,
  ];

  if (isEnabled) {
    lines.push(
      rights.can_read_messages
        ? '✅ Read messages permission (<code>can_read_messages</code>) is enabled.'
        : '⚠️ Read messages permission (<code>can_read_messages</code>) is disabled; enable it to archive messages.'
    );
    lines.push(
      rights.can_delete_all_messages
        ? '✅ Delete all messages permission (<code>can_delete_all_messages</code>) is enabled; trigger replies for view-once capture will be deleted automatically.'
        : '⚠️ Delete all messages permission (<code>can_delete_all_messages</code>) is disabled; your trigger reply will remain in the chat.'
    );
    if (Object.keys(rights).length === 0) {
      lines.push(
        'ℹ️ Permissions list was empty; if needed, toggle the bot off and back on in Telegram Business settings.'
      );
    }
  }

  await sendHtmlMessage(userChatId, lines.join('\n'), {
    label: 'businessConnectionNotify',
  });
}
