import {
  CourseTaskIdSchema,
  CourseTaskRecordSchema,
  type CourseTaskRecord,
} from "@/shared/course-schema";
import {
  databasePathForRoot,
  getAppDatabase,
} from "@/server/storage/database";

/** 任务 ID 仍使用共享 Schema 约束，避免无效订阅键进入数据库。 */
export const StoredCourseTaskIdSchema = CourseTaskIdSchema;

export type CourseTaskStore = {
  load(taskId: string): Promise<CourseTaskRecord | undefined>;
  list(): Promise<CourseTaskStoreListResult>;
  save(record: CourseTaskRecord): Promise<void>;
};

export type CourseTaskStoreListResult = {
  items: CourseTaskRecord[];
  unavailableCount: number;
};

type CourseTaskStoreOptions = {
  databasePath?: string;
  /** 保留测试和调用方兼容性；数据会写入该目录内的 SQLite。 */
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
  const saveStatement = database.prepare(`
    INSERT INTO course_tasks (id, course_id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      course_id = excluded.course_id,
      payload = excluded.payload,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `);

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
      return record;
    },

    async list() {
      const rows = listStatement.all() as Array<{ payload: string }>;
      const items: CourseTaskRecord[] = [];
      let unavailableCount = 0;

      for (const row of rows) {
        try {
          items.push(CourseTaskRecordSchema.parse(JSON.parse(row.payload)));
        } catch {
          unavailableCount += 1;
        }
      }

      return { items, unavailableCount };
    },

    async save(record) {
      const parsed = CourseTaskRecordSchema.parse(record);
      saveStatement.run(
        parsed.taskId,
        parsed.courseId,
        JSON.stringify(parsed),
        parsed.createdAt,
        parsed.updatedAt,
      );
    },
  };
}
