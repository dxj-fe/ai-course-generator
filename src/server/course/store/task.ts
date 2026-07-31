import {
  CourseIdSchema,
  CourseTaskIdSchema,
  CourseTaskRecordSchema,
  type CourseTaskRecord,
} from "@/shared/course-schema";
import {
  databasePathForRoot,
  getAppDatabase,
  runInTransaction,
} from "@/server/infra/database/connection";

/** 任务 ID 仍使用共享 Schema 约束，避免无效订阅键进入数据库。 */
export const StoredCourseTaskIdSchema = CourseTaskIdSchema;

export type CourseTaskStore = {
  load(taskId: string): Promise<CourseTaskRecord | undefined>;
  loadCourseClaim(courseId: string): Promise<string | undefined>;
  loadControlIntent(
    taskId: string,
  ): Promise<CourseTaskControlIntent | undefined>;
  /**
   * 在 SQLite 写锁内重读任务并登记取消意图。登记成功后，普通 save 不再
   * 允许把任务写回任何状态；只有携带同一 cancel 意图的终态提交可以收口。
   */
  requestCancel(
    taskId: string,
    requestedAt: string,
  ): Promise<CourseTaskRecord | undefined>;
  list(): Promise<CourseTaskStoreListResult>;
  /**
   * 以调用方刚读取到的完整记录作为比较条件执行原子写入。
   * expected 为 undefined 时只允许首次插入；已存在同名任务时返回 false。
   */
  save(
    record: CourseTaskRecord,
    condition: {
      expected: CourseTaskRecord | undefined;
      controlIntent?: "cancel";
    },
  ): Promise<boolean>;
};

export type CourseTaskControlIntent = {
  action: "cancel";
  courseId: string;
  taskId: string;
  traceId: string;
  requestedAt: string;
};

export type CourseTaskStoreListResult = {
  items: CourseTaskRecord[];
  unavailableCount: number;
};

type CourseTaskStoreOptions = {
  databasePath?: string;
  /** 测试可使用独立根目录隔离 SQLite 数据。 */
  rootDir?: string;
};

export function createCourseTaskStore(
  options: CourseTaskStoreOptions = {},
): CourseTaskStore {
  const database = getAppDatabase(
    options.databasePath ??
      (options.rootDir ? databasePathForRoot(options.rootDir) : undefined),
  );
  const loadStatement = database.prepare(
    "SELECT payload FROM course_tasks WHERE id = ?",
  );
  const listStatement = database.prepare(
    "SELECT payload FROM course_tasks ORDER BY updated_at DESC",
  );
  const insertStatement = database.prepare(`
    INSERT OR IGNORE INTO course_tasks
      (id, course_id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const compareAndSetStatement = database.prepare(`
    UPDATE course_tasks
    SET course_id = ?, payload = ?, created_at = ?, updated_at = ?
    WHERE id = ? AND payload = ?
  `);
  const loadCourseClaimStatement = database.prepare(`
    SELECT task_id AS taskId
    FROM course_execution_claims
    WHERE course_id = ?
  `);
  const insertCourseClaimStatement = database.prepare(`
    INSERT OR IGNORE INTO course_execution_claims
      (course_id, task_id, claimed_at, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const updateCourseClaimStatement = database.prepare(`
    UPDATE course_execution_claims
    SET updated_at = ?
    WHERE course_id = ? AND task_id = ?
  `);
  const deleteCourseClaimStatement = database.prepare(`
    DELETE FROM course_execution_claims
    WHERE course_id = ? AND task_id = ?
  `);
  const loadControlIntentStatement = database.prepare(`
    SELECT
      action,
      course_id AS courseId,
      task_id AS taskId,
      trace_id AS traceId,
      requested_at AS requestedAt
    FROM course_task_control_intents
    WHERE task_id = ?
  `);
  const upsertCancelIntentStatement = database.prepare(`
    INSERT INTO course_task_control_intents (
      task_id, course_id, action, trace_id, requested_at
    )
    VALUES (?, ?, 'cancel', ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      course_id = excluded.course_id,
      action = excluded.action,
      trace_id = excluded.trace_id,
      requested_at = excluded.requested_at
  `);
  const deleteControlIntentStatement = database.prepare(`
    DELETE FROM course_task_control_intents
    WHERE task_id = ? AND action = ?
  `);
  // CAS 比较数据库中实际读到的字节，避免对象重建改变字段顺序。
  const persistedPayloads = new WeakMap<CourseTaskRecord, string>();

  return {
    async load(taskId) {
      const safeTaskId = StoredCourseTaskIdSchema.parse(taskId);
      const row = loadStatement.get(safeTaskId) as
        | { payload: string }
        | undefined;
      if (!row) return undefined;
      const record = CourseTaskRecordSchema.parse(JSON.parse(row.payload));
      if (record.taskId !== safeTaskId) {
        throw new Error("课程任务 ID 与数据库主键不一致");
      }
      persistedPayloads.set(record, row.payload);
      return record;
    },

    async loadCourseClaim(courseId) {
      const safeCourseId = CourseIdSchema.parse(courseId);
      const row = loadCourseClaimStatement.get(safeCourseId) as
        | { taskId: string }
        | undefined;
      return row ? CourseTaskIdSchema.parse(row.taskId) : undefined;
    },

    async loadControlIntent(taskId) {
      const safeTaskId = StoredCourseTaskIdSchema.parse(taskId);
      return parseControlIntent(
        loadControlIntentStatement.get(safeTaskId) as
          | ControlIntentRow
          | undefined,
      );
    },

    async requestCancel(taskId, requestedAt) {
      const safeTaskId = StoredCourseTaskIdSchema.parse(taskId);
      const timestamp = parseTimestamp(requestedAt);
      return runInTransaction(database, () => {
        const row = loadStatement.get(safeTaskId) as
          | { payload: string }
          | undefined;
        if (!row) return undefined;
        const current = CourseTaskRecordSchema.parse(
          JSON.parse(row.payload),
        );
        if (current.taskId !== safeTaskId) {
          throw new Error("课程任务 ID 与数据库主键不一致");
        }
        persistedPayloads.set(current, row.payload);
        if (!isActiveTask(current)) return current;
        upsertCancelIntentStatement.run(
          current.taskId,
          current.courseId,
          current.traceId,
          timestamp,
        );
        return current;
      });
    },

    async list() {
      const rows = listStatement.all() as Array<{ payload: string }>;
      const items: CourseTaskRecord[] = [];
      let unavailableCount = 0;

      for (const row of rows) {
        try {
          const record = CourseTaskRecordSchema.parse(
            JSON.parse(row.payload),
          );
          persistedPayloads.set(record, row.payload);
          items.push(record);
        } catch {
          unavailableCount += 1;
        }
      }

      return { items, unavailableCount };
    },

    async save(record, condition) {
      const parsed = CourseTaskRecordSchema.parse(record);
      const expected = condition.expected
        ? CourseTaskRecordSchema.parse(condition.expected)
        : undefined;
      if (expected && expected.taskId !== parsed.taskId) {
        throw new Error("课程任务 CAS 的 expected 与新记录 taskId 不一致");
      }
      if (
        expected &&
        (expected.courseId !== parsed.courseId ||
          expected.createdAt !== parsed.createdAt)
      ) {
        throw new Error("课程任务 CAS 不允许更换 courseId 或 createdAt");
      }

      const payload = JSON.stringify(parsed);
      if (!expected) {
        const inserted = runInTransaction(database, () => {
          if (loadControlIntentStatement.get(parsed.taskId)) return false;
          const claim = loadCourseClaimStatement.get(parsed.courseId) as
            | { taskId: string }
            | undefined;
          if (
            isActiveTask(parsed) &&
            claim &&
            claim.taskId !== parsed.taskId
          ) {
            return false;
          }
          const acquiredClaim =
            isActiveTask(parsed) && !claim
              ? insertCourseClaimStatement.run(
                  parsed.courseId,
                  parsed.taskId,
                  parsed.createdAt,
                  parsed.updatedAt,
                ).changes === 1
              : false;
          if (isActiveTask(parsed) && !claim && !acquiredClaim) {
            return false;
          }

          const taskInserted =
            insertStatement.run(
              parsed.taskId,
              parsed.courseId,
              payload,
              parsed.createdAt,
              parsed.updatedAt,
            ).changes === 1;
          if (!taskInserted && acquiredClaim) {
            deleteCourseClaimStatement.run(
              parsed.courseId,
              parsed.taskId,
            );
          }
          return taskInserted;
        });
        if (inserted) persistedPayloads.set(record, payload);
        return inserted;
      }

      const result = runInTransaction(database, () => {
        const controlIntent = parseControlIntent(
          loadControlIntentStatement.get(parsed.taskId) as
            | ControlIntentRow
            | undefined,
        );
        if (
          controlIntent &&
          (condition.controlIntent !== controlIntent.action ||
            !isTerminalTask(parsed) ||
            controlIntent.courseId !== parsed.courseId ||
            controlIntent.traceId !== expected.traceId)
        ) {
          return false;
        }
        if (condition.controlIntent && !controlIntent) return false;

        if (
          expected.status === "paused" &&
          parsed.status === "queued" &&
          hasTerminalExecutionState(database, expected)
        ) {
          return false;
        }
        const claim = loadCourseClaimStatement.get(parsed.courseId) as
          | { taskId: string }
          | undefined;
        if (
          isActiveTask(parsed) &&
          claim &&
          claim.taskId !== parsed.taskId
        ) {
          return false;
        }
        const acquiredClaim =
          isActiveTask(parsed) && !claim
            ? insertCourseClaimStatement.run(
                parsed.courseId,
                parsed.taskId,
                parsed.createdAt,
                parsed.updatedAt,
              ).changes === 1
            : false;
        if (isActiveTask(parsed) && !claim && !acquiredClaim) {
          return false;
        }

        const updated =
          compareAndSetStatement.run(
            parsed.courseId,
            payload,
            parsed.createdAt,
            parsed.updatedAt,
            parsed.taskId,
            persistedPayloads.get(condition.expected!) ??
              JSON.stringify(expected),
          ).changes === 1;
        if (!updated) {
          if (acquiredClaim) {
            deleteCourseClaimStatement.run(
              parsed.courseId,
              parsed.taskId,
            );
          }
          return false;
        }

        if (isActiveTask(parsed)) {
          updateCourseClaimStatement.run(
            parsed.updatedAt,
            parsed.courseId,
            parsed.taskId,
          );
        } else {
          deleteCourseClaimStatement.run(
            parsed.courseId,
            parsed.taskId,
          );
        }
        if (condition.controlIntent) {
          deleteControlIntentStatement.run(
            parsed.taskId,
            condition.controlIntent,
          );
        }
        return true;
      });
      if (result) persistedPayloads.set(record, payload);
      return result;
    },
  };
}

function isActiveTask(record: CourseTaskRecord) {
  return (
    record.status === "queued" ||
    record.status === "running" ||
    record.status === "paused"
  );
}

function isTerminalTask(record: CourseTaskRecord) {
  return (
    record.status === "completed" ||
    record.status === "failed" ||
    record.status === "cancelled"
  );
}

type ControlIntentRow = {
  action: string;
  courseId: string;
  taskId: string;
  traceId: string;
  requestedAt: string;
};

function parseControlIntent(
  row: ControlIntentRow | undefined,
): CourseTaskControlIntent | undefined {
  if (!row) return undefined;
  if (row.action !== "cancel") {
    throw new Error(`未知课程任务控制意图：${row.action}`);
  }
  return {
    action: row.action,
    courseId: CourseIdSchema.parse(row.courseId),
    taskId: CourseTaskIdSchema.parse(row.taskId),
    traceId: parseNonEmpty(row.traceId, "控制意图 traceId"),
    requestedAt: parseTimestamp(row.requestedAt),
  };
}

function parseTimestamp(value: string) {
  const timestamp = value.trim();
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    throw new Error("控制意图时间必须是有效时间");
  }
  return timestamp;
}

function parseNonEmpty(value: string, field: string) {
  const parsed = value.trim();
  if (!parsed) throw new Error(`${field} 不能为空`);
  return parsed;
}

function hasTerminalExecutionState(
  database: ReturnType<typeof getAppDatabase>,
  task: CourseTaskRecord,
) {
  const row = database
    .prepare(`
      SELECT
        EXISTS (
          SELECT 1
          FROM course_runs
          WHERE task_id = ?
            AND phase IN ('completed', 'failed', 'cancelled')
        ) AS terminalRun,
        EXISTS (
          SELECT 1
          FROM courses
          WHERE id = ?
            AND json_extract(payload, '$.traceId') = ?
            AND json_extract(payload, '$.status')
              IN ('completed', 'failed', 'cancelled')
        ) AS terminalCourse
    `)
    .get(task.taskId, task.courseId, task.traceId) as
    | { terminalRun: number; terminalCourse: number }
    | undefined;
  return row?.terminalRun === 1 || row?.terminalCourse === 1;
}
