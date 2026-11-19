import { DEFAULT_VIEW_ONCE_TRIGGER, MAX_TRIGGER_LENGTH, isOwner } from '../config.js';
import { listOwnerConnections } from '../db/connectionRepo.js';
import {
  getViewOnceConfig,
  setViewOnceAutoDelete,
  setViewOnceTrigger,
} from '../db/settings.js';
import { replyToPrivateMessage } from '../delivery/client.js';
import { escapeHtml } from '../media/formatting.js';

async function hasDeleteAllPermission(ownerId) {
  const conns = await listOwnerConnections(ownerId);
  const activeConn = conns.find((conn) => conn.isEnabled === true);
  return Boolean((activeConn?.rights ?? {}).can_delete_all_messages);
}

function buildPermissionWarningLine() {
  return (
    '⚠️ <b>Permission Note:</b> <code>can_delete_all_messages</code> is currently disabled. ' +
    'Enable <b>Delete Received Messages</b> in Telegram <b>Chat Automation</b> settings ' +
    '(Telegram Business → Chatbot) so matched trigger replies can be auto-deleted.'
  );
}

function validateTriggerInput(rawArg) {
  if (/[\r\n]/.test(rawArg)) {
    return {
      ok: false,
      errorHtml:
        '❌ <b>Invalid Trigger</b>\nTrigger text must be a single line and cannot contain newline characters.',
    };
  }

  const trimmed = rawArg.trim();
  if (!trimmed) {
    return {
      ok: false,
      errorHtml:
        '❌ <b>Invalid Trigger</b>\nTrigger text cannot be empty. Provide 1–32 characters, or use <code>/trigger reset</code>.',
    };
  }

  if (trimmed.length > MAX_TRIGGER_LENGTH) {
    return {
      ok: false,
      errorHtml: `❌ <b>Invalid Trigger</b>\nTrigger text is too long (${trimmed.length} characters). Maximum allowed length is ${MAX_TRIGGER_LENGTH} characters.`,
    };
  }

  return { ok: true, value: trimmed };
}

/**
 * Handles owner `/trigger` commands in private chat (`/trigger`, `/trigger <text>`, `/trigger reset`).
 *
 * @param {object} message
 * @param {number} ownerId
 * @param {string} [rawArg]
 * @returns {Promise<void>}
 */
export async function handleTriggerCommand(message, ownerId, rawArg = '') {
  if (message?.chat?.type !== 'private' || !isOwner(message.from?.id, ownerId)) return;

  if (rawArg === '') {
    const [{ trigger, autoDelete }, canDeleteAll] = await Promise.all([
      getViewOnceConfig(),
      hasDeleteAllPermission(ownerId),
    ]);
    const lines = [
      '🎯 <b>View-Once Smart Trigger</b>',
      `• <b>Current Trigger:</b> <code>${escapeHtml(trigger)}</code>`,
      `• <b>Auto-Delete Status:</b> ${autoDelete ? '✅ Enabled' : '❌ Disabled'}`,
    ];
    if (!canDeleteAll) {
      lines.push('', buildPermissionWarningLine());
    }
    lines.push(
      '',
      '<b>Usage:</b>',
      '• <code>/trigger !</code>',
      '• <code>/trigger save</code>',
      '• <code>/trigger reset</code>'
    );
    await replyToPrivateMessage(message, lines.join('\n'), 'triggerStatus');
    return;
  }

  const validation = validateTriggerInput(rawArg);
  if (!validation.ok) {
    await replyToPrivateMessage(message, validation.errorHtml, 'triggerValidationError');
    return;
  }

  if (validation.value.toLowerCase() === 'reset') {
    await setViewOnceTrigger(DEFAULT_VIEW_ONCE_TRIGGER);
    const html = [
      '✅ <b>View-Once Trigger Reset</b>',
      `Trigger text has been reset to default: <code>${escapeHtml(DEFAULT_VIEW_ONCE_TRIGGER)}</code>`,
    ].join('\n');
    await replyToPrivateMessage(message, html, 'triggerReset');
    return;
  }

  await setViewOnceTrigger(validation.value);
  const html = [
    '✅ <b>View-Once Trigger Updated</b>',
    `New trigger text: <code>${escapeHtml(validation.value)}</code>`,
    'Any reply to uncaptured view-once media still saves it; exact trigger matches are auto-deleted when enabled.',
  ].join('\n');
  await replyToPrivateMessage(message, html, 'triggerUpdated');
}

/**
 * Handles owner `/autodelete` commands in private chat (`/autodelete`, `/autodelete on`, `/autodelete off`).
 *
 * @param {object} message
 * @param {number} ownerId
 * @param {string} [rawArg]
 * @returns {Promise<void>}
 */
export async function handleAutoDeleteCommand(message, ownerId, rawArg = '') {
  if (message?.chat?.type !== 'private' || !isOwner(message.from?.id, ownerId)) return;

  const option = String(rawArg ?? '').trim().toLowerCase();
  if (!option) {
    const [{ trigger, autoDelete }, canDeleteAll] = await Promise.all([
      getViewOnceConfig(),
      hasDeleteAllPermission(ownerId),
    ]);
    const lines = [
      '🗑 <b>View-Once Auto-Delete</b>',
      `• <b>Status:</b> ${autoDelete ? '✅ Enabled' : '❌ Disabled'}`,
      `• <b>Current Trigger:</b> <code>${escapeHtml(trigger)}</code>`,
    ];
    if (!canDeleteAll) {
      lines.push('', buildPermissionWarningLine());
    }
    lines.push(
      '',
      '<b>Usage:</b>',
      '• <code>/autodelete on</code> — Auto-delete exact trigger replies after capture',
      '• <code>/autodelete off</code> — Keep all replies (view-once capture remains active)'
    );
    await replyToPrivateMessage(message, lines.join('\n'), 'autoDeleteStatus');
    return;
  }

  if (option === 'on') {
    await setViewOnceAutoDelete(true);
    const canDeleteAll = await hasDeleteAllPermission(ownerId);
    const lines = [
      '✅ <b>Auto-Delete Enabled</b>',
      'Exact trigger replies to view-once media will be auto-deleted after successful capture.',
    ];
    if (!canDeleteAll) {
      lines.push('', buildPermissionWarningLine());
    }
    await replyToPrivateMessage(message, lines.join('\n'), 'autoDeleteOn');
    return;
  }

  if (option === 'off') {
    await setViewOnceAutoDelete(false);
    const html = [
      '✅ <b>Auto-Delete Disabled</b>',
      'Replies will no longer be auto-deleted, while view-once capture continues to work on any reply.',
    ].join('\n');
    await replyToPrivateMessage(message, html, 'autoDeleteOff');
    return;
  }

  const invalidHtml =
    '❌ <b>Invalid Option</b>\nUse <code>/autodelete on</code> or <code>/autodelete off</code>.';
  await replyToPrivateMessage(message, invalidHtml, 'autoDeleteInvalidOption');
}
