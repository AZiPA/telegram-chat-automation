import { api } from 'sdk';
import * as topicRepo from '../db/topicRepo.js';
import { isDeletedTopicError, safeCall } from './client.js';

const COOLDOWN_MS = 10 * 60_000;
const STALE_CLAIM_MS = 30_000;
const MAX_TOPIC_NAME_LENGTH = 120;
const WAIT_DELAYS_MS = [150, 300, 450];
let topicsDisabledUntil = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const buildTopicKey = (ownerChatId, peerChatId) => `${ownerChatId}:${peerChatId}`;
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

async function createAndPublishTopic(key, ownerChatId, desiredName, myClaimedAt) {
  try {
    const res = await api.createForumTopic({ chat_id: ownerChatId, name: desiredName });
    if (!res?.message_thread_id) throw new Error('createForumTopic returned no message_thread_id');

    const published = await topicRepo.publishTopicReady(key, myClaimedAt, res.message_thread_id, desiredName);
    if (published.length === 0) {
      await safeCall(
        () => api.deleteForumTopic({ chat_id: ownerChatId, message_thread_id: res.message_thread_id }),
        'deleteDuplicateForumTopic'
      );
      const winner = await topicRepo.findTopicByKey(key);
      return winner?.status === 'ready' && winner.threadId ? winner.threadId : undefined;
    }
    return res.message_thread_id;
  } catch (err) {
    await topicRepo.deleteCreatingClaim(key, myClaimedAt);
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

/** Resolves or atomically creates a per-contact private chat Forum Topic. */
export async function getOrCreateTopic(ownerChatId, peer) {
  if (!ownerChatId || !peer?.id || Date.now() < topicsDisabledUntil) return undefined;

  const key = buildTopicKey(ownerChatId, peer.id);
  const desiredName = buildTopicName(peer);
  const row = await topicRepo.findTopicByKey(key);

  if (row?.status === 'ready' && row.threadId) {
    if (hasPeerDisplayInfo(peer) && desiredName && row.name !== desiredName) {
      await topicRepo.updateTopicName(key, row.threadId, desiredName);
      await safeCall(
        () => api.editForumTopic({ chat_id: ownerChatId, message_thread_id: row.threadId, name: desiredName }),
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

  const myClaimedAt = Date.now();
  const inserted = !row
    ? await topicRepo.claimTopicCreation({ key, ownerChatId, peerChatId: peer.id, name: desiredName, claimedAt: myClaimedAt })
    : [];
  if (inserted.length > 0) return await createAndPublishTopic(key, ownerChatId, desiredName, myClaimedAt);

  for (const delayMs of WAIT_DELAYS_MS) {
    await sleep(delayMs);
    const current = await topicRepo.findTopicByKey(key);
    if (!current) break;
    if (current.status === 'ready' && current.threadId) return current.threadId;
    if (Date.now() - current.claimedAt > STALE_CLAIM_MS) {
      const myNewClaim = Date.now();
      const stolen = await topicRepo.stealStaleTopicClaim(key, current.claimedAt, myNewClaim);
      if (stolen.length > 0) return await createAndPublishTopic(key, ownerChatId, desiredName, myNewClaim);
    }
  }
  return undefined;
}

/** Delivers via the peer's topic and self-heals once if the thread was deleted/closed. */
export async function sendWithPeerTopic(ownerChatId, peer, sendFn) {
  const threadId = peer ? await getOrCreateTopic(ownerChatId, peer) : undefined;
  try {
    return await sendFn(threadId, false);
  } catch (err) {
    if (threadId && peer?.id && isDeletedTopicError(err)) {
      await topicRepo.deleteTopicByThreadId(buildTopicKey(ownerChatId, peer.id), threadId);
      const newThreadId = await getOrCreateTopic(ownerChatId, peer);
      return await sendFn(newThreadId, true);
    }
    throw err;
  }
}
