import {
  table,
  integer,
  text,
  boolean,
  json,
  index,
  uniqueIndex,
  sql,
} from 'sdk/db';

export const connections = table('connections', {
  connectionId: text('connection_id').primaryKey(),
  ownerUserId: integer('owner_user_id').notNull(),
  ownerChatId: integer('owner_chat_id').notNull(),
  rights: json('rights'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const settings = table('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const messages = table(
  'messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    businessConnectionId: text('business_connection_id').notNull(),
    chatId: integer('chat_id').notNull(),
    senderId: integer('sender_id').notNull(),
    senderName: text('sender_name'),
    isIncoming: boolean('is_incoming').notNull(),
    messageId: integer('message_id').notNull(),
    mediaGroupId: text('media_group_id'),
    mediaType: text('media_type').notNull(),
    text: text('text'),
    caption: text('caption'),
    entities: json('entities'),
    captionEntities: json('caption_entities'),
    fileId: text('file_id'),
    fileUniqueId: text('file_unique_id'),
    fileSize: integer('file_size'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    extra: json('extra'),
    editDate: integer('edit_date'),
    editHistory: json('edit_history').default([]),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
    notifiedDeleteAt: integer('notified_delete_at', { mode: 'timestamp' }),
    viewOnceCapturedAt: integer('view_once_captured_at', { mode: 'timestamp' }),
  },
  (t) => ({
    uidxMsgConnChatMsg: uniqueIndex('uidx_msg_conn_chat_msg').on(
      t.businessConnectionId,
      t.chatId,
      t.messageId
    ),
    idxMsgCreated: index('idx_msg_created').on(t.createdAt),
    idxMsgChat: index('idx_msg_chat').on(t.chatId),
  })
);

export const rawUpdates = table(
  'raw_updates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    updateType: text('update_type').notNull(),
    payload: json('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  },
  (t) => ({
    idxRawCreated: index('idx_raw_created').on(t.createdAt),
  })
);

export const topics = table(
  'topics',
  {
    key: text('key').primaryKey(), // `${ownerChatId}:${peerChatId}`
    ownerChatId: integer('owner_chat_id').notNull(),
    peerChatId: integer('peer_chat_id').notNull(),
    threadId: integer('thread_id'), // null while status === 'creating'
    name: text('name'),
    status: text('status').notNull(), // 'creating' | 'ready'
    claimedAt: integer('claimed_at').notNull(), // unix ms (Date.now()) for lease expiration
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  },
  (t) => ({
    peerIdx: index('idx_topics_peer').on(t.peerChatId),
  })
);
