import { db } from 'sdk';
import { inArray } from 'sdk/db';
import { settings } from '../../schema.js';
import {
  DEFAULT_VIEW_ONCE_TRIGGER,
  DELETE_TRIGGER_REPLY,
  MAX_TRIGGER_LENGTH,
  SETTINGS_KEYS,
} from '../config.js';

async function upsertSetting(key, value) {
  const now = new Date();
  await db
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: now },
    })
    .run();
}

/**
 * Reads the Hybrid Smart Trigger configuration from the `settings` table in a single query.
 *
 * @returns {Promise<{ trigger: string, autoDelete: boolean }>}
 */
export async function getViewOnceConfig() {
  const rows = await db
    .select()
    .from(settings)
    .where(
      inArray(settings.key, [
        SETTINGS_KEYS.VIEW_ONCE_TRIGGER,
        SETTINGS_KEYS.VIEW_ONCE_AUTODELETE,
      ])
    )
    .all();

  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  const rawTrigger = byKey.get(SETTINGS_KEYS.VIEW_ONCE_TRIGGER);
  const trimmedTrigger = typeof rawTrigger === 'string' ? rawTrigger.trim() : '';
  const trigger = trimmedTrigger.length > 0 ? trimmedTrigger : DEFAULT_VIEW_ONCE_TRIGGER;

  const rawAutoDelete = byKey.get(SETTINGS_KEYS.VIEW_ONCE_AUTODELETE);
  const autoDelete =
    rawAutoDelete === 'false'
      ? false
      : rawAutoDelete === 'true'
        ? true
        : Boolean(DELETE_TRIGGER_REPLY);

  return { trigger, autoDelete };
}

/**
 * Validates and saves the configured view-once trigger text in the `settings` table.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function setViewOnceTrigger(text) {
  if (typeof text !== 'string' || /[\r\n]/.test(text)) {
    throw new Error('Trigger text must be a single-line string');
  }
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > MAX_TRIGGER_LENGTH) {
    throw new Error(`Trigger text must be between 1 and ${MAX_TRIGGER_LENGTH} characters`);
  }

  await upsertSetting(SETTINGS_KEYS.VIEW_ONCE_TRIGGER, trimmed);
}

/**
 * Persists whether exact trigger replies to view-once media should be auto-deleted.
 *
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setViewOnceAutoDelete(enabled) {
  await upsertSetting(SETTINGS_KEYS.VIEW_ONCE_AUTODELETE, enabled ? 'true' : 'false');
}

/**
 * Checks whether an outgoing reply message text matches the configured trigger (case-insensitive).
 *
 * @param {object|null|undefined} message
 * @param {string|null|undefined} configuredTrigger
 * @returns {boolean}
 */
export function isTriggerReplyMatch(message, configuredTrigger) {
  if (typeof message?.text !== 'string') return false;
  if (typeof configuredTrigger !== 'string') return false;

  const normalizedTrigger = configuredTrigger.trim().toLowerCase();
  if (!normalizedTrigger) return false;

  return message.text.trim().toLowerCase() === normalizedTrigger;
}
