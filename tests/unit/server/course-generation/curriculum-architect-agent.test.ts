import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { asSchema } from "ai";

import {
  runCurriculumArchitectAgent,
  type CurriculumArchitectTools,
} from "../../../../src/server/agent/plugins/agents/course/architect-handler";
import {
  createCourseRunRepository,
  type CourseRunRepository,
} from "../../../../src/server/course/store/repository";
import {
  AgentTerminalNotCommittedError,
  AgentToolAuthorizationError,
  type RuntimeAgentFactory,
} from "../../../../src/server/agent/runtime";
import {
  createArchitecture,
  createBrief,
  createReferencePack,
  COURSE_ID,
} from "../../../fixtures/course-architecture";
import { seedRunningCourseTask } from "../../../fixtures/running-course-task";

const directories: string[] = [];
const RUN_OWNER = "engine-architect-test";
const WORKER_OWNER = "architect-worker-test";
const TRACE_ID = "trace-architect-test";
const TASK_ID = "task-architect-test";
const NOW = "2026-07-29T09:00:01.000Z";

function createReferenceInvalidArchitecture() {
  const architecture = structuredClone(createArchitecture());
  architecture.coursePack.facts[0]!.sourceUsages = [
    {
      referencePackId: "ref-000000000000000000000000",
      chunkIds: ["chunk-99"],
    },
  ];
  return architecture;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Curriculum Architect Agent", () => {
  it("不检索模板，并把开放式课程规划交给 Agent 自主完成", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const architecture = createArchitecture();
    const createAgent = createFakeFactory(async (settings) => {
      await expect(
        settings.prepareStep({ messages: [], stepNumber: 0, steps: [] }),
      ).resolves.toMatchObject({
        activeTools: ["submit_course_architecture"],
        toolChoice: "required",
      });

      const submitStep = await settings.prepareStep({
        messages: [],
        stepNumber: 1,
        steps: [],
      });
      expect(submitStep).toMatchObject({
        toolChoice: "required",
      });
      expect(submitStep.activeTools).not.toContain("search_templates");
      expect(submitStep.activeTools).not.toContain("search_references");
      expect(submitStep.activeTools).not.toContain("read_local_resource");
      expect(submitStep.instructions).toContain("# 提交前校准");
      expect(submitStep.instructions).toContain(
        "不是模板选择器",
      );
      expect(submitStep.instructions).toContain(
        "不要预先规定页面布局、组件树或图片槽位",
      );
      expect(submitStep.instructions).toContain(
        "Harness 为旧投影补兼容默认值",
      );
      expect(submitStep.instructions).toContain(
        "Page Creator 会在制作页面时自行决定表现方式、互动和是否调用生图工具",
      );
      const submitTool = settings.tools[
        "submit_course_architecture"
      ] as unknown as { description?: string };
      expect(submitTool.description).toContain(
        "Harness 自动补稳定 ID",
      );
      await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture },
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).resolves.toMatchObject({ status: "submitted" });
  });

  it("统一 Harness 加载 Skill 核心说明，资料工具不占用 Provider 的规划回合", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const architecture = createArchitecture();
    const createAgent = createFakeFactory(async (settings) => {
      expect(settings.activeTools).toEqual(["submit_course_architecture"]);
      expect(settings.instructions).toContain("<available_skills>");
      expect(settings.instructions).toContain(
        "agent/skills/course-design/SKILL.md",
      );
      expect(settings.instructions).toContain("先把方向设计正确");

      const reference = await executeTool(
        settings.tools,
        "read_local_resource",
        {
          path: "agent/skills/course-design/references/objective-evidence.md",
        },
      );
      expect(readToolContent(reference)).toContain(
        "目标—页面—证据矩阵",
      );

      await executeTool(
        settings.tools,
        "validate_course_architecture",
        { architecture },
      );
      await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture },
      );
      return {};
    });

    const result = await runPreparedAgent(prepared, createAgent);

    expect(result.status).toBe("submitted");
  });

  it("把有界资料事实与原文摘录预加载进首轮 Prompt", async () => {
    const prepared = await prepareArchitectWorkOrder();
    let inspectedPrompt = "";
    const createAgent = createFakeFactory(
      async (settings) => {
        await executeTool(
          settings.tools,
          "submit_course_architecture",
          { architecture: createArchitecture() },
        );
        return {};
      },
      (prompt) => {
        inspectedPrompt = prompt;
      },
    );

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).resolves.toMatchObject({ status: "submitted" });
    expect(inspectedPrompt).toContain("Harness 预加载的资料证据");
    expect(inspectedPrompt).toContain("太阳系入门资料.md");
    expect(inspectedPrompt).toContain("太阳是太阳系的恒星");
    expect(inspectedPrompt).toContain("chunk-01");
    expect(inspectedPrompt).not.toContain("可检索资料索引");
  });

  it("即使模型直接点名隐藏工具，execute 仍按 WorkOrder 权限拒绝", async () => {
    const prepared = await prepareArchitectWorkOrder([
      "validate_course_architecture",
      "submit_course_architecture",
    ]);
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(settings.tools, "search_references", {
        query: "太阳 恒星",
        limit: 2,
      });
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentToolAuthorizationError);
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)?.status,
    ).toBe("running");
    expect(
      prepared.repository.artifacts.listByTask(TASK_ID),
    ).toEqual([]);
  });

  it("submit 的确定性 Gate 失败时不写终态架构，只保存可恢复候选", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const invalid = createReferenceInvalidArchitecture();
    let toolOutput: unknown;
    const createAgent = createFakeFactory(async (settings) => {
      toolOutput = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: invalid },
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentTerminalNotCommittedError);
    expect(toolOutput).toMatchObject({
      ok: false,
      code: "ARCHITECTURE_GATE_FAILED",
      committed: false,
      terminal: false,
      retryable: true,
    });
    expect(readFeedback(toolOutput).join(" ")).toContain(
      "REFERENCE_USAGE_INVALID",
    );
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture",
      ),
    ).toEqual([]);
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture_candidate",
      ),
    ).toHaveLength(1);
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)?.status,
    ).toBe("running");
  });

  it("首次完整提交会忽略模型附带的空 patches 占位", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const createAgent = createFakeFactory(async (settings) => {
      const submitted = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: createArchitecture(), patches: [] },
      );
      expect(submitted).toMatchObject({ ok: true, committed: true });
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).resolves.toMatchObject({ status: "submitted" });
  });

  it("恢复候选若已通过当前 Gate，会在 patches 提交入口直接落终态", async () => {
    const prepared = await prepareArchitectWorkOrder();
    prepared.repository.checkpointArchitectureCandidate({
      workOrderId: prepared.workOrder.id,
      expectedWorkOrderLockVersion: prepared.workOrder.lockVersion,
      workOrderLeaseOwner: WORKER_OWNER,
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
      architecture: createArchitecture(),
      now: NOW,
    });

    const createAgent = createFakeFactory(async (settings) => {
      const submitted = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { patches: [] },
      );
      expect(submitted).toMatchObject({ ok: true, committed: true });
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).resolves.toMatchObject({ status: "submitted" });
  });

  it("跨模型 tier 重启时只采纳完整重投中命中门禁路径的修复", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const rejected = createReferenceInvalidArchitecture();
    let scopedRepair: unknown;

    await expect(
      runPreparedAgent(
        prepared,
        createFakeFactory(async (settings) => {
          await executeTool(
            settings.tools,
            "submit_course_architecture",
            { architecture: rejected },
          );
          return {};
        }),
      ),
    ).rejects.toBeInstanceOf(AgentTerminalNotCommittedError);

    const resumed = await runPreparedAgent(
      prepared,
      createFakeFactory(async (settings) => {
        await expect(
          settings.prepareStep({ messages: [], stepNumber: 0, steps: [] }),
        ).resolves.toMatchObject({
          activeTools: expect.arrayContaining(["submit_course_architecture"]),
          toolChoice: "required",
        });
        const proposed = createArchitecture();
        proposed.blueprint.title = "不应被完整重投顺带覆盖的标题";
        proposed.pageTasks[0]!.title = "不应被完整重投顺带覆盖的页面标题";
        scopedRepair = await executeTool(
          settings.tools,
          "submit_course_architecture",
          {
            architecture: proposed,
            patches: [],
          },
        );
        return {};
      }),
    );

    expect(resumed.status).toBe("submitted");
    expect(scopedRepair).toMatchObject({
      ok: true,
      committed: true,
      terminal: true,
    });
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture_candidate",
      ),
    ).toHaveLength(1);
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture",
      ),
    ).toHaveLength(1);
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture",
      )[0]?.payload,
    ).toEqual(createArchitecture());
  });

  it("完整重投只有未报错字段变化时不会覆盖或晋升候选", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const rejected = createReferenceInvalidArchitecture();
    let unchangedGate: unknown;

    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: rejected },
      );
      const unrelatedProposal = structuredClone(rejected);
      unrelatedProposal.blueprint.title = "无关的新标题";
      unchangedGate = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: unrelatedProposal, patches: [] },
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentTerminalNotCommittedError);
    expect(unchangedGate).toMatchObject({
      ok: false,
      code: "ARCHITECTURE_GATE_FAILED",
    });
    expect(readFeedback(unchangedGate).join(" ")).toContain(
      "REFERENCE_USAGE_INVALID",
    );
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture_candidate",
      ),
    ).toHaveLength(1);
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture",
      ),
    ).toHaveLength(0);
  });

  it("patches 只能修改当前门禁反馈范围内的安全路径", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const rejected = createReferenceInvalidArchitecture();
    const outputs: unknown[] = [];
    const createAgent = createFakeFactory(async (settings) => {
      outputs.push(
        await executeTool(
          settings.tools,
          "submit_course_architecture",
          { architecture: rejected },
        ),
      );
      outputs.push(
        await executeTool(
          settings.tools,
          "submit_course_architecture",
          {
            patches: [
              { path: "pageTasks.0.revision", value: 2 },
            ],
          },
        ),
      );
      outputs.push(
        await executeTool(
          settings.tools,
          "submit_course_architecture",
          { patches: [{ path: "pageTasks", value: [] }] },
        ),
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentTerminalNotCommittedError);
    expect(outputs[0]).toMatchObject({
      code: "ARCHITECTURE_GATE_FAILED",
    });
    expect(outputs[1]).toMatchObject({
      ok: false,
      code: "ARCHITECTURE_PATCH_INVALID",
      retryable: true,
    });
    expect(readFeedback(outputs[1]).join(" ")).toContain(
      "不在当前门禁反馈范围内",
    );
    expect(outputs[2]).toMatchObject({
      ok: false,
      code: "ARCHITECTURE_PATCH_INVALID",
    });
    expect(readFeedback(outputs[2]).join(" ")).toContain(
      "不在当前门禁反馈范围内",
    );
  });

  it("宽松工具外壳让 malformed patch 进入 execute 并返回可重试反馈", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const rejected = createReferenceInvalidArchitecture();
    let malformedOutput: unknown;
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: rejected },
      );
      const submitTool = settings.tools[
        "submit_course_architecture"
      ] as unknown as {
        inputSchema: { safeParse: (value: unknown) => { success: boolean } };
      };
      expect(
        submitTool.inputSchema.safeParse({
          draft: null,
          architecture: null,
          patches: [{ path: "courseId" }],
        }).success,
      ).toBe(true);
      expect(submitTool.inputSchema.safeParse({}).success).toBe(false);
      const jsonSchema = asSchema(
        submitTool.inputSchema as Parameters<typeof asSchema>[0],
      ).jsonSchema as {
        properties?: {
          draft?: unknown;
          architecture?: unknown;
          patches?: unknown;
        };
      };
      expect(JSON.stringify(jsonSchema.properties?.draft)).toContain(
        '"pages"',
      );
      expect(JSON.stringify(jsonSchema.properties?.architecture)).not.toContain(
        '"courseId"',
      );
      const serializedPatchSchema = JSON.stringify(
        jsonSchema.properties?.patches,
      );
      expect(serializedPatchSchema).toContain('"op"');
      expect(serializedPatchSchema).toContain('"path"');
      expect(serializedPatchSchema).toContain('"value"');
      malformedOutput = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { patches: [{ path: "courseId" }] },
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).rejects.toBeInstanceOf(AgentTerminalNotCommittedError);
    expect(malformedOutput).toMatchObject({
      ok: false,
      code: "ARCHITECTURE_PATCH_INVALID",
      retryable: true,
    });
    expect(readFeedback(malformedOutput).join(" ")).toContain("必须包含 value");
  });

  it("页数门禁候选允许用 JSON Patch 补回缺失页面", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const rejected = structuredClone(createArchitecture());
    const missingPage = rejected.pageTasks.pop();
    expect(missingPage).toBeDefined();
    let broadReplacement: unknown;

    const createAgent = createFakeFactory(async (settings) => {
      const first = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: rejected },
      );
      expect(first).toMatchObject({
        ok: false,
        code: "ARCHITECTURE_GATE_FAILED",
      });
      expect(readFeedback(first).join(" ")).toContain(
        "ARCHITECTURE_PAGE_COUNT_MISMATCH",
      );

      broadReplacement = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { patches: [{ path: "pageTasks", value: [] }] },
      );

      await executeTool(
        settings.tools,
        "submit_course_architecture",
        {
          patches: [
            {
              op: "add",
              path: "/pageTasks/-",
              value: missingPage,
            },
          ],
        },
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).resolves.toMatchObject({ status: "submitted" });
    expect(broadReplacement).toMatchObject({
      ok: false,
      code: "ARCHITECTURE_PATCH_INVALID",
    });
    expect(readFeedback(broadReplacement).join(" ")).toContain(
      "只允许用 add/remove",
    );
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture",
      )[0]?.payload,
    ).toEqual(createArchitecture());
  });

  it("页数门禁候选允许用 JSON Patch 删除多余页面", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const rejected = structuredClone(createArchitecture());
    rejected.pageTasks.push({
      ...structuredClone(rejected.pageTasks[3]!),
      pageId: "page-extra",
      order: 5,
      buildDependsOnPageIds: [],
    });

    const createAgent = createFakeFactory(async (settings) => {
      const first = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: rejected },
      );
      expect(readFeedback(first).join(" ")).toContain(
        "ARCHITECTURE_PAGE_COUNT_MISMATCH",
      );
      await executeTool(
        settings.tools,
        "submit_course_architecture",
        {
          patches: [{ op: "remove", path: "/pageTasks/4" }],
        },
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).resolves.toMatchObject({ status: "submitted" });
  });

  it("页数门禁候选删除中间页时允许同步恢复 order", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const rejected = structuredClone(createArchitecture());
    rejected.pageTasks.slice(1).forEach((page) => {
      page.order += 1;
    });
    rejected.pageTasks.splice(1, 0, {
      ...structuredClone(rejected.pageTasks[1]!),
      pageId: "page-extra",
      order: 2,
      buildDependsOnPageIds: [],
    });

    const createAgent = createFakeFactory(async (settings) => {
      const first = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: rejected },
      );
      expect(readFeedback(first).join(" ")).toContain(
        "ARCHITECTURE_PAGE_COUNT_MISMATCH",
      );
      await executeTool(
        settings.tools,
        "submit_course_architecture",
        {
          patches: [
            { op: "remove", path: "/pageTasks/1" },
            { op: "replace", path: "/pageTasks/1/order", value: 2 },
            { op: "replace", path: "/pageTasks/2/order", value: 3 },
            { op: "replace", path: "/pageTasks/3/order", value: 4 },
          ],
        },
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).resolves.toMatchObject({ status: "submitted" });
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture",
      )[0]?.payload,
    ).toEqual(createArchitecture());
  });

  it("拒绝在修复问题时顺带修改未报错字段", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const expected = createArchitecture();
    const rejected = createReferenceInvalidArchitecture();
    let lateralFeedback: unknown;
    const createAgent = createFakeFactory(async (settings) => {
      await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture: rejected },
      );
      lateralFeedback = await executeTool(
        settings.tools,
        "submit_course_architecture",
        {
          patches: [
            {
              path: "coursePack.facts.0.sourceUsages",
              value: expected.coursePack.facts[0]!.sourceUsages,
            },
            {
              path: "pageTasks.0.title",
              value: "不应顺带改写的标题",
            },
          ],
        },
      );
      await executeTool(
        settings.tools,
        "submit_course_architecture",
        {
          patches: [
            {
              path: "coursePack.facts.0.sourceUsages",
              value: expected.coursePack.facts[0]!.sourceUsages,
            },
          ],
        },
      );
      return {};
    });

    await expect(
      runPreparedAgent(prepared, createAgent),
    ).resolves.toMatchObject({ status: "submitted" });
    expect(lateralFeedback).toMatchObject({
      ok: false,
      code: "ARCHITECTURE_PATCH_INVALID",
    });
    expect(readFeedback(lateralFeedback).join(" ")).toContain(
      "不在当前门禁反馈范围内",
    );
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture_candidate",
      ),
    ).toHaveLength(1);
  });

  it("可以不检索资料，在同一 ToolLoop 中按 Gate 反馈修正并从 Repository 重读终态", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const architecture = createArchitecture();
    const calls: string[] = [];
    const createAgent = createFakeFactory(async (settings) => {
      calls.push("validate_course_architecture");
      const rejected = await executeTool(
        settings.tools,
        "validate_course_architecture",
        { architecture: {} },
      );
      expect(rejected).toMatchObject({
        ok: false,
        code: "ARCHITECTURE_GATE_FAILED",
        committed: false,
        terminal: false,
      });

      calls.push("validate_course_architecture");
      const validated = await executeTool(
        settings.tools,
        "validate_course_architecture",
        { architecture },
      );
      expect(validated).toMatchObject({
        ok: true,
        committed: false,
        terminal: false,
      });

      calls.push("submit_course_architecture");
      const submitted = await executeTool(
        settings.tools,
        "submit_course_architecture",
        { architecture },
      );
      expect(submitted).toMatchObject({
        ok: true,
        committed: true,
        terminal: true,
      });
      return {};
    });

    const result = await runPreparedAgent(prepared, createAgent);

    expect(calls).toEqual([
      "validate_course_architecture",
      "validate_course_architecture",
      "submit_course_architecture",
    ]);
    expect(result.status).toBe("submitted");
    expect(result.submission).toMatchObject({
      workOrderId: prepared.workOrder.id,
      status: "done",
    });
    const stored = prepared.repository.workOrders.load(
      prepared.workOrder.id,
    );
    expect(stored?.status).toBe("submitted");
    expect(stored?.leaseOwner).toBeUndefined();
    const artifacts = prepared.repository.artifacts.listByTask(
      TASK_ID,
      "course_architecture",
    );
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.payload).toEqual(architecture);
  });
});

async function prepareArchitectWorkOrder(
  allowedTools?: string[],
) {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "curriculum-architect-agent-test-"),
  );
  directories.push(rootDir);
  const repository = createCourseRunRepository({ rootDir });
  seedRunningCourseTask(repository.runs.database, {
    taskId: TASK_ID,
    courseId: COURSE_ID,
    traceId: TRACE_ID,
    now: "2026-07-29T09:00:00.000Z",
  });
  const bootstrapped = repository.bootstrapCourseRun({
    taskId: TASK_ID,
    courseId: COURSE_ID,
    traceId: TRACE_ID,
    now: "2026-07-29T09:00:00.000Z",
    architectAllowedTools: allowedTools,
  });
  const run = repository.runs.claimLease({
    runId: bootstrapped.run.id,
    owner: RUN_OWNER,
    now: "2026-07-29T09:00:00.100Z",
    durationMs: 60_000,
  });
  const workOrder = repository.workOrders.claim(
    bootstrapped.architectWorkOrder.id,
    {
      owner: WORKER_OWNER,
      now: "2026-07-29T09:00:00.200Z",
      durationMs: 60_000,
    },
  );
  if (!run || !workOrder) {
    throw new Error("测试无法 claim CourseRun 或 Architect WorkOrder");
  }

  return { repository, run, workOrder };
}

function runPreparedAgent(
  prepared: {
    repository: CourseRunRepository;
    workOrder: NonNullable<
      ReturnType<CourseRunRepository["workOrders"]["load"]>
    >;
  },
  createAgent: RuntimeAgentFactory<CurriculumArchitectTools>,
) {
  return runCurriculumArchitectAgent(
    {
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      repository: prepared.repository,
      runLeaseOwner: RUN_OWNER,
      traceId: TRACE_ID,
      workOrder: prepared.workOrder,
      workOrderLeaseOwner: WORKER_OWNER,
    },
    {
      createAgent,
      model: {},
      now: () => NOW,
    },
  );
}

function createFakeFactory(
  generate: (
    settings: Parameters<
      RuntimeAgentFactory<CurriculumArchitectTools>
    >[0],
  ) => PromiseLike<unknown>,
  inspectPrompt?: (prompt: string) => void,
): RuntimeAgentFactory<CurriculumArchitectTools> {
  return (settings) => ({
    generate: ({ prompt }) => {
      inspectPrompt?.(prompt);
      return generate(settings);
    },
  });
}

async function executeTool(
  tools: CurriculumArchitectTools,
  toolName: keyof CurriculumArchitectTools,
  input: unknown,
) {
  const executable = tools[toolName] as unknown as {
    execute?: (
      input: unknown,
      options: { abortSignal?: AbortSignal },
    ) => unknown;
  };
  if (!executable.execute) {
    throw new Error(`测试工具 ${toolName} 缺少 execute`);
  }

  const output = executable.execute(input, {});
  if (isAsyncIterable(output)) {
    let latest: unknown;
    for await (const item of output) latest = item;
    return latest;
  }
  return await output;
}

function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
}

function readFeedback(value: unknown) {
  if (!value || typeof value !== "object") return [];
  const feedback = (value as { feedback?: unknown }).feedback;
  return Array.isArray(feedback)
    ? feedback.filter((item): item is string => typeof item === "string")
    : [];
}

function readToolContent(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const content = (data as { content?: unknown }).content;
  return typeof content === "string" ? content : undefined;
}
