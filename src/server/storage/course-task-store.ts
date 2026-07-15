import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  CourseTaskIdSchema,
  CourseTaskRecordSchema,
  type CourseTaskRecord,
} from "@/shared/course-schema";

const DEFAULT_COURSE_TASK_ROOT = path.join(
  process.cwd(),
  ".data",
  "course-tasks",
);

/** 任务目录名只允许受控 slug，禁止绝对路径和目录穿越。 */
export const StoredCourseTaskIdSchema = CourseTaskIdSchema;

export type CourseTaskStore = {
  load(taskId: string): Promise<CourseTaskRecord | undefined>;
  save(record: CourseTaskRecord): Promise<void>;
};

type CourseTaskStoreOptions = {
  rootDir?: string;
};

/** 创建按任务隔离、可原子覆盖任务记录的 JSON 存储。 */
export function createCourseTaskStore(
  options: CourseTaskStoreOptions = {},
): CourseTaskStore {
  const rootDir = path.resolve(
    /*turbopackIgnore: true*/ options.rootDir ?? DEFAULT_COURSE_TASK_ROOT,
  );
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    async load(taskId) {
      const safeTaskId = StoredCourseTaskIdSchema.parse(taskId);
      const filePath = taskFilePath(rootDir, safeTaskId);
      let source: string;

      try {
        source = await readFile(filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw error;
      }

      const record = CourseTaskRecordSchema.parse(JSON.parse(source));
      if (record.taskId !== safeTaskId) {
        throw new Error("课程任务 ID 与存储目录不一致");
      }
      return record;
    },

    async save(record) {
      const parsed = CourseTaskRecordSchema.parse(record);
      const filePath = taskFilePath(rootDir, parsed.taskId);
      const operation = writeQueue.then(() =>
        writeTaskFileAtomically(filePath, parsed),
      );

      writeQueue = operation.catch(() => undefined);
      return operation;
    },
  };
}

function taskFilePath(rootDir: string, taskId: string) {
  const safeId = StoredCourseTaskIdSchema.parse(taskId);
  return path.join(rootDir, safeId, "task.json");
}

async function writeTaskFileAtomically(
  filePath: string,
  record: CourseTaskRecord,
) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.task.json.${process.pid}-${randomUUID()}.tmp`,
  );

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // 临时文件可能尚未创建或已完成 rename；保留原始写入错误。
    }
    throw error;
  }
}
