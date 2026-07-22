import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  CourseIdSchema,
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";

const DEFAULT_COURSE_ROOT = path.join(process.cwd(), ".data", "courses");

/** 课程目录名只允许受控 slug，禁止绝对路径和目录穿越。 */
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
  rootDir?: string;
};

/** 创建按课程隔离、可原子覆盖检查点的 JSON 存储。 */
export function createCourseStore(
  options: CourseStoreOptions = {},
): CourseStore {
  const rootDir = path.resolve(
    /*turbopackIgnore: true*/ options.rootDir ?? DEFAULT_COURSE_ROOT,
  );
  let writeQueue: Promise<void> = Promise.resolve();

  return {
    async load(courseId) {
      const safeCourseId = StoredCourseIdSchema.parse(courseId);
      return readStoredCourse(rootDir, safeCourseId);
    },

    async list() {
      const entries = await readDirectories(rootDir);
      const items: CourseGenerationState[] = [];
      let unavailableCount = 0;

      for (const entry of entries) {
        const parsedId = StoredCourseIdSchema.safeParse(entry.name);
        if (!entry.isDirectory() || !parsedId.success) {
          unavailableCount += 1;
          continue;
        }
        try {
          const state = await readStoredCourse(rootDir, parsedId.data);
          if (state) items.push(state);
        } catch {
          unavailableCount += 1;
        }
      }

      items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return { items, unavailableCount };
    },

    async save(state) {
      const parsed = CourseGenerationStateSchema.parse(state);
      const filePath = courseFilePath(rootDir, parsed.courseId);

      const operation = writeQueue.then(() =>
        writeCourseFileAtomically(filePath, parsed),
      );
      writeQueue = operation.catch(() => undefined);
      return operation;
    },
  };
}

async function readStoredCourse(rootDir: string, courseId: string) {
  const filePath = courseFilePath(rootDir, courseId);
  let source: string;

  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const state = CourseGenerationStateSchema.parse(JSON.parse(source));
  if (state.courseId !== courseId) {
    throw new Error("课程检查点 ID 与存储目录不一致");
  }
  return state;
}

async function readDirectories(rootDir: string) {
  try {
    return await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function courseFilePath(rootDir: string, courseId: string) {
  const safeId = StoredCourseIdSchema.parse(courseId);
  return path.join(rootDir, safeId, "course.json");
}

async function writeCourseFileAtomically(
  filePath: string,
  state: CourseGenerationState,
) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.course.json.${process.pid}-${randomUUID()}.tmp`,
  );

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
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
