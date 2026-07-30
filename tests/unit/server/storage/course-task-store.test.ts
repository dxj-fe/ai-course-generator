import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createCourseStore } from "../../../../src/server/course/store/course";
import { createCourseTaskStore } from "../../../../src/server/course/store/task";
import type {
  CourseGenerationState,
  CourseTaskRecord,
} from "../../../../src/shared/course-schema";

const directories: string[] = [];

function taskRecord(
  overrides: Partial<LegacyCourseTaskRecord> = {},
): LegacyCourseTaskRecord {
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

type LegacyCourseTaskRecord = Extract<
  CourseTaskRecord,
  { source: "workflow" | "langgraph" }
>;

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
    await store.save(record, { expected: undefined });
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

  it("uses the exact persisted payload as CAS token for legacy field ordering", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseTaskStore({ rootDir });
    const record = taskRecord();
    const legacyPayload = JSON.stringify({
      updatedAt: record.updatedAt,
      createdAt: record.createdAt,
      status: record.status,
      source: record.source,
      pageCount: record.pageCount,
      userPrompt: record.userPrompt,
      traceId: record.traceId,
      courseId: record.courseId,
      taskId: record.taskId,
      version: record.version,
    });
    const database = new DatabaseSync(path.join(rootDir, "keya.sqlite"));
    database
      .prepare(
        `INSERT INTO course_tasks
          (id, course_id, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.taskId,
        record.courseId,
        legacyPayload,
        record.createdAt,
        record.updatedAt,
      );
    database.close();
    const loaded = await store.load(record.taskId);
    if (!loaded) throw new Error("测试任务未成功载入");
    const running = taskRecord({
      status: "running",
      updatedAt: "2026-07-15T03:00:01.000Z",
    });

    await expect(
      store.save(running, { expected: loaded }),
    ).resolves.toBe(true);
    await expect(store.load(record.taskId)).resolves.toEqual(running);
  });

  it.each([1, 20, 120])(
    "accepts the positive page count %i",
    async (pageCount) => {
      const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
      const record = taskRecord({ pageCount });

      await store.save(record, { expected: undefined });

      await expect(store.load(record.taskId)).resolves.toEqual(record);
    },
  );

  it.each([0, -1, 1.5])("rejects the invalid page count %s", async (pageCount) => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
    await expect(
      store.save(
        {
          ...taskRecord(),
          pageCount,
        } as unknown as CourseTaskRecord,
        { expected: undefined },
      ),
    ).rejects.toThrow();
    await expect(store.list()).resolves.toEqual({
      items: [],
      unavailableCount: 0,
    });
  });

  it("only lets one process update the same snapshot", async () => {
    const rootDir = await temporaryRoot();
    const firstStore = createCourseTaskStore({ rootDir });
    const secondStore = createCourseTaskStore({ rootDir });
    const original = taskRecord();
    await firstStore.save(original, { expected: undefined });
    const first = taskRecord({
      status: "running",
      updatedAt: "2026-07-15T03:00:01.000Z",
    });
    const second = taskRecord({
      status: "cancelled",
      updatedAt: "2026-07-15T03:00:02.000Z",
      completedAt: "2026-07-15T03:00:02.000Z",
    });

    const results = await Promise.all([
      firstStore.save(first, { expected: original }),
      secondStore.save(second, { expected: original }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(firstStore.load(original.taskId)).resolves.toEqual(
      results[0] ? first : second,
    );
  });

  it("只允许一个跨进程任务原子持有同一课程的活动执行权", async () => {
    const rootDir = await temporaryRoot();
    const firstStore = createCourseTaskStore({ rootDir });
    const secondStore = createCourseTaskStore({ rootDir });
    const first = taskRecord({
      taskId: "task-course-owner-a",
      source: "workflow",
    });
    const second = taskRecord({
      taskId: "task-course-owner-b",
      source: "workflow",
    });

    const results = await Promise.all([
      firstStore.save(first, { expected: undefined }),
      secondStore.save(second, { expected: undefined }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const owner = results[0] ? first : second;
    const loser = results[0] ? second : first;
    await expect(firstStore.loadCourseClaim(owner.courseId)).resolves.toBe(
      owner.taskId,
    );
    await expect(firstStore.load(loser.taskId)).resolves.toBeUndefined();
  });

  it("打开旧数据库时为已有活动任务补齐课程执行权", async () => {
    const rootDir = await temporaryRoot();
    await mkdir(rootDir, { recursive: true });
    const record = taskRecord({ status: "paused" });
    const database = new DatabaseSync(path.join(rootDir, "keya.sqlite"));
    database.exec(`
      CREATE TABLE course_tasks (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    database
      .prepare(
        `INSERT INTO course_tasks
          (id, course_id, payload, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.taskId,
        record.courseId,
        JSON.stringify(record),
        record.createdAt,
        record.updatedAt,
      );
    database.close();

    const store = createCourseTaskStore({ rootDir });

    await expect(store.loadCourseClaim(record.courseId)).resolves.toBe(
      record.taskId,
    );
  });

  it("活动任务终态化后原子释放课程执行权", async () => {
    const rootDir = await temporaryRoot();
    const firstStore = createCourseTaskStore({ rootDir });
    const secondStore = createCourseTaskStore({ rootDir });
    const running = taskRecord({
      taskId: "task-course-release-a",
      status: "running",
    });
    await firstStore.save(running, { expected: undefined });
    const terminal = taskRecord({
      taskId: running.taskId,
      status: "completed",
      updatedAt: "2026-07-15T03:00:03.000Z",
      completedAt: "2026-07-15T03:00:03.000Z",
    });

    await expect(
      firstStore.save(terminal, { expected: running }),
    ).resolves.toBe(true);
    await expect(
      firstStore.loadCourseClaim(running.courseId),
    ).resolves.toBeUndefined();

    const next = taskRecord({
      taskId: "task-course-release-b",
      createdAt: "2026-07-15T03:00:04.000Z",
      updatedAt: "2026-07-15T03:00:04.000Z",
    });
    await expect(
      secondStore.save(next, { expected: undefined }),
    ).resolves.toBe(true);
    await expect(
      secondStore.loadCourseClaim(next.courseId),
    ).resolves.toBe(next.taskId);
  });

  it("cancel intent 一旦持久化，另一进程不能把 paused 任务恢复成 queued", async () => {
    const rootDir = await temporaryRoot();
    const controlStore = createCourseTaskStore({ rootDir });
    const resumeStore = createCourseTaskStore({ rootDir });
    const paused = taskRecord({
      status: "paused",
      updatedAt: "2026-07-15T03:00:01.000Z",
    });
    await controlStore.save(paused, { expected: undefined });
    const stalePaused = await resumeStore.load(paused.taskId);
    if (!stalePaused) throw new Error("测试任务未成功载入");

    const cancellationRecord = await controlStore.requestCancel(
      paused.taskId,
      "2026-07-15T03:00:02.000Z",
    );
    if (!cancellationRecord) throw new Error("取消意图未找到任务");
    const queued = taskRecord({
      status: "queued",
      traceId: "trace-resumed-after-cancel",
      updatedAt: "2026-07-15T03:00:03.000Z",
    });

    await expect(
      resumeStore.save(queued, { expected: stalePaused }),
    ).resolves.toBe(false);
    await expect(
      resumeStore.loadControlIntent(paused.taskId),
    ).resolves.toMatchObject({
      action: "cancel",
      traceId: paused.traceId,
    });

    const cancelled = taskRecord({
      status: "cancelled",
      updatedAt: "2026-07-15T03:00:04.000Z",
      completedAt: "2026-07-15T03:00:04.000Z",
    });
    await expect(
      controlStore.save(cancelled, {
        expected: cancellationRecord,
        controlIntent: "cancel",
      }),
    ).resolves.toBe(true);
    await expect(
      resumeStore.loadControlIntent(paused.taskId),
    ).resolves.toBeUndefined();
    await expect(
      resumeStore.loadCourseClaim(paused.courseId),
    ).resolves.toBeUndefined();
  });

  it("旧 attempt 的 CourseStore 终态不会阻止新 trace 从 paused 恢复", async () => {
    const rootDir = await temporaryRoot();
    const taskStore = createCourseTaskStore({ rootDir });
    const courseStore = createCourseStore({ rootDir });
    const paused = taskRecord({
      status: "paused",
      traceId: "trace-current-attempt",
      updatedAt: "2026-07-15T03:00:01.000Z",
    });
    await courseStore.save(
      failedCourseState(paused.courseId, "trace-previous-attempt"),
      { expected: undefined },
    );
    await taskStore.save(paused, { expected: undefined });
    const queued = taskRecord({
      status: "queued",
      traceId: "trace-resumed-current-attempt",
      updatedAt: "2026-07-15T03:00:02.000Z",
    });

    await expect(
      taskStore.save(queued, { expected: paused }),
    ).resolves.toBe(true);
    await expect(taskStore.load(paused.taskId)).resolves.toMatchObject({
      status: "queued",
      traceId: queued.traceId,
    });
  });

  it("当前 trace 的 CourseStore 终态仍会阻止 paused 任务复活", async () => {
    const rootDir = await temporaryRoot();
    const taskStore = createCourseTaskStore({ rootDir });
    const courseStore = createCourseStore({ rootDir });
    const paused = taskRecord({
      status: "paused",
      traceId: "trace-current-terminal",
      updatedAt: "2026-07-15T03:00:01.000Z",
    });
    await courseStore.save(
      failedCourseState(paused.courseId, paused.traceId),
      { expected: undefined },
    );
    await taskStore.save(paused, { expected: undefined });
    const queued = taskRecord({
      status: "queued",
      traceId: "trace-should-not-resume",
      updatedAt: "2026-07-15T03:00:02.000Z",
    });

    await expect(
      taskStore.save(queued, { expected: paused }),
    ).resolves.toBe(false);
    await expect(taskStore.load(paused.taskId)).resolves.toMatchObject({
      status: "paused",
      traceId: paused.traceId,
    });
  });

  it("persists paused as a recoverable non-terminal task state", async () => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
    const paused = taskRecord({
      status: "paused",
      updatedAt: "2026-07-15T03:00:01.000Z",
    });

    await store.save(paused, { expected: undefined });

    await expect(store.load(paused.taskId)).resolves.toEqual(paused);
  });

  it("lists valid task records by update time", async () => {
    const store = createCourseTaskStore({ rootDir: await temporaryRoot() });
    await store.save(taskRecord(), { expected: undefined });
    await store.save(
      taskRecord({
        taskId: "task-day-20",
        courseId: "course-day-20",
        updatedAt: "2026-07-15T03:00:02.000Z",
      }),
      { expected: undefined },
    );

    await expect(store.list()).resolves.toMatchObject({
      items: [{ taskId: "task-day-20" }, { taskId: "task-day-19" }],
      unavailableCount: 0,
    });
  });
});

function failedCourseState(
  courseId: string,
  traceId: string,
): CourseGenerationState {
  const timestamp = "2026-07-15T03:00:00.000Z";
  return {
    version: 1,
    courseId,
    traceId,
    userPrompt: "生成三页太阳系互动课程",
    status: "failed",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [
      {
        stage: "intent",
        code: "PREVIOUS_ATTEMPT_FAILED",
        message: "上一轮任务失败。",
      },
    ],
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    durationMs: 0,
  };
}
