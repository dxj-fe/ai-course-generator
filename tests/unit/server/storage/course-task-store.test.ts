import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
    source: "workflow",
    status: "queued",
    createdAt: "2026-07-15T03:00:00.000Z",
    updatedAt: "2026-07-15T03:00:00.000Z",
    ...overrides,
  };
}

async function temporaryRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), "task-store-test-"));
  directories.push(directory);
  return path.join(directory, "storage");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("course task store", () => {
  it("saves and validates a task record in SQLite", async () => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
    const record = taskRecord();
    await store.save(record);
    await expect(store.load(record.taskId)).resolves.toEqual(record);
  });

  it("returns undefined for a missing task", async () => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
    await expect(store.load("task-missing")).resolves.toBeUndefined();
  });

  it.each(["../outside", "task/other", "/tmp/task-other", "TASK-DAY-19"])(
    "rejects unsafe task id %s before querying",
    async (taskId) => {
      const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
      await expect(store.load(taskId)).rejects.toThrow();
    },
  );

  it("isolates an invalid database payload", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseTaskStore({ rootDir });
    const database = new DatabaseSync(path.join(rootDir, "keya.sqlite"));
    database
      .prepare(
        `INSERT INTO course_tasks
          (id, course_id, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "task-broken",
        "course-day-19",
        "{}",
        "2026-07-15T03:00:00.000Z",
        "2026-07-15T03:00:00.000Z",
      );
    database.close();

    await expect(store.load("task-broken")).rejects.toThrow();
    await expect(store.list()).resolves.toMatchObject({
      items: [],
      unavailableCount: 1,
    });
  });

  it("rejects a payload whose ID differs from its database key", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseTaskStore({ rootDir });
    const database = new DatabaseSync(path.join(rootDir, "keya.sqlite"));
    database
      .prepare(
        `INSERT INTO course_tasks
          (id, course_id, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        "task-day-19",
        "course-day-19",
        JSON.stringify(taskRecord({ taskId: "task-different" })),
        "2026-07-15T03:00:00.000Z",
        "2026-07-15T03:00:00.000Z",
      );
    database.close();

    await expect(store.load("task-day-19")).rejects.toThrow(
      "课程任务 ID 与数据库主键不一致",
    );
  });

  it("rejects an invalid record before writing it", async () => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
    await expect(
      store.save({
        ...taskRecord(),
        pageCount: 6,
      } as unknown as CourseTaskRecord),
    ).rejects.toThrow();
    await expect(store.list()).resolves.toEqual({
      items: [],
      unavailableCount: 0,
    });
  });

  it("serializes record upserts in invocation order", async () => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
    const first = taskRecord();
    const second = taskRecord({
      status: "running",
      updatedAt: "2026-07-15T03:00:01.000Z",
    });

    await Promise.all([store.save(first), store.save(second)]);
    await expect(store.load(second.taskId)).resolves.toEqual(second);
  });

  it("lists valid task records by update time", async () => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
    await store.save(taskRecord());
    await store.save(
      taskRecord({
        taskId: "task-day-20",
        updatedAt: "2026-07-15T03:00:02.000Z",
      }),
    );

    await expect(store.list()).resolves.toMatchObject({
      items: [{ taskId: "task-day-20" }, { taskId: "task-day-19" }],
      unavailableCount: 0,
    });
  });
});
