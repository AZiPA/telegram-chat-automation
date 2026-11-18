import { isOwner } from '../config.js';
import { getActiveOwnerConnection } from '../db/connectionRepo.js';
import {
  applyMessageEdit,
  findMessage,
  insertMessage,
  touchMessageEditDate,
} from '../db/messageRepo.js';
import { deliverEditDiffReport, deliverUnarchivedEditReport } from '../delivery/editReport.js';
import { buildMessageRecord, extractMessageContent } from '../media/extractor.js';
import { formatSenderRaw } from '../media/formatting.js';
import { isMeaningfulEdit } from '../media/textEdit.js';

function buildEditSnapshot(storedRow, editedAt) {
  return {
    editedAt: editedAt.toISOString(),
    editDate: storedRow.editDate ?? null,
    mediaType: storedRow.mediaType,
    text: storedRow.text ?? null,
    caption: storedRow.caption ?? null,
    entities: storedRow.entities ?? null,
    captionEntities: storedRow.captionEntities ?? null,
    fileId: storedRow.fileId ?? null,
    fileUniqueId: storedRow.fileUniqueId ?? null,
    fileSize: storedRow.fileSize ?? null,
    fileName: storedRow.fileName ?? null,
    mimeType: storedRow.mimeType ?? null,
    extra: storedRow.extra ?? null,
  };
}

function buildEditUpdateFields(storedRow, newContent, senderRaw, editedAt, editDate) {
  return {
    senderName: senderRaw,
    mediaGroupId: newContent.mediaGroupId,
    mediaType: newContent.mediaType,
    text: newContent.text,
    caption: newContent.caption,
    entities: newContent.entities,
    captionEntities: newContent.captionEntities,
    fileId: newContent.fileId,
    fileUniqueId: newContent.fileUniqueId,
    fileSize: newContent.fileSize,
    fileName: newContent.fileName,
    mimeType: newContent.mimeType,
    extra: newContent.extra,
    editDate,
    editHistory: [...(storedRow.editHistory ?? []), buildEditSnapshot(storedRow, editedAt)],
  };
}

function buildEditPeer(message) {
  return {
    id: message.chat.id,
    first_name: message.chat.first_name ?? message.from?.first_name,
    last_name: message.chat.last_name ?? message.from?.last_name,
    username: message.chat.username ?? message.from?.username,
    title: message.chat.title,
  };
}

/** Processes `edited_business_message`, recording history and sending silent diff reports. */
export async function handleEditedBusinessMessage(message) {
  const conn = await getActiveOwnerConnection(message.business_connection_id);
  if (!conn) return;
  if (isOwner(message.from?.id, conn.ownerUserId)) return;

  const newContent = extractMessageContent(message);
  const senderRaw = formatSenderRaw(message.from, message.chat);
  const chatRaw = formatSenderRaw(null, message.chat);
  const peer = buildEditPeer(message);
  const hasNumericEditDate = typeof message.edit_date === 'number';
  const editedAt = hasNumericEditDate ? new Date(message.edit_date * 1000) : new Date();

  const storedRow = await findMessage(conn.connectionId, message.chat.id, message.message_id);

  if (!storedRow) {
    const createdAt = typeof message.date === 'number' ? new Date(message.date * 1000) : new Date();
    const record = buildMessageRecord({
      connectionId: conn.connectionId,
      chatId: message.chat.id,
      senderId: message.from?.id ?? message.chat.id,
      senderName: senderRaw,
      isIncoming: true,
      messageId: message.message_id,
      content: newContent,
      editDate: hasNumericEditDate ? message.edit_date : null,
      createdAt,
    });

    await insertMessage(record);
    await deliverUnarchivedEditReport(conn.ownerChatId, record, senderRaw, chatRaw, editedAt, { peer });
    return;
  }

  if (hasNumericEditDate && storedRow.editDate === message.edit_date) return;

  if (!isMeaningfulEdit(storedRow, newContent)) {
    if (hasNumericEditDate) await touchMessageEditDate(storedRow.id, message.edit_date);
    return;
  }

  const nextEditDate = hasNumericEditDate ? message.edit_date : storedRow.editDate ?? null;
  const updateFields = buildEditUpdateFields(storedRow, newContent, senderRaw, editedAt, nextEditDate);
  const applied = await applyMessageEdit(storedRow.id, storedRow.editDate, updateFields, hasNumericEditDate);
  if (!applied) return;

  await deliverEditDiffReport(conn.ownerChatId, storedRow, newContent, senderRaw, chatRaw, editedAt, { peer });
}
