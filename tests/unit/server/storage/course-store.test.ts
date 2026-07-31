import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createCourseStore } from "../../../../src/server/course/store/course";
import { createCourseTaskStore } from "../../../../src/server/course/store/task";
import type { CourseGenerationState } from "../../../../src/shared/course-schema";

const directories: string[] = [];

function runningState(
  overrides: Partial<CourseGenerationState> = {},
): CourseGenerationState {
  return {
    courseId: "course-123",
    traceId: "trace-123",
    userPrompt: "生成太阳系课程",
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: "2026-07-15T01:00:00.000Z",
    updatedAt: "2026-07-15T01:00:00.000Z",
    ...overrides,
  };
}

async function temporaryRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), "course-store-test-"));
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

describe("course store", () => {
  it("saves and validates a course checkpoint in SQLite", async () => {
    const store = createCourseStore({ rootDir: await temporaryRoot() });
    const state = runningState();

    await store.save(state, { expected: undefined });

    await expect(store.load(state.courseId)).resolves.toEqual(state);
  });

  it("returns undefined for a missing course", async () => {
    const store = createCourseStore({ rootDir: await temporaryRoot() });
    await expect(store.load("course-missing")).resolves.toBeUndefined();
  });

  it.each(["../outside", "course/other", "/tmp/course-other", "COURSE-123"])(
    "rejects unsafe course id %s before querying",
    async (courseId) => {
      const store = createCourseStore({ rootDir: await temporaryRoot() });
      await expect(store.load(courseId)).rejects.toThrow();
    },
  );

  it("isolates an invalid database payload", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseStore({ rootDir });
    const database = new DatabaseSync(path.join(rootDir, "keya.sqlite"));
    database
      .prepare(
        "INSERT INTO courses (id, payload, updated_at) VALUES (?, ?, ?)",
      )
      .run("course-broken", "{}", "2026-07-15T01:00:00.000Z");
    database.close();

    await expect(store.load("course-broken")).rejects.toThrow();
    await expect(store.list()).resolves.toMatchObject({
      items: [],
      unavailableCount: 1,
    });
  });

  it("rejects a payload whose ID differs from its database key", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseStore({ rootDir });
    const database = new DatabaseSync(path.join(rootDir, "keya.sqlite"));
    database
      .prepare(
        "INSERT INTO courses (id, payload, updated_at) VALUES (?, ?, ?)",
      )
      .run(
        "course-123",
        JSON.stringify(runningState({ courseId: "course-other" })),
        "2026-07-15T01:00:00.000Z",
      );
    database.close();

    await expect(store.load("course-123")).rejects.toThrow(
      "课程检查点 ID 与数据库主键不一致",
    );
  });

  it("rejects an invalid checkpoint before writing it", async () => {
    const store = createCourseStore({ rootDir: await temporaryRoot() });
    await expect(
      store.save({
        ...runningState(),
        revision: 2,
      } as unknown as CourseGenerationState, { expected: undefined }),
    ).rejects.toThrow();
    await expect(store.list()).resolves.toEqual({
      items: [],
      unavailableCount: 0,
    });
  });

  it("rejects an update based on a stale checkpoint snapshot", async () => {
    const store = createCourseStore({ rootDir: await temporaryRoot() });
    const first = runningState();
    const second = runningState({
      userPrompt: "生成一门三页的太阳系互动课程",
      updatedAt: "2026-07-15T01:00:01.000Z",
    });
    const stale = runningState({
      currentStage: "planner",
      updatedAt: "2026-07-15T01:00:02.000Z",
    });

    expect(await store.save(first, { expected: undefined })).toBe(true);
    const loaded = await store.load(first.courseId);
    expect(await store.save(second, { expected: loaded })).toBe(true);
    expect(await store.save(stale, { expected: loaded })).toBe(false);
    await expect(store.load(second.courseId)).resolves.toEqual(second);
  });

  it("lists valid checkpoints by update time", async () => {
    const store = createCourseStore({ rootDir: await temporaryRoot() });
    await store.save(runningState(), { expected: undefined });
    await store.save(
      runningState({
        courseId: "course-456",
        updatedAt: "2026-07-15T01:00:02.000Z",
      }),
      { expected: undefined },
    );

    await expect(store.list()).resolves.toMatchObject({
      items: [{ courseId: "course-456" }, { courseId: "course-123" }],
      unavailableCount: 0,
    });
  });

  it("atomically rejects a stale runner checkpoint after TaskRecord is paused", async () => {
    const rootDir = await temporaryRoot();
    const courseStore = createCourseStore({ rootDir });
    const taskStore = createCourseTaskStore({ rootDir });
    const task = {
      taskId: "task-course-store-fence",
      courseId: "course-123",
      traceId: "trace-123",
      userPrompt: "生成太阳系课程",
      creationBrief: {
        originalRequest: "生成太阳系课程",
        topic: "太阳系",
        audience: "初学者",
        goal: "理解太阳系",
        sectionCount: 3,
        learningMode: "mixed" as const,
        language: "zh-CN" as const,
      },
      status: "running" as const,
      createdAt: "2026-07-15T01:00:00.000Z",
      updatedAt: "2026-07-15T01:00:00.000Z",
    };
    await taskStore.save(task, { expected: undefined });
    const first = runningState();
    expect(
      await courseStore.save(first, {
        expected: undefined,
        taskFence: {
          taskId: task.taskId,
          traceId: task.traceId,
          statuses: ["running"],
        },
      }),
    ).toBe(true);
    const loaded = await courseStore.load(first.courseId);
    const paused = { ...task, status: "paused" as const };
    await taskStore.save(paused, { expected: task });

    expect(
      await courseStore.save(
        runningState({
          currentStage: "planner",
          updatedAt: "2026-07-15T01:00:01.000Z",
        }),
        {
          expected: loaded,
          taskFence: {
            taskId: task.taskId,
            traceId: task.traceId,
            statuses: ["running"],
          },
        },
      ),
    ).toBe(false);
    await expect(courseStore.load(first.courseId)).resolves.toEqual(first);
  });
});
