import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCourseTaskStore } from "../../../../src/server/storage/course-task-store";
import type { CourseTaskRecord } from "../../../../src/shared/course-schema";

const directories: string[] = [];

function taskRecord(
  overrides: Partial<CourseTaskRecord> = {},
): CourseTaskRecord {
  return {
    version: 1,
    taskId: "task-day-19",
    courseId: "course-day-19",
    traceId: "trace-day-19",
    userPrompt: "生成三页太阳系互动课程",
    pageCount: 3,
    status: "queued",
    createdAt: "2026-07-15T03:00:00.000Z",
    updatedAt: "2026-07-15T03:00:00.000Z",
    ...overrides,
  };
}

async function temporaryRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), "task-store-test-"));
  directories.push(directory);
  return path.join(directory, "tasks");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("course task store", () => {
  it("atomically saves and validates a task record", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseTaskStore({ rootDir });
    const record = taskRecord();

    await store.save(record);

    const filePath = path.join(rootDir, record.taskId, "task.json");
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(record);
    await expect(store.load(record.taskId)).resolves.toEqual(record);
    await expect(readdir(path.dirname(filePath))).resolves.toEqual([
      "task.json",
    ]);
  });

  it("returns undefined for a missing task", async () => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });

    await expect(store.load("task-missing")).resolves.toBeUndefined();
  });

  it.each(["../outside", "task/other", "/tmp/task-other", "TASK-DAY-19"])(
    "rejects unsafe task id %s before reading the filesystem",
    async (taskId) => {
      const store = createCourseTaskStore({ rootDir: await temporaryRoot() });

      await expect(store.load(taskId)).rejects.toThrow();
    },
  );

  it("rejects persisted JSON that does not match the task schema", async () => {
    const rootDir = await temporaryRoot();
    const taskDirectory = path.join(rootDir, "task-day-19");
    await mkdir(taskDirectory, { recursive: true });
    await writeFile(
      path.join(taskDirectory, "task.json"),
      JSON.stringify({ version: 1, taskId: "task-day-19" }),
      "utf8",
    );
    const store = createCourseTaskStore({ rootDir });

    await expect(store.load("task-day-19")).rejects.toThrow();
  });

  it("rejects a valid record stored under a different task id", async () => {
    const rootDir = await temporaryRoot();
    const taskDirectory = path.join(rootDir, "task-day-19");
    await mkdir(taskDirectory, { recursive: true });
    await writeFile(
      path.join(taskDirectory, "task.json"),
      JSON.stringify(taskRecord({ taskId: "task-different" })),
      "utf8",
    );
    const store = createCourseTaskStore({ rootDir });

    await expect(store.load("task-day-19")).rejects.toThrow(
      "课程任务 ID 与存储目录不一致",
    );
  });

  it("rejects an invalid record before writing it", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseTaskStore({ rootDir });

    await expect(
      store.save({
        ...taskRecord(),
        pageCount: 6,
      } as unknown as CourseTaskRecord),
    ).rejects.toThrow();
    await expect(readdir(rootDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes concurrent records in invocation order", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseTaskStore({ rootDir });
    const first = taskRecord();
    const second = taskRecord({
      status: "running",
      updatedAt: "2026-07-15T03:00:01.000Z",
    });

    await Promise.all([store.save(first), store.save(second)]);

    await expect(store.load(second.taskId)).resolves.toEqual(second);
  });
});
