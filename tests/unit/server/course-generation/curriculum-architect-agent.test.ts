import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
  createAgentV2Architecture,
  createAgentV2Brief,
  createAgentV2ReferencePack,
  AGENT_V2_COURSE_ID,
} from "../../../fixtures/agent-v2-course-architecture";
import { seedRunningCourseTask } from "../../../fixtures/running-course-task";

const directories: string[] = [];
const RUN_OWNER = "engine-architect-test";
const WORKER_OWNER = "architect-worker-test";
const TRACE_ID = "trace-architect-test";
const TASK_ID = "task-architect-test";
const NOW = "2026-07-29T09:00:01.000Z";

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Curriculum Architect Agent", () => {
  it("统一 Harness 加载 Skill 核心说明，并允许渐进读取 reference 后提交架构", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const architecture = createAgentV2Architecture();
    const createAgent = createFakeFactory(async (settings) => {
      expect(settings.activeTools).toContain("read_local_resource");
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

  it("即使模型直接点名隐藏工具，execute 仍按 WorkOrder 权限拒绝", async () => {
    const prepared = await prepareArchitectWorkOrder([
      "search_templates",
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

  it("submit 的确定性 Gate 失败时只返回修正反馈，不写 Artifact", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const invalid = structuredClone(createAgentV2Architecture());
    invalid.pageTasks[0]!.functionalTemplateId = "missing-template";
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
      "FUNCTIONAL_TEMPLATE_NOT_FOUND",
    );
    expect(
      prepared.repository.artifacts.listByTask(
        TASK_ID,
        "course_architecture",
      ),
    ).toEqual([]);
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)?.status,
    ).toBe("running");
  });

  it("可以不检索资料，在同一 ToolLoop 中按 Gate 反馈修正并从 Repository 重读终态", async () => {
    const prepared = await prepareArchitectWorkOrder();
    const architecture = createAgentV2Architecture();
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
    courseId: AGENT_V2_COURSE_ID,
    traceId: TRACE_ID,
    now: "2026-07-29T09:00:00.000Z",
  });
  const bootstrapped = repository.bootstrapCourseRun({
    taskId: TASK_ID,
    courseId: AGENT_V2_COURSE_ID,
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
      creationBrief: createAgentV2Brief(),
      referencePacks: [createAgentV2ReferencePack()],
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
): RuntimeAgentFactory<CurriculumArchitectTools> {
  return (settings) => ({
    generate: () => generate(settings),
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
