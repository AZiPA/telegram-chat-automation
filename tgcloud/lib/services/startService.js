import { db } from 'sdk';
import { eq } from 'sdk/db';
import { messages } from '../../schema.js';
import {
  HEADERS,
  LABELS,
  RIGHTS_CHECKLIST,
  getOwnerId,
  isOwner,
  formatTimestamp,
} from '../config.js';
import { listOwnerConnections } from '../db/connectionRepo.js';
import { countReadyTopics, findTopicByKey } from '../db/topicRepo.js';
import { sendHtmlMessage } from '../delivery/client.js';
import { clearTopicsCooldown } from '../delivery/topics.js';
import { escapeHtml } from '../media/formatting.js';

function formatConnectionSection(conn) {
  const rights = conn.rights ?? {};
  const rightsKeys = Object.keys(rights);
  const shortId =
    conn.connectionId.length > 14
      ? `${conn.connectionId.slice(0, 6)}...${conn.connectionId.slice(-4)}`
      : conn.connectionId;

  const lines = [
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

function formatTopicsSection(activeTopicsCount) {
  return [
    '🧵 <b>Contact Topics</b>',
    `• <b>Active Topics:</b> ${activeTopicsCount}`,
    '• <b>Tip:</b> Enable <b>Threaded Mode</b> in <b>@BotFather</b> (Bot Settings → Threads Settings → Threaded Mode) for per-contact topic organization, then send /start to retry immediately.',
  ].join('\n');
}

async function buildContactArchiveSummary(ownerChatId, targetChatId) {
  const archivedCount = await db.$count(messages, eq(messages.chatId, targetChatId));
  const topicRow = await findTopicByKey(`${ownerChatId}:${targetChatId}`);
  const hasTopic = Boolean(topicRow?.status === 'ready' && topicRow.threadId);
  const topicStatus = hasTopic
    ? `✅ Active — ${escapeHtml(topicRow.name || `Thread #${topicRow.threadId}`)} (<code>${topicRow.threadId}</code>)`
    : '❌ None yet';

  return [
    '📊 <b>Contact Archive Summary</b>',
    `💬 <b>Chat ID:</b> <code>${targetChatId}</code>`,
    `🗂 <b>Archived Messages:</b> ${archivedCount}`,
    `🧵 <b>Dedicated Topic:</b> ${topicStatus}`,
  ].join('\n');
}

/**
 * Handles private `/start` commands (including `bizChat...` deep links) from the
 * configured owner, resetting topic cooldown and displaying the status dashboard.
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

  const rawText = typeof message.text === 'string' ? message.text : '';
  const startMatch = rawText.trim().match(/^\/start(?:@\S+)?(?:\s+(.*))?$/s);

  if (!isOwner(message.from?.id, ownerId) || !startMatch) return;

  await clearTopicsCooldown();

  const payload = (startMatch[1] ?? '').trim();
  const deepLinkMatch = payload.match(/^(?:bizChat)?(-?\d+)$/);
  const parsedChatId = deepLinkMatch ? Number(deepLinkMatch[1]) : null;
  const targetChatId = Number.isSafeInteger(parsedChatId) ? parsedChatId : null;

  const ownerConns = await listOwnerConnections(ownerId);
  const activeTopicsCount = await countReadyTopics(message.chat.id);
  const archiveSummarySection =
    targetChatId !== null
      ? await buildContactArchiveSummary(message.chat.id, targetChatId)
      : null;

  const sections = [HEADERS.startTitle];
  if (!ownerConns.length) {
    sections.push(
      [
        '❌ No Telegram Business connection is registered yet.',
        '',
        'To enable it:',
        '1. Open <b>Settings → Telegram Business → Chatbot</b> in Telegram.',
        '2. Add this bot and grant permissions to read and manage messages.',
      ].join('\n')
    );
  } else {
    sections.push(...ownerConns.map(formatConnectionSection));
  }

  sections.push(formatTopicsSection(activeTopicsCount));
  if (archiveSummarySection) {
    sections.push(archiveSummarySection);
  }

  await sendHtmlMessage(message.chat.id, sections.join('\n\n'), {
    label: ownerConns.length ? 'startDashboard' : 'startNoConnection',
  });
}
