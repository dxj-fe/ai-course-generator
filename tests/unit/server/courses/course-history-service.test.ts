import { describe, expect, it } from "vitest";

import { createCourseHistoryService } from "../../../../src/server/courses/course-history-service";
import type {
  CourseGenerationState,
  CourseTaskRecord,
} from "../../../../src/shared/course-schema";

const firstCourse = runningCourse({
  courseId: "course-history-one",
  userPrompt: "生成太阳系互动课程",
  updatedAt: "2026-07-22T04:00:00.000Z",
});
const secondCourse = runningCourse({
  courseId: "course-history-two",
  userPrompt: "生成高一数学课程",
  status: "failed",
  updatedAt: "2026-07-22T05:00:00.000Z",
});
const tasks: CourseTaskRecord[] = [
  taskRecord({
    taskId: "task-history-one",
    courseId: firstCourse.courseId,
    source: "workflow",
    createdAt: "2026-07-22T04:00:00.000Z",
    updatedAt: "2026-07-22T04:00:00.000Z",
  }),
  taskRecord({
    taskId: "task-history-two",
    courseId: secondCourse.courseId,
    source: "langgraph",
    status: "failed",
    createdAt: "2026-07-22T05:00:00.000Z",
    updatedAt: "2026-07-22T05:00:00.000Z",
    error: { code: "PAGE_FAILED", message: "页面生成失败。" },
  }),
];

const service = createCourseHistoryService({
  courseStore: {
    load: async (courseId) =>
      [firstCourse, secondCourse].find((course) => course.courseId === courseId),
    list: async () => ({
      items: [firstCourse, secondCourse],
      unavailableCount: 1,
    }),
    save: async () => undefined,
  },
  taskStore: {
    load: async (taskId) => tasks.find((task) => task.taskId === taskId),
    list: async () => ({ items: tasks, unavailableCount: 2 }),
    save: async () => undefined,
  },
});

describe("course history service", () => {
  it("returns compact newest-first items and reports isolated bad records", async () => {
    const result = await service.list();

    expect(result.items.map(({ courseId }) => courseId)).toEqual([
      "course-history-two",
      "course-history-one",
    ]);
    expect(result.items[0]).toMatchObject({
      title: "生成高一数学课程",
      status: "failed",
      latestRun: { source: "langgraph", status: "failed" },
      runCount: 1,
    });
    expect(result.unavailableCount).toBe(3);
  });

  it("filters by search, course status, and latest runtime source", async () => {
    await expect(
      service.list({ query: "数学", status: "failed", source: "langgraph" }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ courseId: "course-history-two" }],
    });
    await expect(service.list({ query: "不存在" })).resolves.toMatchObject({
      total: 0,
      items: [],
    });
  });

  it("loads a course with its run records and returns undefined when missing", async () => {
    await expect(service.load(firstCourse.courseId)).resolves.toMatchObject({
      course: { courseId: firstCourse.courseId },
      runs: [{ taskId: "task-history-one" }],
    });
    await expect(service.load("course-history-missing")).resolves.toBeUndefined();
  });
});

function runningCourse(
  overrides: Partial<CourseGenerationState>,
): CourseGenerationState {
  return {
    version: 1,
    courseId: "course-history-default",
    traceId: "trace-history",
    userPrompt: "生成课程",
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: "2026-07-22T03:00:00.000Z",
    updatedAt: "2026-07-22T03:00:00.000Z",
    ...overrides,
  };
}

function taskRecord(overrides: Partial<CourseTaskRecord>): CourseTaskRecord {
  return {
    version: 1,
    taskId: "task-history-default",
    courseId: "course-history-default",
    traceId: "trace-history",
    userPrompt: "生成课程",
    source: "langgraph",
    status: "completed",
    createdAt: "2026-07-22T03:00:00.000Z",
    updatedAt: "2026-07-22T03:00:00.000Z",
    ...overrides,
  };
}
