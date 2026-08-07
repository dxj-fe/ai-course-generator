import { afterEach, describe, expect, it } from "vitest";

import { createCourseRunCommands } from "../../../../src/server/course/run/commands";
import {
  AgentToolAuthorizationError,
} from "../../../../src/server/agent/runtime";
import { CourseRunSchema } from "../../../../src/shared/course-schema";
import {
  createArchitecture,
} from "../../../fixtures/course-architecture";
import {
  cleanupCourseDirectorAgentTestDirectories,
  createFakeFactory,
  DIRECTOR_OWNER,
  executeTool,
  fence,
  prepareArchitectureRound,
  prepareReviewRound,
  required,
  reviseArchitectureAndPrepareNextRound,
  RUN_OWNER,
  runPreparedAgent,
  timestamp,
  TRACE_ID,
} from "./course-director-agent-test-support";

afterEach(async () => {
  await cleanupCourseDirectorAgentTestDirectories();
});

describe("Course Director Agent", () => {
  it("接受 submitted 架构后原子结束回合，并按同一架构派发全部页面", async () => {
    const prepared = await prepareArchitectureRound("accept");
    const createAgent = createFakeFactory(async (settings) => {
      const inspected = await executeTool(
        settings.tools,
        "inspect_architecture",
        {},
      );
      expect(inspected).toMatchObject({
        ok: true,
        committed: false,
        data: {
          facts: expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
              text: expect.any(String),
              sourceUsages: expect.any(Array),
            }),
          ]),
          objectives: [
            {
              id: "objective-distinguish",
              teachingPageIds: [
                "page-concept",
                "page-practice",
                "page-summary",
              ],
              assessmentPageIds: [
                "page-concept",
                "page-practice",
                "page-summary",
              ],
            },
          ],
          pages: expect.arrayContaining([
            expect.objectContaining({
              visualDesign: expect.any(Object),
              acceptance: expect.any(Object),
            }),
          ]),
        },
      });
      return executeTool(
        settings.tools,
        "accept_architecture_and_dispatch_pages",
        {},
      );
    });

    const result = await runPreparedAgent(prepared, createAgent);

    expect(result.status).toBe("accepted");
    const run = prepared.repository.runs.load(prepared.run.id)!;
    expect(run.phase).toBe("building");
    expect(run.activeArchitecture?.architectureRef.id).toBe(
      prepared.architectureRef.id,
    );
    const pageWorkOrders = prepared.repository.workOrders
      .listByTask(prepared.taskId)
      .filter(({ kind }) => kind === "build_page");
    expect(pageWorkOrders).toHaveLength(4);
    expect(
      pageWorkOrders.every(
        (workOrder) =>
          workOrder.parentWorkOrderId === prepared.director.id &&
          workOrder.inputArtifactRefs.some(
            ({ id }) => id === prepared.architectureRef.id,
          ),
      ),
    ).toBe(true);
    expect(
      prepared.repository.workOrders.load(prepared.director.id)?.status,
    ).toBe("accepted");
  });

  it("封口架构证据预加载后只用一个终态动作完成接受", async () => {
    const prepared = await prepareArchitectureRound("accept-preloaded");
    let toolOutput: unknown;
    const createAgent = createFakeFactory(async (settings) => {
      expect(settings.prompt).toContain("用户目标、学习进程、页面职责");
      expect(settings.prompt).toContain("给零基础用户做一门四页太阳系互动课");
      expect(settings.prompt).toContain("不按模板 ID、布局槽位");
      const activeTools = (
        await settings.prepareStep({
          messages: [],
          stepNumber: 0,
          steps: [],
        })
      ).activeTools;
      expect(activeTools).toContain(
        "accept_architecture_and_dispatch_pages",
      );
      expect(activeTools).not.toContain("inspect_architecture");
      toolOutput = await executeTool(
        settings.tools,
        "accept_architecture_and_dispatch_pages",
        {},
      );
      return {};
    });

    const result = await runPreparedAgent(prepared, createAgent);
    expect(result.status).toBe("accepted");
    expect(toolOutput).toMatchObject({
      ok: true,
      committed: true,
      terminal: true,
    });
    expect(
      prepared.repository.runs.load(prepared.run.id)?.phase,
    ).toBe("building");
  });

  it("封口架构证据预加载后仍不能主观终止健康课程", async () => {
    const prepared = await prepareArchitectureRound(
      "preloaded-architecture-cannot-fail",
    );
    const createAgent = createFakeFactory(async (settings) => {
      expect(
        (
          await settings.prepareStep({
            messages: [],
            stepNumber: 0,
            steps: [],
          })
        ).activeTools,
      ).not.toContain("fail_course");
      return executeTool(settings.tools, "fail_course", {
        code: "UNRECOVERABLE_INPUT",
        message: "测试终止。",
      });
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
    expect(
      prepared.repository.workOrders.load(prepared.director.id)
        ?.status,
    ).toBe("running");
  });

  it("合法架构完成 inspect 后会隐藏并拒绝 fail_course", async () => {
    const prepared = await prepareArchitectureRound(
      "healthy-architecture-cannot-fail",
    );
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(settings.tools, "inspect_architecture", {});
      expect(
        (
          await settings.prepareStep({
            messages: [],
            stepNumber: 1,
            steps: [],
          })
        ).activeTools,
      ).not.toContain("fail_course");
      return executeTool(settings.tools, "fail_course", {
        code: "UNRECOVERABLE_STATE",
        message: "模型自报不可恢复。",
      });
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
    expect(
      prepared.repository.runs.load(prepared.run.id)?.phase,
    ).toBe("planning");
  });

  it("架构语义不合格时保留上一修订，并创建携带具体问题的新 Architect WorkOrder", async () => {
    const prepared = await prepareArchitectureRound("revision");
    const issue = "练习页和总结页职责重复，需要让总结只负责迁移检查。";
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(settings.tools, "inspect_architecture", {});
      return executeTool(
        settings.tools,
        "request_architecture_revision",
        { issues: [issue] },
      );
    });

    await runPreparedAgent(prepared, createAgent);

    const oldArchitect = prepared.repository.workOrders.load(
      prepared.architect.id,
    )!;
    expect(oldArchitect.status).toBe("revision_requested");
    expect(oldArchitect.submission?.issues).toContain(issue);
    const replacement = prepared.repository.workOrders
      .listByTask(prepared.taskId)
      .find(
        (workOrder) =>
          workOrder.kind === "architect_course" &&
          workOrder.supersedesWorkOrderId === prepared.architect.id,
      );
    expect(replacement).toMatchObject({
      status: "queued",
      parentWorkOrderId: prepared.director.id,
      revision: 2,
    });
    expect(
      prepared.repository.workOrders.load(prepared.director.id)?.status,
    ).toBe("accepted");
  });

  it("架构最多退回 2 轮；达到上限后明确暴露预算并只允许受控失败", async () => {
    let prepared = await prepareArchitectureRound(
      "architecture-revision-budget",
    );
    prepared = await reviseArchitectureAndPrepareNextRound(
      prepared,
      1,
    );
    prepared = await reviseArchitectureAndPrepareNextRound(
      prepared,
      2,
    );

    let rejectedRevision: unknown;
    const createAgent = createFakeFactory(async (settings) => {
      expect(settings.prompt).toContain(
        '"architectureRevisionRounds":0',
      );
      rejectedRevision = await executeTool(
        settings.tools,
        "request_architecture_revision",
        { issues: ["第三次仍发现页面职责冲突。"] },
      );
      expect(
        (
          await settings.prepareStep({
            messages: [],
            stepNumber: 1,
            steps: [],
          })
        ).activeTools,
      ).toContain("fail_course");
      return executeTool(settings.tools, "fail_course", {
        code: "UNRECOVERABLE_STATE",
        message: "模型自报文案不会覆盖机器预算原因。",
      });
    });

    await runPreparedAgent(prepared, createAgent);

    expect(rejectedRevision).toMatchObject({
      ok: false,
      code: "ARCHITECTURE_REVISION_BUDGET_EXHAUSTED",
      committed: false,
      terminal: false,
    });
    const run = required(
      prepared.repository.runs.load(prepared.run.id),
    );
    expect(run.phase).toBe("failed");
    expect(run.error?.code).toBe(
      "ARCHITECTURE_REVISION_BUDGET_EXHAUSTED",
    );
    expect(
      prepared.repository.workOrders
        .listByTask(prepared.taskId)
        .filter(({ kind }) => kind === "architect_course"),
    ).toHaveLength(3);
  });

  it("当前 Review 为 pass 时通过 Final Gate 发布，并原子结束 Director 回合", async () => {
    const prepared = await prepareReviewRound("publish", "pass");
    const createAgent = createFakeFactory(async (settings) => {
      const review = await executeTool(
        settings.tools,
        "inspect_course_review",
        {},
      );
      expect(review).toMatchObject({
        ok: true,
        data: { decision: "pass" },
      });
      return executeTool(
        settings.tools,
        "accept_course_review_and_publish",
        {},
      );
    });

    const result = await runPreparedAgent(prepared, createAgent);

    expect(result.status).toBe("accepted");
    expect(
      prepared.repository.runs.load(prepared.run.id)?.phase,
    ).toBe("completed");
    expect(
      prepared.repository.workOrders.load(
        prepared.reviewWorkOrder!.id,
      )?.status,
    ).toBe("accepted");
    expect(
      prepared.repository.workOrders.load(prepared.director.id)?.status,
    ).toBe("accepted");
  });

  it("pass Review 完成 inspect 后会隐藏并拒绝 fail_course", async () => {
    const prepared = await prepareReviewRound(
      "pass-review-cannot-fail",
      "pass",
    );
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(settings.tools, "inspect_course_review", {});
      expect(
        (
          await settings.prepareStep({
            messages: [],
            stepNumber: 1,
            steps: [],
          })
        ).activeTools,
      ).not.toContain("fail_course");
      return executeTool(settings.tools, "fail_course", {
        code: "UNRECOVERABLE_STATE",
        message: "模型自报不可恢复。",
      });
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
    expect(
      prepared.repository.runs.load(prepared.run.id)?.phase,
    ).toBe("reviewing");
  });

  it.each([
    {
      decision: "revise_pages" as const,
      field: "courseRevisionRound" as const,
      limit: 2,
      expectedCode: "COURSE_REVISION_BUDGET_EXHAUSTED",
    },
    {
      decision: "replan" as const,
      field: "replanRound" as const,
      limit: 1,
      expectedCode: "COURSE_REPLAN_BUDGET_EXHAUSTED",
    },
  ])(
    "$decision 的受控预算耗尽后才开放 fail_course",
    async ({ decision, field, limit, expectedCode }) => {
      const prepared = await prepareReviewRound(
        `controlled-fail-${decision.replaceAll("_", "-")}`,
        decision,
      );
      const current = required(
        prepared.repository.runs.load(prepared.run.id),
      );
      const exhausted = CourseRunSchema.parse({
        ...current,
        lockVersion: current.lockVersion + 1,
        [field]: limit,
      });
      expect(
        prepared.repository.runs.compareAndSet(
          exhausted,
          {
            expectedLockVersion: current.lockVersion,
            expectedTraceId: current.traceId,
            expectedLeaseOwner: RUN_OWNER,
          },
          timestamp(45),
        ),
      ).toBe(true);

      await runPreparedAgent(
        prepared,
        createFakeFactory(async (settings) => {
          await executeTool(
            settings.tools,
            "inspect_course_review",
            {},
          );
          expect(
            (
              await settings.prepareStep({
                messages: [],
                stepNumber: 1,
                steps: [],
              })
            ).activeTools,
          ).toContain("fail_course");
          return executeTool(settings.tools, "fail_course", {
            code: "UNRECOVERABLE_STATE",
            message: "模型自报文案不会覆盖机器预算原因。",
          });
        }),
      );

      const failed = required(
        prepared.repository.runs.load(prepared.run.id),
      );
      expect(failed.phase).toBe("failed");
      expect(failed.error?.code).toBe(expectedCode);
    },
  );

  it("封口 Review 证据预加载后只用一个终态动作完成发布", async () => {
    const prepared = await prepareReviewRound(
      "publish-preloaded",
      "pass",
    );
    let toolOutput: unknown;
    const createAgent = createFakeFactory(async (settings) => {
      const activeTools = (
        await settings.prepareStep({
          messages: [],
          stepNumber: 0,
          steps: [],
        })
      ).activeTools;
      expect(activeTools).toContain(
        "accept_course_review_and_publish",
      );
      expect(activeTools).not.toContain("inspect_course_review");
      toolOutput = await executeTool(
        settings.tools,
        "accept_course_review_and_publish",
        {},
      );
      return {};
    });

    const result = await runPreparedAgent(prepared, createAgent);
    expect(result.status).toBe("accepted");
    expect(toolOutput).toMatchObject({
      ok: true,
      committed: true,
      terminal: true,
    });
    expect(
      prepared.repository.runs.load(prepared.run.id)?.phase,
    ).toBe("completed");
  });

  it("封口 Review 证据预加载后可直接返工或重规划，但不能主观终止 pass 课程", async () => {
    const cases = [
      {
        suffix: "fix-preloaded",
        decision: "revise_pages" as const,
        action: "assign_page_fixes" as const,
      },
      {
        suffix: "replan-preloaded",
        decision: "replan" as const,
        action: "request_replan" as const,
      },
      {
        suffix: "fail-with-preloaded-pass-review",
        decision: "pass" as const,
        action: "fail_course" as const,
      },
    ];

    for (const item of cases) {
      const prepared = await prepareReviewRound(
        item.suffix,
        item.decision,
      );
      let toolOutput: unknown;
      const createAgent = createFakeFactory(async (settings) => {
        if (item.action === "assign_page_fixes") {
          toolOutput = await executeTool(
            settings.tools,
            "assign_page_fixes",
            { issueIds: ["issue-page-concept"] },
          );
        } else if (item.action === "request_replan") {
          toolOutput = await executeTool(
            settings.tools,
            "request_replan",
            {},
          );
        } else {
          expect(
            (
              await settings.prepareStep({
                messages: [],
                stepNumber: 0,
                steps: [],
              })
            ).activeTools,
          ).not.toContain("fail_course");
          toolOutput = await executeTool(
            settings.tools,
            "fail_course",
            {
              code: "UNRECOVERABLE_STATE",
              message: "测试终止。",
            },
          );
        }
        return {};
      });

      if (item.action === "fail_course") {
        await expect(
          runPreparedAgent(prepared, createAgent),
        ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
        expect(
          prepared.repository.workOrders.load(prepared.director.id)
            ?.status,
        ).toBe("running");
      } else {
        const result = await runPreparedAgent(prepared, createAgent);
        expect(result.status).toBe("accepted");
        expect(toolOutput).toMatchObject({
          ok: true,
          committed: true,
          terminal: true,
        });
      }
    }
  });

  it("revise_pages 只消费选定 issue，并把命中页的传递依赖加入 Fix WorkOrder", async () => {
    const prepared = await prepareReviewRound(
      "page-fixes",
      "revise_pages",
    );
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(settings.tools, "inspect_course_review", {});
      return executeTool(settings.tools, "assign_page_fixes", {
        issueIds: ["issue-page-concept"],
      });
    });

    await runPreparedAgent(prepared, createAgent);

    const run = prepared.repository.runs.load(prepared.run.id)!;
    expect(run.phase).toBe("revising");
    expect(run.stalePageIds).toEqual([
      "page-concept",
      "page-practice",
      "page-summary",
    ]);
    const fixes = prepared.repository.workOrders
      .listByTask(prepared.taskId)
      .filter(({ kind }) => kind === "fix_page");
    expect(
      fixes.map((workOrder) =>
        workOrder.scope.type === "page"
          ? [workOrder.scope.pageId, workOrder.status]
          : [],
      ),
    ).toEqual([
      ["page-concept", "queued"],
      ["page-practice", "waiting_dependencies"],
      ["page-summary", "waiting_dependencies"],
    ]);
    expect(
      fixes.every(({ causedByReviewIssueIds }) =>
        causedByReviewIssueIds.includes("issue-page-concept"),
      ),
    ).toBe(true);
  });

  it("replan 后允许新版 Architect 重交相同内容并再次通过 Director", async () => {
    const prepared = await prepareReviewRound("replan-round", "replan");
    await runPreparedAgent(
      prepared,
      createFakeFactory(async (settings) => {
        await executeTool(settings.tools, "inspect_course_review", {});
        return executeTool(settings.tools, "request_replan", {});
      }),
    );

    const revisingRun = required(
      prepared.repository.runs.load(prepared.run.id),
    );
    expect(revisingRun.phase).toBe("revising");
    const replacement = required(
      prepared.repository.workOrders
        .listByTask(prepared.taskId)
        .find(
          (workOrder) =>
            workOrder.kind === "architect_course" &&
            workOrder.status === "queued",
        ),
    );
    const claimedArchitect = required(
      prepared.repository.workOrders.claim(replacement.id, {
        owner: "architect-replan-round",
        now: timestamp(40),
        durationMs: 60_000,
      }),
    );
    const resubmitted = prepared.repository.submitArchitecture({
      workOrderId: claimedArchitect.id,
      expectedWorkOrderLockVersion: claimedArchitect.lockVersion,
      workOrderLeaseOwner: "architect-replan-round",
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
      architecture: createArchitecture(),
      now: timestamp(41),
    });
    const revisedRef = required(
      resubmitted.workOrder.submission?.artifactRefs.find(
        ({ kind }) => kind === "course_architecture",
      ),
    );
    expect(revisedRef.id).not.toBe(prepared.architectureRef.id);
    expect(revisedRef.revision).toBeGreaterThan(
      prepared.architectureRef.revision,
    );

    const queuedDirector = createCourseRunCommands(
      prepared.repository,
    ).createDirectorRound({
      fence: fence(
        required(prepared.repository.runs.load(prepared.run.id)),
      ),
      purpose: "review_architecture",
      inputArtifactRefs: [revisedRef],
      now: timestamp(42),
    });
    const director = required(
      prepared.repository.workOrders.claim(queuedDirector.id, {
        owner: DIRECTOR_OWNER,
        now: timestamp(43),
        durationMs: 60_000,
      }),
    );
    await runPreparedAgent(
      { repository: prepared.repository, director },
      createFakeFactory(async (settings) => {
        await executeTool(settings.tools, "inspect_architecture", {});
        return executeTool(
          settings.tools,
          "accept_architecture_and_dispatch_pages",
          {},
        );
      }),
    );

    const acceptedRun = required(
      prepared.repository.runs.load(prepared.run.id),
    );
    expect(acceptedRun.phase).toBe("building");
    expect(acceptedRun.activeArchitecture?.architectureRef.id).toBe(
      revisedRef.id,
    );
  });

  it("即使模型直接点名当前状态隐藏的工具，执行层仍拒绝越权", async () => {
    const prepared = await prepareArchitectureRound("forbidden");
    const createAgent = createFakeFactory((settings) =>
      executeTool(settings.tools, "assign_page_fixes", {
        issueIds: ["made-up-issue"],
      }),
    );

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
    expect(
      prepared.repository.workOrders.load(prepared.director.id)?.status,
    ).toBe("running");
    expect(
      prepared.repository.workOrders
        .listByTask(prepared.taskId)
        .filter(({ kind }) => kind === "build_page"),
    ).toEqual([]);
  });
});
