import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CourseTaskRecordSchema } from "@/shared/course-schema";

const DEFAULT_DATABASE_PATH = path.join(
  process.cwd(),
  ".data",
  "keya.sqlite",
);
const globalDatabase = globalThis as typeof globalThis & {
  __keyaDatabase?: DatabaseSync;
};

export type AppDatabaseOptions = {
  database?: DatabaseSync;
  databasePath?: string;
  rootDir?: string;
};

export function getAppDatabase(databasePath = DEFAULT_DATABASE_PATH) {
  const resolvedPath = path.resolve(databasePath);
  if (resolvedPath === path.resolve(DEFAULT_DATABASE_PATH)) {
    globalDatabase.__keyaDatabase ??= openDatabase(resolvedPath);
    return globalDatabase.__keyaDatabase;
  }
  return openDatabase(resolvedPath);
}

/**
 * 新运行时的多个 Store 必须共享同一个 DatabaseSync 连接，才能把状态、产物和事件
 * 放进同一同步事务。测试仍可通过 rootDir 获得隔离数据库。
 */
export function resolveAppDatabase(options: AppDatabaseOptions = {}) {
  if (options.database) return options.database;
  return getAppDatabase(
    options.databasePath ??
      (options.rootDir ? databasePathForRoot(options.rootDir) : undefined),
  );
}

export function databasePathForRoot(rootDir: string) {
  return path.join(path.resolve(rootDir), "keya.sqlite");
}

export function runInTransaction<Result>(
  database: DatabaseSync,
  operation: () => Result,
) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function openDatabase(databasePath: string) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS courses_updated_at_idx
      ON courses(updated_at DESC);

    CREATE TABLE IF NOT EXISTS course_tasks (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS course_tasks_course_id_idx
      ON course_tasks(course_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS course_tasks_updated_at_idx
      ON course_tasks(updated_at DESC);

    CREATE TABLE IF NOT EXISTS course_execution_claims (
      course_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      claimed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS course_task_control_intents (
      task_id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('cancel')),
      trace_id TEXT NOT NULL,
      requested_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS course_task_control_intents_course_idx
      ON course_task_control_intents(course_id);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      course_id TEXT,
      task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS conversations_updated_at_idx
      ON conversations(updated_at DESC);

    CREATE INDEX IF NOT EXISTS conversations_course_id_idx
      ON conversations(course_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      duration TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS messages_conversation_created_at_idx
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS html_previews (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS html_previews_expires_at_idx
      ON html_previews(expires_at);

    CREATE TABLE IF NOT EXISTS asset_cache_entries (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_request_sets (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS course_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      course_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      lock_version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS course_runs_phase_lease_idx
      ON course_runs(phase, lease_expires_at);

    CREATE TABLE IF NOT EXISTS course_work_orders (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      parent_work_order_id TEXT,
      supersedes_work_order_id TEXT,
      kind TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      status TEXT NOT NULL,
      lock_version INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      lease_owner TEXT,
      lease_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS course_work_orders_task_status_idx
      ON course_work_orders(task_id, status, updated_at);

    CREATE INDEX IF NOT EXISTS course_work_orders_parent_idx
      ON course_work_orders(parent_work_order_id, created_at);

    CREATE TABLE IF NOT EXISTS course_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      course_id TEXT NOT NULL,
      page_id TEXT,
      scope_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      revision INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      created_by_work_order_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(task_id, course_id, scope_key, kind, revision),
      UNIQUE(
        task_id, course_id, scope_key, kind, content_hash,
        created_by_work_order_id
      )
    );

    CREATE INDEX IF NOT EXISTS course_artifacts_course_kind_idx
      ON course_artifacts(course_id, kind, scope_key, revision DESC);

    CREATE TABLE IF NOT EXISTS course_tool_operations (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      execution_attempt INTEGER NOT NULL,
      agent_step_number INTEGER NOT NULL,
      tool_ordinal INTEGER NOT NULL,
      tool_call_id TEXT,
      tool_name TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      logical_operation_key TEXT,
      status TEXT NOT NULL,
      output_artifact_refs TEXT NOT NULL,
      safe_summary TEXT,
      usage TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      UNIQUE(
        work_order_id,
        execution_attempt,
        agent_step_number,
        tool_ordinal
      ),
      UNIQUE(logical_operation_key)
    );

    CREATE INDEX IF NOT EXISTS course_tool_operations_order_idx
      ON course_tool_operations(
        work_order_id,
        execution_attempt,
        agent_step_number,
        tool_ordinal
      );

    CREATE TABLE IF NOT EXISTS course_run_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      trace_id TEXT NOT NULL,
      type TEXT NOT NULL,
      stage TEXT,
      page_id TEXT,
      agent TEXT,
      safe_summary TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(task_id, sequence)
    );

    CREATE INDEX IF NOT EXISTS course_run_events_task_sequence_idx
      ON course_run_events(task_id, sequence);

  `);

  reconcileCourseExecutionClaims(database);
  reconcileCourseTaskControlIntents(database);
  return database;
}

/** 启动时校正活动任务的课程执行权，避免并发任务写入同一门课程。 */
function reconcileCourseExecutionClaims(database: DatabaseSync) {
  const claims = database
    .prepare(
      `SELECT course_id AS courseId, task_id AS taskId
       FROM course_execution_claims`,
    )
    .all() as Array<{ courseId: string; taskId: string }>;
  const loadTask = database.prepare(
    "SELECT course_id AS courseId, payload FROM course_tasks WHERE id = ?",
  );
  const deleteClaim = database.prepare(
    "DELETE FROM course_execution_claims WHERE course_id = ? AND task_id = ?",
  );
  const insertClaim = database.prepare(`
    INSERT OR IGNORE INTO course_execution_claims
      (course_id, task_id, claimed_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);

  runInTransaction(database, () => {
    for (const claim of claims) {
      const row = loadTask.get(claim.taskId) as
        | { courseId: string; payload: string }
        | undefined;
      const parsed = row ? parseStoredCourseTask(row.payload) : undefined;
      if (
        !parsed?.success ||
        row?.courseId !== claim.courseId ||
        parsed.data.courseId !== claim.courseId ||
        !isActiveCourseTaskStatus(parsed.data.status)
      ) {
        deleteClaim.run(claim.courseId, claim.taskId);
      }
    }

    const timestamp = new Date().toISOString();
    const rows = database
      .prepare(
        `SELECT payload
         FROM course_tasks
         ORDER BY updated_at DESC, created_at DESC, id DESC`,
      )
      .all() as Array<{ payload: string }>;
    for (const row of rows) {
      const parsed = parseStoredCourseTask(row.payload);
      if (
        !parsed?.success ||
        !isActiveCourseTaskStatus(parsed.data.status)
      ) {
        continue;
      }
      insertClaim.run(
        parsed.data.courseId,
        parsed.data.taskId,
        timestamp,
        parsed.data.updatedAt,
      );
    }
  });
}

function parseStoredCourseTask(payload: string) {
  try {
    return CourseTaskRecordSchema.safeParse(JSON.parse(payload));
  } catch {
    return undefined;
  }
}

function isActiveCourseTaskStatus(
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled",
) {
  return status === "queued" || status === "running" || status === "paused";
}

/**
 * cancel intent 是故障恢复输入：活动任务保留并对齐到它的当前 trace；任务已经
 * 终态化或损坏时清理孤儿 intent，避免无效行长期污染控制面。
 */
function reconcileCourseTaskControlIntents(database: DatabaseSync) {
  const rows = database
    .prepare(`
      SELECT task_id AS taskId, course_id AS courseId, trace_id AS traceId
      FROM course_task_control_intents
      WHERE action = 'cancel'
    `)
    .all() as Array<{
    taskId: string;
    courseId: string;
    traceId: string;
  }>;
  const loadTask = database.prepare(
    "SELECT payload FROM course_tasks WHERE id = ?",
  );
  const deleteIntent = database.prepare(
    "DELETE FROM course_task_control_intents WHERE task_id = ?",
  );
  const alignIntent = database.prepare(`
    UPDATE course_task_control_intents
    SET course_id = ?, trace_id = ?
    WHERE task_id = ? AND action = 'cancel'
  `);

  runInTransaction(database, () => {
    for (const row of rows) {
      const taskRow = loadTask.get(row.taskId) as
        | { payload: string }
        | undefined;
      const parsed = taskRow
        ? parseStoredCourseTask(taskRow.payload)
        : undefined;
      if (
        !parsed?.success ||
        !isActiveCourseTaskStatus(parsed.data.status)
      ) {
        deleteIntent.run(row.taskId);
        continue;
      }
      if (
        row.courseId !== parsed.data.courseId ||
        row.traceId !== parsed.data.traceId
      ) {
        alignIntent.run(
          parsed.data.courseId,
          parsed.data.traceId,
          row.taskId,
        );
      }
    }
  });
}
