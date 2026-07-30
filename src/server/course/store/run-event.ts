import type { DatabaseSync } from "node:sqlite";

import {
  type AppDatabaseOptions,
  resolveAppDatabase,
  runInTransaction,
} from "@/server/infra/database/connection";
import { createStorageId } from "@/server/infra/database/codec";

export type CourseRunEvent = {
  id: string;
  taskId: string;
  sequence: number;
  traceId: string;
  type: string;
  stage?: string;
  pageId?: string;
  agent?: string;
  safeSummary: string;
  payload: unknown;
  createdAt: string;
};

export type CourseRunEventWrite = Omit<CourseRunEvent, "id" | "sequence"> & {
  id?: string;
};

export type CourseRunEventStore = {
  database: DatabaseSync;
  append(
    input: CourseRunEventWrite,
    authorize?: () => void,
  ): CourseRunEvent;
  /**
   * sequence 只能在 CourseRunRepository 已开启的 BEGIN IMMEDIATE 事务里分配。
   */
  appendInTransaction(input: CourseRunEventWrite): CourseRunEvent;
  load(eventId: string): CourseRunEvent | undefined;
  list(taskId: string, afterSequence?: number): CourseRunEvent[];
  listAfter(input: {
    taskId: string;
    afterSequence: number;
  }): CourseRunEvent[];
  latestSequence(taskId: string): number;
};

type EventRow = {
  id: string;
  task_id: string;
  sequence: number;
  trace_id: string;
  type: string;
  stage: string | null;
  page_id: string | null;
  agent: string | null;
  safe_summary: string;
  payload: string;
  created_at: string;
};

const SELECT_COLUMNS = `
  id, task_id, sequence, trace_id, type, stage, page_id, agent, safe_summary,
  payload, created_at
`;

export function createCourseRunEventStore(
  options: AppDatabaseOptions = {},
): CourseRunEventStore {
  const database = resolveAppDatabase(options);
  const loadStatement = database.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM course_run_events
    WHERE id = ?
  `);

  const store: CourseRunEventStore = {
    database,

    append(input, authorize) {
      return runInTransaction(database, () => {
        authorize?.();
        return store.appendInTransaction(input);
      });
    },

    appendInTransaction(input) {
      if (!input.taskId || !input.traceId || !input.type) {
        throw new Error("CourseRun event 缺少 taskId、traceId 或 type");
      }
      if (!input.safeSummary.trim()) {
        throw new Error("CourseRun event 必须提供公开摘要");
      }
      if (input.id) {
        const existing = store.load(input.id);
        if (existing) {
          if (
            existing.taskId !== input.taskId ||
            existing.type !== input.type
          ) {
            throw new Error("event id 已绑定到不同事件");
          }
          return existing;
        }
      }

      const sequence = store.latestSequence(input.taskId) + 1;
      const event: CourseRunEvent = {
        id: input.id ?? createStorageId("run-event"),
        taskId: input.taskId,
        sequence,
        traceId: input.traceId,
        type: input.type,
        stage: input.stage,
        pageId: input.pageId,
        agent: input.agent,
        safeSummary: input.safeSummary,
        payload: input.payload,
        createdAt: input.createdAt,
      };
      database
        .prepare(`
          INSERT INTO course_run_events (
            id, task_id, sequence, trace_id, type, stage, page_id, agent,
            safe_summary, payload, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.id,
          event.taskId,
          event.sequence,
          event.traceId,
          event.type,
          event.stage ?? null,
          event.pageId ?? null,
          event.agent ?? null,
          event.safeSummary,
          JSON.stringify(event.payload),
          event.createdAt,
        );
      return event;
    },

    load(eventId) {
      const row = loadStatement.get(eventId) as EventRow | undefined;
      return row ? parseEventRow(row) : undefined;
    },

    list(taskId, afterSequence = 0) {
      return store.listAfter({ taskId, afterSequence });
    },

    listAfter({ taskId, afterSequence }) {
      if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
        throw new Error("CourseRun event afterSequence 必须是非负安全整数");
      }
      const rows = database
        .prepare(`
          SELECT ${SELECT_COLUMNS}
          FROM course_run_events
          WHERE task_id = ? AND sequence > ?
          ORDER BY sequence
        `)
        .all(taskId, afterSequence) as EventRow[];
      return rows.map(parseEventRow);
    },

    latestSequence(taskId) {
      const row = database
        .prepare(`
          SELECT COALESCE(MAX(sequence), 0) AS latest_sequence
          FROM course_run_events
          WHERE task_id = ?
        `)
        .get(taskId) as { latest_sequence: number };
      return row.latest_sequence;
    },
  };

  return store;
}

function parseEventRow(row: EventRow): CourseRunEvent {
  return {
    id: row.id,
    taskId: row.task_id,
    sequence: row.sequence,
    traceId: row.trace_id,
    type: row.type,
    stage: row.stage ?? undefined,
    pageId: row.page_id ?? undefined,
    agent: row.agent ?? undefined,
    safeSummary: row.safe_summary,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  };
}
