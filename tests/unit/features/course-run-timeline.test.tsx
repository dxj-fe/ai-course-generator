import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  CourseRunTimeline,
  getCourseFailurePresentation,
} from "../../../src/features/keya/course-run-timeline";
import type { KeyaCourseRun } from "../../../src/types/keya";
import {
  courseDesignIntent,
  courseDesignOutline,
} from "../../fixtures/course-design";

function createRun(): KeyaCourseRun {
  return {
    id: "run-course",
    source: "langgraph",
    prompt: "为初学者生成 3 节太阳系互动课程",
    traceId: "trace-must-not-render",
    startedAt: 0,
    planner: {
      status: "completed",
      events: [],
      data: {
        traceId: "trace-must-not-render",
        intent: courseDesignIntent,
        state: {
          status: "completed",
          events: [],
          outline: courseDesignOutline,
        },
      },
    },
    design: { status: "completed", events: [] },
    pageWrites: {},
    pageAssets: {},
    pageHtml: {},
    pageQa: {},
  };
}

function markPageReady(run: KeyaCourseRun, pageId: string) {
  run.pageHtml[pageId] = {
    status: "completed",
    events: [],
    data: {
      traceId: "trace-ready",
      state: {
        status: "completed",
        events: [],
        htmlOutput: {
          html: `<main>${pageId}</main>`,
          generatedAt: "2026-07-24T08:00:00.000Z",
          version: 1,
        },
      },
    },
  };
}

function attachParallelGeneration(
  run: KeyaCourseRun,
  statuses: Array<"completed" | "pending" | "running">,
  currentPageId: string,
) {
  const timestamp = "2026-07-24T08:00:00.000Z";
  run.generation = {
    version: 1,
    courseId: "course-parallel-progress",
    traceId: "trace-parallel-progress",
    userPrompt: run.prompt,
    status: "running",
    currentStage: "html",
    currentPageId,
    intent: courseDesignIntent,
    outline: courseDesignOutline,
    workerConfig: { mode: "parallel", concurrency: 2 },
    pages: courseDesignOutline.pages.map((page, index) => {
      const status = statuses[index] ?? "pending";
      return {
        pageId: page.id,
        order: page.order,
        status,
        currentStage:
          status === "completed"
            ? ("complete" as const)
            : status === "running"
              ? ("html" as const)
              : ("page_writer" as const),
        assets: [],
        ...(status === "completed"
          ? {
              htmlOutput: {
                html: `<main>${page.title}</main>`,
                generatedAt: timestamp,
                version: 1 as const,
              },
            }
          : {}),
      };
    }),
    events: [],
    errors: [],
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

describe("CourseRunTimeline", () => {
  it("renders one product-level course status without implementation details", () => {
    const markup = renderToStaticMarkup(
      <CourseRunTimeline
        connectionStatus="reconnecting"
        run={createRun()}
        taskStatus="running"
      />,
    );

    expect(markup).toContain("课程简报");
    expect(markup).toContain("确认课程");
    expect(markup).toContain("生成内容");
    expect(markup).toContain("开始学习");
    expect(markup).toContain("正在规划课程结构");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="0"');

    for (const forbidden of [
      "LangGraph",
      "Workflow",
      "Agent",
      "Supervisor",
      "Trace",
      "trace-must-not-render",
      "Page Writer",
      "HTML Engineer",
      "QA",
      "Repair",
      "正在重连",
    ]) {
      expect(markup).not.toContain(forbidden);
    }
  });

  it("shows the real section count for a single-page micro-course", () => {
    const run = createRun();
    run.planner.data = {
      ...run.planner.data!,
      intent: { ...courseDesignIntent, courseLength: 1 },
      state: {
        ...run.planner.data!.state,
        outline: {
          ...courseDesignOutline,
          pages: [courseDesignOutline.pages[1]!],
        },
      },
    };

    const markup = renderToStaticMarkup(
      <CourseRunTimeline run={run} taskStatus="running" />,
    );

    expect(markup).toContain("1 节");
    expect(markup).not.toContain("内容由课芽自动规划");
  });

  it("explains a failed course through impact and recovery action", () => {
    const run = createRun();
    const [first, second] = courseDesignOutline.pages;
    markPageReady(run, first!.id);
    run.pageHtml[second!.id] = {
      status: "failed",
      events: [],
      error: "Schema validation failed at page-02",
    };

    const markup = renderToStaticMarkup(
      <CourseRunTimeline
        onResumeCourse={vi.fn()}
        run={run}
        taskStatus="failed"
      />,
    );

    expect(markup).toContain("课程生成失败");
    expect(markup).toContain("已完成 1 / 3 节");
    expect(markup).toContain("重新生成");
    expect(markup).not.toContain("Schema validation failed");
    expect(markup).not.toContain("page-02");
  });

  it("shows cancellation separately from failure", () => {
    const markup = renderToStaticMarkup(
      <CourseRunTimeline
        onResumeCourse={vi.fn()}
        run={createRun()}
        taskStatus="cancelled"
      />,
    );

    expect(markup).toContain("课程生成已取消");
    expect(markup).toContain("继续生成");
    expect(markup).not.toContain("课程生成失败");
  });

  it("shows a resumable paused state without an active spinner", () => {
    const run = createRun();
    const [firstPage] = courseDesignOutline.pages;
    attachParallelGeneration(
      run,
      ["completed", "running", "pending"],
      firstPage!.id,
    );

    const markup = renderToStaticMarkup(
      <CourseRunTimeline
        onResumeCourse={vi.fn()}
        run={run}
        taskStatus="paused"
      />,
    );

    expect(markup).toContain("课程生成已暂停");
    expect(markup).toContain("当前进度已保存");
    expect(markup).toContain("继续生成");
    expect(markup).not.toContain("正在生成第 2 节");
    expect(markup).not.toContain("animate-spin");
  });

  it("does not leave an initial task request failure looking active", () => {
    const run = createRun();
    run.planner.status = "failed";
    run.planner.error = "private request detail";

    const markup = renderToStaticMarkup(
      <CourseRunTimeline
        onResumeCourse={vi.fn()}
        run={run}
      />,
    );

    expect(markup).toContain("课程生成失败");
    expect(markup).not.toContain("正在规划课程结构");
    expect(markup).not.toContain("private request detail");
  });

  it("maps only stable error codes to bounded public guidance", () => {
    expect(
      getCourseFailurePresentation("failed", {
        code: "PAGE_WORKER_RETRY_EXHAUSTED",
        causeCode: "QUOTA_ERROR",
      }),
    ).toEqual({
      actionLabel: "额度恢复后继续",
      description: "请检查模型服务账户的额度或计费状态，然后继续生成。",
      title: "模型服务额度不足",
    });
    expect(
      getCourseFailurePresentation("failed", {
        code: "PAGE_WORKER_RETRY_EXHAUSTED",
        causeCode: "SCHEMA_ERROR",
      }),
    ).toEqual({
      actionLabel: "重新生成",
      description:
        "部分页面没有通过内容或互动结构校验，重新生成时会从失败页面继续修正。",
      title: "页面结构校验未通过",
    });
    expect(
      getCourseFailurePresentation("failed", {
        code: "REPAIR_EXECUTION_RETRY_EXHAUSTED",
        causeCode: "SCHEMA_ERROR",
      }),
    ).toEqual({
      actionLabel: "重新生成",
      description:
        "页面修订结果没有通过授权范围或结构校验，重新生成时会从检查点重新评估。",
      title: "页面修复未通过",
    });
    expect(
      getCourseFailurePresentation("failed", {
        code: "PRIVATE_PROVIDER_STACK",
      }),
    ).toEqual({
      actionLabel: "重新生成",
      description: "未完成的课程内容可以从已保存的位置重新生成。",
      title: "课程生成失败",
    });
  });

  it("opens the player when all course sections are ready", () => {
    const run = createRun();
    for (const page of courseDesignOutline.pages) {
      markPageReady(run, page.id);
    }

    const markup = renderToStaticMarkup(
      <CourseRunTimeline
        onOpenCoursePlayer={vi.fn()}
        run={run}
        taskStatus="completed"
      />,
    );

    expect(markup).toContain("课程已经准备好了");
    expect(markup).toContain("开始学习");
    expect(markup).toContain('aria-valuenow="3"');
  });

  it("ignores a stale completed currentPageId when one later section is running", () => {
    const run = createRun();
    const [firstPage] = courseDesignOutline.pages;
    attachParallelGeneration(
      run,
      ["completed", "running", "pending"],
      firstPage!.id,
    );

    const markup = renderToStaticMarkup(
      <CourseRunTimeline run={run} taskStatus="running" />,
    );

    expect(markup).toContain("正在生成第 2 节：恒星与行星");
    expect(markup).not.toContain("正在生成第 1 节");
  });

  it("lists every running section instead of the last completed checkpoint page", () => {
    const run = createRun();
    const [firstPage] = courseDesignOutline.pages;
    attachParallelGeneration(
      run,
      ["completed", "running", "running"],
      firstPage!.id,
    );

    const markup = renderToStaticMarkup(
      <CourseRunTimeline run={run} taskStatus="running" />,
    );

    expect(markup).toContain("正在并行生成第 2、3 节");
    expect(markup).not.toContain("正在生成第 1 节");
  });
});
