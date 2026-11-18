import { api } from 'sdk';
import * as topicRepo from '../db/topicRepo.js';
import { isDeletedTopicError, safeCall } from './client.js';

const COOLDOWN_MS = 10 * 60_000;
const STALE_CLAIM_MS = 30_000;
const BRAND_NEW_TOPIC_GRACE_MS = 5_000;
const PROPAGATION_RETRY_DELAY_MS = 500;
const MAX_TOPIC_NAME_LENGTH = 120;
const WAIT_DELAYS_MS = [200, 400, 700];
let topicsDisabledUntil = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasPeerDisplayInfo = (p) => Boolean(p && (p.first_name || p.last_name || p.title || p.username));

function truncateUtf16Safe(str, maxLen = MAX_TOPIC_NAME_LENGTH) {
  if (str.length <= maxLen) return str;
  let end = maxLen - 1;
  if (end > 0 && str.charCodeAt(end - 1) >= 0xd800 && str.charCodeAt(end - 1) <= 0xdbff) end -= 1;
  return `${str.slice(0, end)}…`;
}

/** Builds a clean Forum Topic title for a contact, safely truncated to 120 chars. */
export function buildTopicName(peer) {
  if (!peer || typeof peer !== 'object') return '👤 Unknown';
  const clean = (v) => String(v).replace(/\s+/g, ' ').trim();
  const fullName =
    [peer.first_name, peer.last_name].filter(Boolean).map(clean).filter(Boolean).join(' ') ||
    (peer.title ? clean(peer.title) : '');
  const username = peer.username ? `@${String(peer.username).replace(/^@/, '').trim()}` : '';
  const hasId = peer.id !== undefined && peer.id !== null;

  let label = hasId ? `👤 Contact [${peer.id}]` : '👤 Unknown';
  if (fullName && username) label = `👤 ${fullName} (${username})`;
  else if (fullName) label = hasId ? `👤 ${fullName} [${peer.id}]` : `👤 ${fullName}`;
  else if (username) label = hasId ? `👤 ${username} [${peer.id}]` : `👤 ${username}`;
  return truncateUtf16Safe(label, MAX_TOPIC_NAME_LENGTH);
}

/** Clears the Threaded Mode disabled cooldown in both memory and database. */
export async function clearTopicsCooldown() {
  topicsDisabledUntil = 0;
  await topicRepo.setTopicsDisabledUntilSetting(null);
}

async function createAndPublishTopic(peerId, ownerId, desiredName, myClaim) {
  let created = null;
  try {
    created = await api.createForumTopic({ chat_id: ownerId, name: desiredName });
    if (!created?.message_thread_id) {
      throw new Error('createForumTopic returned no message_thread_id');
    }

    const published = await topicRepo.publishTopicReady(
      peerId,
      myClaim,
      created.message_thread_id,
      desiredName
    );
    if (published.length === 0) {
      await safeCall(
        () =>
          api.deleteForumTopic({
            chat_id: ownerId,
            message_thread_id: created.message_thread_id,
          }),
        'deleteDuplicateForumTopic'
      );
      const winner = await topicRepo.findTopicByPeerId(peerId);
      return winner?.status === 'ready' && winner.threadId ? winner.threadId : undefined;
    }
    return created.message_thread_id;
  } catch (err) {
    if (created?.message_thread_id) {
      await safeCall(
        () =>
          api.deleteForumTopic({
            chat_id: ownerId,
            message_thread_id: created.message_thread_id,
          }),
        'deleteOrphanForumTopic'
      );
    }
    await topicRepo.deleteCreatingClaim(peerId, myClaim);
    if (err?.code === 400) {
      topicsDisabledUntil = Date.now() + COOLDOWN_MS;
      await topicRepo.setTopicsDisabledUntilSetting(topicsDisabledUntil);
      console.warn('[topics] Threaded Mode unavailable (400); pausing topic creation for 10m');
    } else {
      console.error('[topics] createForumTopic failed:', err?.message ?? err);
    }
    return undefined;
  }
}

async function tryStealStaleClaim(current, peerId, ownerId, desiredName) {
  if (current?.status !== 'creating' || Date.now() - current.claimedAt <= STALE_CLAIM_MS) {
    return null;
  }
  const stealClaim = Math.max(Date.now(), current.claimedAt + 1);
  const stolen = await topicRepo.stealStaleTopicClaim(
    peerId,
    current.claimedAt,
    stealClaim,
    ownerId,
    desiredName
  );
  if (stolen.length === 0) return null;
  return await createAndPublishTopic(peerId, ownerId, desiredName, stealClaim);
}

async function waitForTopicWinner(peerId, ownerId, desiredName) {
  const existing = await topicRepo.findTopicByPeerId(peerId);
  if (!existing) return undefined;
  if (existing.status === 'ready' && existing.threadId) return existing.threadId;

  const stolenFirst = await tryStealStaleClaim(existing, peerId, ownerId, desiredName);
  if (stolenFirst !== null) return stolenFirst;

  for (const delayMs of WAIT_DELAYS_MS) {
    await sleep(delayMs);
    const current = await topicRepo.findTopicByPeerId(peerId);
    if (!current) break;
    if (current.status === 'ready' && current.threadId) return current.threadId;

    const stolen = await tryStealStaleClaim(current, peerId, ownerId, desiredName);
    if (stolen !== null) return stolen;
  }
  return undefined;
}

/** Resolves or atomically creates a per-contact private chat Forum Topic. */
export async function getOrCreateTopic(ownerChatId, peer) {
  const peerId = Number(peer?.id);
  if (!Number.isSafeInteger(peerId) || peerId === 0) return undefined;

  const ownerId = Number(ownerChatId);
  if (!Number.isSafeInteger(ownerId) || ownerId === 0) return undefined;
  if (Date.now() < topicsDisabledUntil) return undefined;

  const desiredName = buildTopicName(peer);
  const row = await topicRepo.findTopicByPeerId(peerId);

  if (row?.status === 'ready' && row.threadId) {
    if (hasPeerDisplayInfo(peer) && desiredName && row.name !== desiredName) {
      await topicRepo.updateTopicName(peerId, row.threadId, desiredName);
      await safeCall(
        () =>
          api.editForumTopic({
            chat_id: ownerId,
            message_thread_id: row.threadId,
            name: desiredName,
          }),
        'editForumTopic'
      );
    }
    return row.threadId;
  }

  const dbDisabledUntil = await topicRepo.getTopicsDisabledUntilSetting();
  if (Date.now() < dbDisabledUntil) {
    topicsDisabledUntil = dbDisabledUntil;
    return undefined;
  }

  const myClaim = Date.now();
  const won = await topicRepo.claimTopicCreation({
    peerId,
    ownerId,
    name: desiredName,
    claimedAt: myClaim,
  });
  if (won.length > 0) {
    return await createAndPublishTopic(peerId, ownerId, desiredName, myClaim);
  }

  return await waitForTopicWinner(peerId, ownerId, desiredName);
}

async function retryAfterPropagationDelay(sendFn, threadId) {
  await sleep(PROPAGATION_RETRY_DELAY_MS);
  try {
    return await sendFn(threadId, false);
  } catch (retryErr) {
    if (isDeletedTopicError(retryErr)) {
      return await sendFn(undefined, true);
    }
    throw retryErr;
  }
}

async function sendWithThreadAndGrace(sendFn, targetThreadId) {
  if (!targetThreadId) return await sendFn(undefined, true);
  try {
    return await sendFn(targetThreadId, false);
  } catch (retryErr) {
    if (isDeletedTopicError(retryErr)) {
      return await retryAfterPropagationDelay(sendFn, targetThreadId);
    }
    throw retryErr;
  }
}

/** Delivers via the peer's topic and self-heals once if the thread was deleted/closed. */
export async function sendWithPeerTopic(ownerChatId, peer, sendFn) {
  const threadId = peer ? await getOrCreateTopic(ownerChatId, peer) : undefined;
  try {
    return await sendFn(threadId, false);
  } catch (err) {
    const peerId = Number(peer?.id);
    if (threadId && Number.isSafeInteger(peerId) && peerId !== 0 && isDeletedTopicError(err)) {
      const row = await topicRepo.findTopicByPeerId(peerId);

      if (row && row.threadId === threadId && Date.now() - row.claimedAt < BRAND_NEW_TOPIC_GRACE_MS) {
        return await retryAfterPropagationDelay(sendFn, threadId);
      }

      if (row && row.status === 'ready' && row.threadId && row.threadId !== threadId) {
        return await sendWithThreadAndGrace(sendFn, row.threadId);
      }

      await topicRepo.deleteTopicByThreadId(peerId, threadId);
      const newThreadId = await getOrCreateTopic(ownerChatId, peer);
      return await sendWithThreadAndGrace(sendFn, newThreadId);
    }
    throw err;
  }
}
