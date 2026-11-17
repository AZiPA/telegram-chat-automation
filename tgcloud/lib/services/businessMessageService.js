import { isOwner } from '../config.js';
import { getActiveOwnerConnection } from '../db/connectionRepo.js';
import { pruneOldRecords } from '../db/maintenance.js';
import { insertMessage } from '../db/messageRepo.js';
import { buildMessageRecord, extractMessageContent } from '../media/extractor.js';
import { formatSenderRaw } from '../media/formatting.js';
import { handleViewOnceReplyTrigger } from './viewOnceService.js';

/**
 * Archives incoming and outgoing private Business messages, performs opportunistic
 * retention pruning, and triggers view-once capture when the owner replies to media.
 *
 * @param {object} message
 * @returns {Promise<void>}
 */
export async function handleBusinessMessage(message) {
  const conn = await getActiveOwnerConnection(message.business_connection_id);
  if (!conn) return;

  if (Math.random() < 0.02) {
    await pruneOldRecords();
  }

  const isIncoming = !isOwner(message.from?.id, conn.ownerUserId);
  const content = extractMessageContent(message);
  const senderName = formatSenderRaw(message.from, message.chat);
  const createdAt =
    typeof message.date === 'number' ? new Date(message.date * 1000) : new Date();

  const record = buildMessageRecord({
    connectionId: conn.connectionId,
    chatId: message.chat.id,
    senderId: message.from?.id ?? message.chat.id,
    senderName,
    isIncoming,
    messageId: message.message_id,
    content,
    editDate: typeof message.edit_date === 'number' ? message.edit_date : null,
    createdAt,
  });

  await insertMessage(record);

  if (!isIncoming && message.reply_to_message) {
    await handleViewOnceReplyTrigger(conn, message);
  }
}
