import { db } from 'sdk';
import { eq } from 'sdk/db';
import { messages } from '../../schema.js';
import {
  HEADERS,
  LABELS,
  RIGHTS_CHECKLIST,
  isOwner,
  formatHtmlTimestamp,
} from '../config.js';
import { listOwnerConnections } from '../db/connectionRepo.js';
import { getViewOnceConfig } from '../db/settings.js';
import { countReadyTopics, findTopicByPeerId } from '../db/topicRepo.js';
import { replyToPrivateMessage } from '../delivery/client.js';
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
    `${LABELS.updatedAt}: ${formatHtmlTimestamp(conn.updatedAt)}`,
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

function formatSmartTriggerSection({ trigger, autoDelete }) {
  return [
    '🎯 <b>View-Once Smart Trigger</b>',
    `• <b>Trigger Text:</b> <code>${escapeHtml(trigger)}</code>`,
    `• <b>Auto-Delete Trigger Reply:</b> ${autoDelete ? '✅ Enabled' : '❌ Disabled'}`,
    '• <b>Commands:</b> /trigger, /autodelete',
  ].join('\n');
}

async function buildContactArchiveSummary(ownerChatId, targetChatId) {
  const archivedCount = await db.$count(messages, eq(messages.chatId, targetChatId));
  const topicRow = await findTopicByPeerId(targetChatId);
  const hasTopic = Boolean(
    topicRow?.status === 'ready' && topicRow.threadId && topicRow.ownerId === ownerChatId
  );
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
 * @param {number} ownerId
 * @param {string} [rawPayload]
 * @returns {Promise<void>}
 */
export async function handleStartCommand(message, ownerId, rawPayload = '') {
  if (message?.chat?.type !== 'private' || !isOwner(message.from?.id, ownerId)) return;

  await clearTopicsCooldown();

  const payload = String(rawPayload ?? '').trim();
  const deepLinkMatch = payload.match(/^(?:bizChat)?(-?\d+)$/);
  const parsedChatId = deepLinkMatch ? Number(deepLinkMatch[1]) : null;
  const targetChatId = Number.isSafeInteger(parsedChatId) ? parsedChatId : null;

  const ownerConns = await listOwnerConnections(ownerId);
  const activeTopicsCount = await countReadyTopics(message.chat.id);
  const viewOnceConfig = await getViewOnceConfig();
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
  sections.push(formatSmartTriggerSection(viewOnceConfig));
  if (archiveSummarySection) {
    sections.push(archiveSummarySection);
  }

  const html = sections.join('\n\n');
  const label = ownerConns.length ? 'startDashboard' : 'startNoConnection';
  await replyToPrivateMessage(message, html, label);
}
