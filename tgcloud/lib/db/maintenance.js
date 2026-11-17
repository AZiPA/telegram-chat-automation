import { db } from 'sdk';
import { lt } from 'sdk/db';
import { messages, rawUpdates } from '../../schema.js';
import {
  DEBUG_RAW_UPDATES,
  RAW_UPDATES_RETENTION_DAYS,
  RETENTION_DAYS,
} from '../config.js';

/**
 * Persists a raw Telegram update payload when `DEBUG_RAW_UPDATES` is enabled.
 *
 * @param {string} updateType
 * @param {unknown} payload
 * @returns {Promise<void>}
 */
export async function logRawUpdate(updateType, payload) {
  if (!DEBUG_RAW_UPDATES) return;
  try {
    await db
      .insert(rawUpdates)
      .values({
        updateType,
        payload: payload ?? {},
        createdAt: new Date(),
      })
      .run();
  } catch (err) {
    console.warn(`Failed to log raw update (${updateType}):`, err?.message ?? err);
  }
}

/**
 * Deletes expired archived messages and raw debug updates based on configured retention windows.
 *
 * @returns {Promise<void>}
 */
export async function pruneOldRecords() {
  try {
    const msgCutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000);
    const rawCutoff = new Date(Date.now() - RAW_UPDATES_RETENTION_DAYS * 86400_000);
    await db.delete(messages).where(lt(messages.createdAt, msgCutoff)).run();
    await db.delete(rawUpdates).where(lt(rawUpdates.createdAt, rawCutoff)).run();
  } catch (err) {
    console.error('pruneOldRecords failed:', err);
  }
}
