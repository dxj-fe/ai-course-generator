import { describe, expect, it } from "vitest";

import { createCourseHistoryService } from "../../../../src/server/course/service/history";
import type {
  CourseGenerationState,
  CourseTaskRecord,
} from "../../../../src/shared/course-schema";
import { pageContentDsl } from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";

const firstCourse = runningCourse({
  courseId: "course-history-one",
  userPrompt: "生成太阳系互动课程",
  updatedAt: "2026-07-22T04:00:00.000Z",
});
const secondCourse = runningCourse({
  courseId: "course-history-two",
  userPrompt: "生成高一数学课程",
  status: "failed",
  pages: [
    {
      pageId: pageContentDsl.pageId,
      order: 1,
      status: "completed",
      currentStage: "complete",
      content: pageContentDsl,
      assets: [],
      htmlOutput: {
        html: buildValidGeneratedHtml(pageContentDsl),
        generatedAt: "2026-07-22T04:58:00.000Z",
        version: 2,
      },
    },
  ],
  updatedAt: "2026-07-22T05:00:00.000Z",
});
const tasks: CourseTaskRecord[] = [
  taskRecord({
    taskId: "task-history-one-langgraph",
    courseId: firstCourse.courseId,
    source: "langgraph",
    createdAt: "2026-07-22T03:50:00.000Z",
    updatedAt: "2026-07-22T03:50:00.000Z",
  }),
  taskRecord({
    taskId: "task-history-one",
    courseId: firstCourse.courseId,
    source: "workflow",
    createdAt: "2026-07-22T04:00:00.000Z",
    updatedAt: "2026-07-22T04:00:00.000Z",
  }),
  {
    ...taskRecord({
      taskId: "task-history-one-agent-v2",
      courseId: firstCourse.courseId,
      createdAt: "2026-07-22T04:10:00.000Z",
      updatedAt: "2026-07-22T04:10:00.000Z",
    }),
    source: "agent-v2",
    creationBrief: {
      originalRequest: "生成太阳系互动课程",
      topic: "太阳系",
      audience: "初学者",
      goal: "理解太阳系结构",
      sectionCount: "auto",
      learningMode: "mixed",
      language: "zh-CN",
    },
  },
  taskRecord({
    taskId: "task-history-two-workflow",
    courseId: secondCourse.courseId,
    source: "workflow",
    createdAt: "2026-07-22T04:50:00.000Z",
    updatedAt: "2026-07-22T04:50:00.000Z",
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
    save: async () => false,
  },
  taskStore: {
    load: async (taskId) => tasks.find((task) => task.taskId === taskId),
    loadCourseClaim: async () => undefined,
    loadControlIntent: async () => undefined,
    requestCancel: async () => undefined,
    list: async () => ({ items: tasks, unavailableCount: 2 }),
    save: async () => false,
  },
});

describe("course history service", () => {
  it("returns courses whose latest run uses agent-v2 or LangGraph", async () => {
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
      cover: {
        pageId: pageContentDsl.pageId,
        generatedAt: "2026-07-22T04:58:00.000Z",
        version: 2,
      },
    });
    expect(result.items[1]).toMatchObject({
      latestRun: { source: "agent-v2" },
      runCount: 2,
    });
    expect(result.unavailableCount).toBe(3);
  });

  it("filters visible course history by search and course status", async () => {
    await expect(
      service.list({ query: "数学", status: "failed" }),
    ).resolves.toMatchObject({
      total: 1,
      items: [{ courseId: "course-history-two" }],
    });
    await expect(service.list({ query: "不存在" })).resolves.toMatchObject({
      total: 0,
      items: [],
    });
  });

  it("loads agent-v2 and LangGraph runs while excluding workflow runs", async () => {
    await expect(service.load(firstCourse.courseId)).resolves.toMatchObject({
      course: { courseId: firstCourse.courseId },
      runs: [
        { taskId: "task-history-one-agent-v2", source: "agent-v2" },
        {
          taskId: "task-history-one-langgraph",
          source: "langgraph",
        },
      ],
    });
    await expect(service.load(secondCourse.courseId)).resolves.toMatchObject({
      course: { courseId: secondCourse.courseId },
      runs: [{ taskId: "task-history-two", source: "langgraph" }],
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

function taskRecord(
  overrides: Partial<LegacyCourseTaskRecord>,
): LegacyCourseTaskRecord {
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

type LegacyCourseTaskRecord = Extract<
  CourseTaskRecord,
  { source: "workflow" | "langgraph" }
>;
