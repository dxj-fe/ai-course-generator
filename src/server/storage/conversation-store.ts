import {
  ConversationIdSchema,
  ConversationListResponseSchema,
  ConversationRecordSchema,
  SaveConversationInputSchema,
  UpdateConversationInputSchema,
  type ConversationRecord,
  type SaveConversationInput,
  type UpdateConversationInput,
} from "@/shared/course-schema";
import {
  getAppDatabase,
  runInTransaction,
} from "@/server/storage/database";

export type ConversationStore = {
  list(): Promise<ReturnType<typeof ConversationListResponseSchema.parse>>;
  load(id: string): Promise<ConversationRecord | undefined>;
  save(input: SaveConversationInput): Promise<ConversationRecord>;
  update(
    id: string,
    input: UpdateConversationInput,
  ): Promise<ConversationRecord | undefined>;
  delete(id: string): Promise<boolean>;
};

export function createConversationStore(databasePath?: string): ConversationStore {
  const database = getAppDatabase(databasePath);
  const listConversations = database.prepare(`
    SELECT id, title, pinned, course_id, task_id, created_at, updated_at
    FROM conversations
    ORDER BY updated_at DESC
    LIMIT 200
  `);
  const loadConversation = database.prepare(`
    SELECT id, title, pinned, course_id, task_id, created_at, updated_at
    FROM conversations
    WHERE id = ?
  `);
  const loadMessages = database.prepare(`
    SELECT id, role, content, duration, created_at
    FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at, rowid
  `);
  const upsertConversation = database.prepare(`
    INSERT INTO conversations (
      id, title, pinned, course_id, task_id, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      pinned = excluded.pinned,
      course_id = COALESCE(excluded.course_id, conversations.course_id),
      task_id = COALESCE(excluded.task_id, conversations.task_id),
      updated_at = excluded.updated_at
  `);
  const insertMessage = database.prepare(`
    INSERT INTO messages (
      id, conversation_id, role, content, duration, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      content = excluded.content,
      duration = excluded.duration
  `);
  const deleteConversation = database.prepare(`
    DELETE FROM conversations
    WHERE id = ?
  `);

  return {
    async list() {
      const rows = listConversations.all() as ConversationRow[];
      const items: ConversationRecord[] = [];
      let unavailableCount = 0;

      for (const row of rows) {
        try {
          items.push(recordFromRow(row, loadMessages));
        } catch {
          unavailableCount += 1;
        }
      }

      return ConversationListResponseSchema.parse({
        items,
        unavailableCount,
      });
    },

    async load(id) {
      const safeId = ConversationIdSchema.parse(id);
      const row = loadConversation.get(safeId) as ConversationRow | undefined;
      return row ? recordFromRow(row, loadMessages) : undefined;
    },

    async save(input) {
      const parsed = SaveConversationInputSchema.parse(input);
      const timestamp = new Date().toISOString();
      const existing = loadConversation.get(parsed.id) as
        | ConversationRow
        | undefined;
      runInTransaction(database, () => {
        upsertConversation.run(
          parsed.id,
          parsed.title,
          parsed.pinned === undefined
            ? (existing?.pinned ?? 0)
            : parsed.pinned
              ? 1
              : 0,
          parsed.courseId ?? null,
          parsed.taskId ?? null,
          parsed.messages[0]?.createdAt ?? timestamp,
          timestamp,
        );
        for (const message of parsed.messages) {
          insertMessage.run(
            message.id,
            parsed.id,
            message.role,
            message.content,
            message.duration ?? null,
            message.createdAt,
          );
        }
      });
      return (await this.load(parsed.id))!;
    },

    async update(id, input) {
      const safeId = ConversationIdSchema.parse(id);
      const parsed = UpdateConversationInputSchema.parse(input);
      const existing = loadConversation.get(safeId) as
        | ConversationRow
        | undefined;
      if (!existing) return undefined;

      const timestamp = new Date().toISOString();
      runInTransaction(database, () => {
        database
          .prepare(`
            UPDATE conversations
            SET title = ?, pinned = ?, course_id = ?, task_id = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(
            parsed.title ?? existing.title,
            parsed.pinned === undefined
              ? existing.pinned
              : parsed.pinned
                ? 1
                : 0,
            parsed.courseId ?? existing.course_id,
            parsed.taskId ?? existing.task_id,
            timestamp,
            safeId,
          );

        for (const message of parsed.appendMessages ?? []) {
          insertMessage.run(
            message.id,
            safeId,
            message.role,
            message.content,
            message.duration ?? null,
            message.createdAt,
          );
        }

        if (parsed.updateMessage) {
          const result = database
            .prepare(`
              UPDATE messages
              SET content = COALESCE(?, content),
                  duration = CASE WHEN ? THEN ? ELSE duration END
              WHERE id = ? AND conversation_id = ?
            `)
            .run(
              parsed.updateMessage.content ?? null,
              parsed.updateMessage.duration !== undefined ? 1 : 0,
              parsed.updateMessage.duration ?? null,
              parsed.updateMessage.id,
              safeId,
            );
          if (result.changes === 0) {
            throw new Error("找不到需要更新的会话消息");
          }
        }
      });

      return (await this.load(safeId))!;
    },

    async delete(id) {
      const safeId = ConversationIdSchema.parse(id);
      return deleteConversation.run(safeId).changes > 0;
    },
  };
}

type ConversationRow = {
  id: string;
  title: string;
  pinned: number;
  course_id: string | null;
  task_id: string | null;
  created_at: string;
  updated_at: string;
};

type MessageStatement = {
  all(id: string): unknown[];
};

function recordFromRow(row: ConversationRow, messageStatement: MessageStatement) {
  const messages = messageStatement.all(row.id) as Array<{
    id: string;
    role: string;
    content: string;
    duration: string | null;
    created_at: string;
  }>;

  return ConversationRecordSchema.parse({
    id: row.id,
    title: row.title,
    pinned: row.pinned === 1,
    courseId: row.course_id ?? undefined,
    taskId: row.task_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      duration: message.duration ?? undefined,
      createdAt: message.created_at,
    })),
  });
}

export const conversationStore = createConversationStore();
