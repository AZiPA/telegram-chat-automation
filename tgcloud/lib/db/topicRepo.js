import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { settings, topics } from '../../schema.js';

export const TOPICS_DISABLED_UNTIL_KEY = 'topics_disabled_until';

/** Finds a topic row by its peer ID primary key. */
export async function findTopicByPeerId(peerId) {
  return await db.select().from(topics).where(eq(topics.peerId, peerId)).get();
}

/** Counts ready contact topics for the given owner chat. */
export async function countReadyTopics(ownerId) {
  return await db.$count(
    topics,
    and(eq(topics.ownerId, ownerId), eq(topics.status, 'ready'))
  );
}

/** Attempts an atomic lease insert for a new topic in `'creating'` state. */
export async function claimTopicCreation({ peerId, ownerId, name, claimedAt }) {
  return await db
    .insert(topics)
    .values({
      peerId,
      ownerId,
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
export async function publishTopicReady(peerId, claimedAt, threadId, name) {
  return await db
    .update(topics)
    .set({ status: 'ready', threadId, name, updatedAt: new Date() })
    .where(and(eq(topics.peerId, peerId), eq(topics.claimedAt, claimedAt)))
    .returning();
}

/** Attempts a compare-and-swap steal of a stale `'creating'` lock. */
export async function stealStaleTopicClaim(
  peerId,
  expectedClaimedAt,
  newClaimedAt,
  ownerId,
  name
) {
  return await db
    .update(topics)
    .set({ ownerId, name, claimedAt: newClaimedAt, updatedAt: new Date() })
    .where(
      and(
        eq(topics.peerId, peerId),
        eq(topics.status, 'creating'),
        eq(topics.claimedAt, expectedClaimedAt)
      )
    )
    .returning();
}

/** Releases a `'creating'` claim owned by `claimedAt` after topic creation fails. */
export async function deleteCreatingClaim(peerId, claimedAt) {
  await db
    .delete(topics)
    .where(
      and(
        eq(topics.peerId, peerId),
        eq(topics.status, 'creating'),
        eq(topics.claimedAt, claimedAt)
      )
    )
    .run();
}

/** Conditionally deletes a stale topic row matching the deleted `threadId`. */
export async function deleteTopicByThreadId(peerId, threadId) {
  await db
    .delete(topics)
    .where(and(eq(topics.peerId, peerId), eq(topics.threadId, threadId)))
    .run();
}

/** Updates the cached topic name on an active topic row. */
export async function updateTopicName(peerId, threadId, name) {
  await db
    .update(topics)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(topics.peerId, peerId), eq(topics.threadId, threadId)))
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
