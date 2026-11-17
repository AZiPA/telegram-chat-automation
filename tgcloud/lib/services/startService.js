import {
  HEADERS,
  LABELS,
  RIGHTS_CHECKLIST,
  getOwnerId,
  isOwner,
  formatTimestamp,
} from '../config.js';
import { listOwnerConnections } from '../db/connectionRepo.js';
import { sendHtmlMessage } from '../delivery/client.js';
import { escapeHtml } from '../media/formatting.js';

function formatConnectionSection(conn) {
  const rights = conn.rights ?? {};
  const rightsKeys = Object.keys(rights);
  const shortId =
    conn.connectionId.length > 14
      ? `${conn.connectionId.slice(0, 6)}...${conn.connectionId.slice(-4)}`
      : conn.connectionId;

  const lines = [
    '',
    `🔗 <b>Registered Connection:</b> <code>${escapeHtml(shortId)}</code>`,
    `⚡ <b>Status:</b> ${conn.isEnabled ? '✅ Enabled' : '❌ Disabled'}`,
    `${LABELS.updatedAt}: ${escapeHtml(formatTimestamp(conn.updatedAt))}`,
  ];

  if (rightsKeys.length === 0) {
    lines.push(
      '',
      '⚠️ <b>Permissions (rights) are empty or not recorded.</b>',
      'Please toggle the bot off and back on under <b>Telegram Business → Chatbot</b> in Telegram Settings to refresh permissions.'
    );
  } else {
    lines.push('', '📋 <b>Granted Permissions:</b>');
    for (const [key, label] of RIGHTS_CHECKLIST) {
      const granted = Boolean(rights[key]);
      lines.push(
        `${granted ? '✅' : '❌'} ${escapeHtml(label)} (<code>${escapeHtml(key)}</code>)`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Handles private `/start` commands from the configured owner, displaying
 * the Telegram Business connection & rights status dashboard.
 *
 * @param {object} message
 * @returns {Promise<void>}
 */
export async function handlePrivateMessage(message) {
  const ownerId = await getOwnerId();
  if (ownerId === null) {
    console.warn('[auth] owner_id is not seeded in settings table yet');
    return;
  }

  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const isStartCommand = /^\/start(?:@\S+)?(?:\s|$)/.test(text);

  if (!isOwner(message.from?.id, ownerId) || !isStartCommand) return;

  const ownerConns = await listOwnerConnections(ownerId);

  if (!ownerConns.length) {
    const emptyMsg = [
      HEADERS.startTitle,
      '',
      '❌ No Telegram Business connection is registered yet.',
      '',
      'To enable it:',
      '1. Open <b>Settings → Telegram Business → Chatbot</b> in Telegram.',
      '2. Add this bot and grant permissions to read and manage messages.',
    ].join('\n');

    await sendHtmlMessage(message.chat.id, emptyMsg, { label: 'startNoConnection' });
    return;
  }

  const sections = [HEADERS.startTitle, ...ownerConns.map(formatConnectionSection)];
  await sendHtmlMessage(message.chat.id, sections.join('\n\n'), {
    label: 'startDashboard',
  });
}
