import {
  CourseIdSchema,
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";
import {
  databasePathForRoot,
  getAppDatabase,
} from "@/server/storage/database";

/** 课程 ID 仍使用共享 Schema 约束，避免无效主键进入数据库。 */
export const StoredCourseIdSchema = CourseIdSchema;

export type CourseStore = {
  load(courseId: string): Promise<CourseGenerationState | undefined>;
  list(): Promise<CourseStoreListResult>;
  save(state: CourseGenerationState): Promise<void>;
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
  const saveStatement = database.prepare(`
    INSERT INTO courses (id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);

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
      return state;
    },

    async list() {
      const rows = listStatement.all() as Array<{ payload: string }>;
      const items: CourseGenerationState[] = [];
      let unavailableCount = 0;

      for (const row of rows) {
        try {
          items.push(
            CourseGenerationStateSchema.parse(JSON.parse(row.payload)),
          );
        } catch {
          unavailableCount += 1;
        }
      }

      return { items, unavailableCount };
    },

    async save(state) {
      const parsed = CourseGenerationStateSchema.parse(state);
      saveStatement.run(
        parsed.courseId,
        JSON.stringify(parsed),
        parsed.updatedAt,
      );
    },
  };
}
