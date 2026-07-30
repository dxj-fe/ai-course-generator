import {
  CourseIdSchema,
  CourseGenerationStateSchema,
  CourseTaskIdSchema,
  CourseTaskStatusSchema,
  type CourseGenerationState,
  type CourseTaskRecord,
} from "@/shared/course-schema";
import {
  databasePathForRoot,
  getAppDatabase,
} from "@/server/infra/database/connection";

/** 课程 ID 仍使用共享 Schema 约束，避免无效主键进入数据库。 */
export const StoredCourseIdSchema = CourseIdSchema;

export type CourseStore = {
  load(courseId: string): Promise<CourseGenerationState | undefined>;
  list(): Promise<CourseStoreListResult>;
  /**
   * 以调用方刚读取到的课程检查点执行原子写入。expected 为 undefined 时
   * 只允许首次插入；taskFence 会在同一条 SQLite 语句中核对 TaskRecord，
   * 避免 pause/cancel 与旧 runner 写 checkpoint 之间出现 TOCTOU 竞态。
   */
  save(
    state: CourseGenerationState,
    condition: {
      expected: CourseGenerationState | undefined;
      taskFence?: CourseStoreTaskFence;
    },
  ): Promise<boolean>;
};

export type CourseStoreTaskFence = {
  taskId: string;
  traceId: string;
  statuses: readonly CourseTaskRecord["status"][];
  controlIntent?: "cancel";
};

export type CourseStoreListResult = {
  items: CourseGenerationState[];
  unavailableCount: number;
};

type CourseStoreOptions = {
  databasePath?: string;
  /** 保留测试和调用方兼容性；数据会写入该目录内的 SQLite。 */
  rootDir?: string;
};

export function createCourseStore(
  options: CourseStoreOptions = {},
): CourseStore {
  const database = getAppDatabase(
    options.databasePath ??
      (options.rootDir ? databasePathForRoot(options.rootDir) : undefined),
  );
  const loadStatement = database.prepare(
    "SELECT payload FROM courses WHERE id = ?",
  );
  const listStatement = database.prepare(
    "SELECT payload FROM courses ORDER BY updated_at DESC",
  );
  // CAS 必须比较 load() 实际读到的 payload 字节；历史 JSON 字段顺序可能
  // 与当前 Schema 重新序列化后的顺序不同。
  const persistedPayloads = new WeakMap<CourseGenerationState, string>();

  return {
    async load(courseId) {
      const safeCourseId = StoredCourseIdSchema.parse(courseId);
      const row = loadStatement.get(safeCourseId) as
        | { payload: string }
        | undefined;
      if (!row) return undefined;
      const state = CourseGenerationStateSchema.parse(JSON.parse(row.payload));
      if (state.courseId !== safeCourseId) {
        throw new Error("课程检查点 ID 与数据库主键不一致");
      }
      persistedPayloads.set(state, row.payload);
      return state;
    },

    async list() {
      const rows = listStatement.all() as Array<{ payload: string }>;
      const items: CourseGenerationState[] = [];
      let unavailableCount = 0;

      for (const row of rows) {
        try {
          const state = CourseGenerationStateSchema.parse(
            JSON.parse(row.payload),
          );
          persistedPayloads.set(state, row.payload);
          items.push(state);
        } catch {
          unavailableCount += 1;
        }
      }

      return { items, unavailableCount };
    },

    async save(state, condition) {
      const parsed = CourseGenerationStateSchema.parse(state);
      const expected = condition.expected
        ? CourseGenerationStateSchema.parse(condition.expected)
        : undefined;
      if (expected && expected.courseId !== parsed.courseId) {
        throw new Error("课程检查点 CAS 的 expected 与新状态 courseId 不一致");
      }
      const taskFence = parseTaskFence(condition.taskFence, parsed.courseId);
      const payload = JSON.stringify(parsed);
      const fenceSql = buildTaskFenceSql(taskFence);
      const fenceParams = taskFence
        ? [
            taskFence.taskId,
            parsed.courseId,
            taskFence.traceId,
            ...taskFence.statuses,
          ]
        : [];

      const changes = expected
        ? database
            .prepare(`
              UPDATE courses
              SET payload = ?, updated_at = ?
              WHERE id = ? AND payload = ?
              ${fenceSql}
            `)
            .run(
              payload,
              parsed.updatedAt,
              parsed.courseId,
              persistedPayloads.get(condition.expected!) ??
                JSON.stringify(expected),
              ...fenceParams,
            ).changes
        : database
            .prepare(`
              INSERT INTO courses (id, payload, updated_at)
              SELECT ?, ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM courses WHERE id = ?
              )
              ${fenceSql}
            `)
            .run(
              parsed.courseId,
              payload,
              parsed.updatedAt,
              parsed.courseId,
              ...fenceParams,
            ).changes;
      if (changes === 1) persistedPayloads.set(state, payload);
      return changes === 1;
    },
  };
}

function parseTaskFence(
  fence: CourseStoreTaskFence | undefined,
  courseId: string,
) {
  if (!fence) return undefined;
  const taskId = CourseTaskIdSchema.parse(fence.taskId);
  const traceId = fence.traceId.trim();
  if (!traceId) throw new Error("课程检查点 taskFence.traceId 不能为空");
  const statuses = [
    ...new Set(
      fence.statuses.map(
        (status) => CourseTaskStatusSchema.parse(status),
      ),
    ),
  ];
  if (statuses.length === 0) {
    throw new Error("课程检查点 taskFence.statuses 不能为空");
  }
  if (
    fence.controlIntent !== undefined &&
    fence.controlIntent !== "cancel"
  ) {
    throw new Error("课程检查点 taskFence.controlIntent 无效");
  }
  CourseIdSchema.parse(courseId);
  return {
    taskId,
    traceId,
    statuses,
    controlIntent: fence.controlIntent,
  };
}

function buildTaskFenceSql(fence: CourseStoreTaskFence | undefined) {
  if (!fence) return "";
  const controlIntentSql =
    fence.controlIntent === "cancel"
      ? `
        AND EXISTS (
          SELECT 1
          FROM course_task_control_intents
          WHERE course_task_control_intents.task_id = course_tasks.id
            AND course_task_control_intents.action = 'cancel'
            AND course_task_control_intents.trace_id =
              json_extract(course_tasks.payload, '$.traceId')
        )`
      : `
        AND NOT EXISTS (
          SELECT 1
          FROM course_task_control_intents
          WHERE course_task_control_intents.task_id = course_tasks.id
            AND course_task_control_intents.action = 'cancel'
        )`;
  return `
    AND EXISTS (
      SELECT 1
      FROM course_tasks
      WHERE course_tasks.id = ?
        AND course_tasks.course_id = ?
        AND json_extract(course_tasks.payload, '$.traceId') = ?
        AND json_extract(course_tasks.payload, '$.status')
          IN (${fence.statuses.map(() => "?").join(", ")})
        ${controlIntentSql}
    )
  `;
}
