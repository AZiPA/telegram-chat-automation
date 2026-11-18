import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { settings, topics } from '../../schema.js';

export const TOPICS_DISABLED_UNTIL_KEY = 'topics_disabled_until';

/** Finds a topic row by its composite `${ownerChatId}:${peerChatId}` key. */
export async function findTopicByKey(key) {
  return await db.select().from(topics).where(eq(topics.key, key)).get();
}

/** Counts ready contact topics for the given owner chat. */
export async function countReadyTopics(ownerChatId) {
  return await db.$count(
    topics,
    and(eq(topics.ownerChatId, ownerChatId), eq(topics.status, 'ready'))
  );
}

/** Attempts an atomic lease insert for a new topic in `'creating'` state. */
export async function claimTopicCreation({ key, ownerChatId, peerChatId, name, claimedAt }) {
  return await db
    .insert(topics)
    .values({
      key,
      ownerChatId,
      peerChatId,
      threadId: null,
      name,
      status: 'creating',
      claimedAt,
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
}

/** Publishes a created forum topic if `claimedAt` still owns the lease. */
export async function publishTopicReady(key, claimedAt, threadId, name) {
  return await db
    .update(topics)
    .set({ status: 'ready', threadId, name, updatedAt: new Date() })
    .where(and(eq(topics.key, key), eq(topics.claimedAt, claimedAt)))
    .returning();
}

/** Attempts a compare-and-swap steal of a stale `'creating'` lock. */
export async function stealStaleTopicClaim(key, expectedClaimedAt, newClaimedAt) {
  return await db
    .update(topics)
    .set({ claimedAt: newClaimedAt, updatedAt: new Date() })
    .where(
      and(
        eq(topics.key, key),
        eq(topics.status, 'creating'),
        eq(topics.claimedAt, expectedClaimedAt)
      )
    )
    .returning();
}

/** Releases a `'creating'` claim owned by `claimedAt` after topic creation fails. */
export async function deleteCreatingClaim(key, claimedAt) {
  await db
    .delete(topics)
    .where(
      and(
        eq(topics.key, key),
        eq(topics.status, 'creating'),
        eq(topics.claimedAt, claimedAt)
      )
    )
    .run();
}

/** Conditionally deletes a stale topic row matching the deleted `threadId`. */
export async function deleteTopicByThreadId(key, threadId) {
  await db
    .delete(topics)
    .where(and(eq(topics.key, key), eq(topics.threadId, threadId)))
    .run();
}

/** Updates the cached topic name on an active topic row. */
export async function updateTopicName(key, threadId, name) {
  await db
    .update(topics)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(topics.key, key), eq(topics.threadId, threadId)))
    .run();
}

/** Reads the persisted unix-ms topic cooldown timestamp from `settings`. */
export async function getTopicsDisabledUntilSetting() {
  const row = await db
    .select()
    .from(settings)
    .where(eq(settings.key, TOPICS_DISABLED_UNTIL_KEY))
    .get();
  const parsed = Number(row?.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Persists or clears the topic cooldown setting in `settings`. */
export async function setTopicsDisabledUntilSetting(untilMs) {
  if (!untilMs) {
    await db.delete(settings).where(eq(settings.key, TOPICS_DISABLED_UNTIL_KEY)).run();
    return;
  }

  await db
    .insert(settings)
    .values({
      key: TOPICS_DISABLED_UNTIL_KEY,
      value: String(untilMs),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(untilMs), updatedAt: new Date() },
    })
    .run();
}
