import { getLanguageModel } from "@/server/infra/ai/model-provider";
import { serializeErrorForLog } from "@/server/infra/ai/error";
import {
  isRetryableModelError,
  resolveModelRoute,
  type ModelTier,
} from "@/server/infra/ai/model-router";
import {
  AgentTerminalNotCommittedError,
  type AgentDefinition,
  type AgentExecutor,
  type AgentId,
} from "@/server/agent";
import { classifyPublicAgentError } from "@/server/course/projection/public-error";
import type { CourseAgentExecutionRequest } from "@/server/course/run/agent-request";
import { createCourseRevisionCommands } from "@/server/course/run/revision-commands";
import { createCourseRunCommands } from "@/server/course/run/commands";
import {
  RUN_LEASE_MS,
  agentForOrder,
  isAbortError,
  normalizeConcurrency,
  stageForOrder,
  throwIfAborted,
  workOrderLeaseDuration,
} from "@/server/course/run/engine-support";
import {
  CourseRunLeaseUnavailableError,
  releaseOwnedWorkOrders,
  releaseRunLease,
  releaseRunningOrdersAfterTraceAdoption,
  releaseWorkOrder,
  renewExecutionLeases,
  renewRunLease,
} from "@/server/course/run/engine-leases";
export {
  CourseRunLeaseUnavailableError,
  isCourseRunLeaseUnavailableError,
} from "@/server/course/run/engine-leases";
import {
  createCourseRunRepository,
  type CourseRunRepository,
} from "@/server/course/store/repository";
import {
  assertCourseRunTaskExecutionActive,
  assertRunExecutionFence,
} from "@/server/course/store/repository-support";
import { projectCourseState } from "@/server/course/projection/state";
import {
  createCourseAgentExecutor,
  type CourseAgentImplementations,
} from "@/server/setup/course-agents";
import { getAgentSystem } from "@/server/setup/agent";
import { runPromisePool } from "@/server/infra/concurrency/pool";
import { runInTransaction } from "@/server/infra/database/connection";
import {
  CourseArchitectureSchema,
  WorkOrderSchema,
  type CourseCreationBrief,
  type CourseGenerationState,
  type CourseRun,
  type ReferencePack,
  type WorkOrder,
} from "@/shared/course-schema";
const MAX_ENGINE_TRANSITIONS = 1_000;
const TERMINAL_PHASES = new Set(["completed", "failed", "cancelled"]);
export type CourseRunEngineInput = {
  taskId: string;
  courseId: string;
  traceId: string;
  creationBrief: CourseCreationBrief;
  referencePacks?: ReferencePack[];
  concurrency?: number;
};

export type CourseRunEngineContext = {
  abortSignal?: AbortSignal;
  /**
   * Task Service 注入的持久化控制围栏。Engine 在 WorkOrder 边界调用，
   * AgentRunner 也会在每次工具执行前调用。
   */
  assertExecutionActive?(): void | PromiseLike<void>;
};

export type CourseRunEngineHooks = {
  checkpoint?(state: CourseGenerationState): void | PromiseLike<void>;
};

type CourseRunEngineDependencies = {
  repository: CourseRunRepository;
  now(): string;
  createWorkerId(): string;
  getModel(tier?: ModelTier): unknown;
  agentExecutor: AgentExecutor<CourseAgentExecutionRequest>;
  getAgentDefinition(agentId: AgentId): PromiseLike<AgentDefinition>;
};

type CourseRunEngineOverrides = Partial<CourseRunEngineDependencies> &
  Partial<CourseAgentImplementations>;

export type CourseRunEngine = {
  run(
    input: CourseRunEngineInput,
    context?: CourseRunEngineContext,
    hooks?: CourseRunEngineHooks,
  ): Promise<CourseGenerationState>;
};

export function createCourseRunEngine(
  overrides: CourseRunEngineOverrides = {},
): CourseRunEngine {
  const dependencies: CourseRunEngineDependencies = {
    repository: overrides.repository ?? createCourseRunRepository(),
    now: overrides.now ?? (() => new Date().toISOString()),
    createWorkerId:
      overrides.createWorkerId ??
      (() => `course-worker-${crypto.randomUUID()}`),
    getModel: overrides.getModel ?? getLanguageModel,
    agentExecutor:
      overrides.agentExecutor ??
      createCourseAgentExecutor({
        runArchitect: overrides.runArchitect,
        runDirector: overrides.runDirector,
        runPageBuilder: overrides.runPageBuilder,
        runReviewer: overrides.runReviewer,
      }),
    getAgentDefinition:
      overrides.getAgentDefinition ??
      (async (agentId) =>
        (await getAgentSystem()).agents.get(agentId)),
  };

  return {
    run: (input, context = {}, hooks = {}) =>
      runCourseToTerminal(input, context, hooks, dependencies),
  };
}

/** Task Service 的默认课程生成入口。 */
export async function runCourseGeneration(
  input: CourseRunEngineInput,
  context: CourseRunEngineContext = {},
  hooks: CourseRunEngineHooks = {},
) {
  return createCourseRunEngine().run(input, context, hooks);
}

/** 任务控制面用它先切断数据库执行权，再终态化旧 UI checkpoint。 */
export function cancelCourseGenerationRun(input: {
  taskId: string;
  courseId: string;
  traceId: string;
  creationBrief: CourseCreationBrief;
  referencePacks?: ReferencePack[];
  concurrency?: number;
  now?: string;
}) {
  const repository = createCourseRunRepository();
  const result = repository.cancelCourseRun(input);
  if (!result) return undefined;
  return projectCurrentState(
    input,
    normalizeConcurrency(input.concurrency),
    repository,
  );
}

async function runCourseToTerminal(
  input: CourseRunEngineInput,
  context: CourseRunEngineContext,
  hooks: CourseRunEngineHooks,
  dependencies: CourseRunEngineDependencies,
) {
  const concurrency = normalizeConcurrency(input.concurrency);
  const workerId = dependencies.createWorkerId();
  const repository = dependencies.repository;
  await assertEngineExecutionActive(context);
  let run = prepareAndClaimRun(input, workerId, dependencies);

  const checkpoint = async () => {
    await assertEngineExecutionActive(context);
    const state = projectCurrentState(
      input,
      concurrency,
      repository,
    );
    await hooks.checkpoint?.(state);
    return state;
  };

  try {
    await checkpoint();
    for (
      let transition = 0;
      transition < MAX_ENGINE_TRANSITIONS;
      transition += 1
    ) {
      await assertEngineExecutionActive(context);
      run = requiredRun(
        repository.runs.load(run.id),
        run.id,
      );
      if (TERMINAL_PHASES.has(run.phase)) {
        return checkpoint();
      }

      run = renewRunLease(run, workerId, dependencies);
      const orders = repository.workOrders.listByTask(run.taskId);
      const blocking = findBlockingCurrentOrder(run, orders);
      if (blocking) {
        failRunForWorkOrder(run, blocking, workerId, dependencies);
        return checkpoint();
      }

      const pendingDirector = newestOrder(
        orders.filter(
          ({ kind, status }) =>
            kind === "director_round" &&
            (status === "queued" || status === "running"),
        ),
      );
      if (pendingDirector) {
        await executeOrder(
          pendingDirector,
          input,
          context,
          workerId,
          dependencies,
        );
        await checkpoint();
        continue;
      }

      const pendingArchitect = newestOrder(
        orders.filter(
          ({ kind, status }) =>
            kind === "architect_course" &&
            (status === "queued" || status === "running"),
        ),
      );
      if (pendingArchitect) {
        await executeOrder(
          pendingArchitect,
          input,
          context,
          workerId,
          dependencies,
        );
        await checkpoint();
        continue;
      }

      const submittedArchitect = newestOrder(
        orders.filter(
          ({ kind, status }) =>
            kind === "architect_course" && status === "submitted",
        ),
      );
      if (submittedArchitect) {
        const architectureRef =
          submittedArchitect.submission?.artifactRefs.find(
            ({ kind }) => kind === "course_architecture",
          );
        if (!architectureRef) {
          throw new Error("submitted Architect WorkOrder 缺少课程架构");
        }
        createCourseRunCommands(repository).createDirectorRound({
          fence: toFence(
            requiredRun(repository.runs.load(run.id), run.id),
            workerId,
          ),
          purpose: "review_architecture",
          inputArtifactRefs: [architectureRef],
          now: dependencies.now(),
        });
        await checkpoint();
        continue;
      }

      const currentPageOrders = currentRunnablePageOrders(run, orders);
      if (currentPageOrders.length > 0) {
        const batch = currentPageOrders.slice(0, concurrency);
        const results = await runPromisePool(
          batch,
          (workOrder) =>
            executeOrder(
              workOrder,
              input,
              context,
              workerId,
              dependencies,
            ),
          { concurrency, signal: context.abortSignal },
        );
        const rejected = results.find(
          ({ status }) => status === "rejected",
        );
        if (rejected?.status === "rejected") {
          throw rejected.reason;
        }
        await checkpoint();
        continue;
      }

      const latestRun = requiredRun(
        repository.runs.load(run.id),
        run.id,
      );
      const latestOrders = repository.workOrders.listByTask(run.taskId);
      const pendingReviewer = newestOrder(
        latestOrders.filter(
          ({ kind, status }) =>
            kind === "review_course" &&
            (status === "queued" || status === "running"),
        ),
      );
      if (pendingReviewer) {
        await executeOrder(
          pendingReviewer,
          input,
          context,
          workerId,
          dependencies,
        );
        await checkpoint();
        continue;
      }

      if (latestRun.currentReview) {
        const reviewWorkOrder = repository.workOrders.load(
          latestRun.currentReview.workOrderId,
        );
        if (reviewWorkOrder?.status === "submitted") {
          createCourseRunCommands(repository).createDirectorRound({
            fence: toFence(latestRun, workerId),
            purpose: "decide_course_review",
            inputArtifactRefs: [
              latestRun.activeArchitecture!.architectureRef,
              latestRun.currentReview.artifactRef,
            ],
            now: dependencies.now(),
          });
          await checkpoint();
          continue;
        }
      }

      if (allCurrentPagesReady(latestRun, repository)) {
        createCourseRunCommands(repository).createCurrentReview({
          fence: toFence(latestRun, workerId),
          now: dependencies.now(),
        });
        await checkpoint();
        continue;
      }

      throw new Error(
        "CourseRun 没有可执行 WorkOrder，页面依赖或当前指针可能损坏",
      );
    }

    throw new Error("CourseRunEngine 超过最大状态迁移次数");
  } catch (error) {
    if (isAbortError(error, context.abortSignal)) throw error;
    console.error("[course-run]", {
      event: "engine:error",
      traceId: input.traceId,
      taskId: input.taskId,
      courseId: input.courseId,
      ...serializeErrorForLog(error),
    });
    const current = repository.runs.load(run.id);
    if (current && TERMINAL_PHASES.has(current.phase)) {
      return checkpoint();
    }
    if (current && current.leaseOwner !== workerId) {
      throw new CourseRunLeaseUnavailableError(
        "CourseRun 执行权已由另一个 worker 接管",
      );
    }
    if (
      current &&
      !TERMINAL_PHASES.has(current.phase) &&
      current.leaseOwner === workerId
    ) {
      try {
        const publicError = classifyPublicAgentError({
          error,
          code: "COURSE_RUN_ENGINE_FAILED",
        });
        createCourseRevisionCommands(repository).failCourse({
          fence: toFence(current, workerId),
          code: publicError.code,
          causeCode: publicError.causeCode,
          message: publicError.message,
          now: dependencies.now(),
        });
        return checkpoint();
      } catch {
        // 保留原始错误；数据库围栏或状态损坏时，外层 Task Service 负责终态兜底。
      }
    }
    throw error;
  } finally {
    releaseOwnedWorkOrders(input.taskId, workerId, dependencies);
    releaseRunLease(run.id, workerId, dependencies);
  }
}

function prepareAndClaimRun(
  input: CourseRunEngineInput,
  workerId: string,
  dependencies: CourseRunEngineDependencies,
) {
  const { repository } = dependencies;
  let run = repository.runs.loadByTaskId(input.taskId);
  // CourseRun 可能已提交终态，但进程在 TaskRecord 映射落盘前退出。
  // 终态只读投影不需要 lease，让恢复扫描补齐外层任务终态即可。
  if (run && TERMINAL_PHASES.has(run.phase)) return run;
  if (run && run.traceId !== input.traceId) {
    const previousTraceId = run.traceId;
    run = repository.runs.adoptTrace({
      runId: run.id,
      previousTraceId,
      nextTraceId: input.traceId,
      now: dependencies.now(),
      authorize: () =>
        assertCourseRunTaskExecutionActive(repository.runs.database, {
          taskId: input.taskId,
          courseId: input.courseId,
          traceId: input.traceId,
        }),
    });
    if (!run) {
      throw new CourseRunLeaseUnavailableError(
        "旧 CourseRun lease 尚未释放，暂时不能切换到新的 trace",
        "trace_adoption_blocked",
      );
    }
    releaseRunningOrdersAfterTraceAdoption(
      input.taskId,
      repository,
      dependencies.now(),
    );
  }

  const bootstrapped = repository.bootstrapCourseRun({
    taskId: input.taskId,
    courseId: input.courseId,
    traceId: input.traceId,
    now: dependencies.now(),
  });
  if (TERMINAL_PHASES.has(bootstrapped.run.phase)) {
    return bootstrapped.run;
  }
  const claimed = repository.runs.claimLease({
    runId: bootstrapped.run.id,
    owner: workerId,
    now: dependencies.now(),
    durationMs: RUN_LEASE_MS,
    expectedTraceId: input.traceId,
    authorize: () =>
      assertCourseRunTaskExecutionActive(
        repository.runs.database,
        bootstrapped.run,
      ),
  });
  if (!claimed) {
    throw new CourseRunLeaseUnavailableError(
      "CourseRun 已由另一个 worker 执行",
    );
  }
  return claimed;
}

async function executeOrder(
  workOrder: WorkOrder,
  input: CourseRunEngineInput,
  context: CourseRunEngineContext,
  runLeaseOwner: string,
  dependencies: CourseRunEngineDependencies,
) {
  await assertEngineExecutionActive(context);
  const owner = `${runLeaseOwner}:${workOrder.id}`.slice(0, 160);
  const claimed = dependencies.repository.workOrders.claim(
    workOrder.id,
    {
      owner,
      now: dependencies.now(),
      durationMs: workOrderLeaseDuration(workOrder),
      authorize: () => {
        const currentRun = requiredRun(
          dependencies.repository.runs.loadByTaskId(workOrder.taskId),
          workOrder.taskId,
        );
        assertRunExecutionFence(
          dependencies.repository.runs.database,
          currentRun,
          input.traceId,
          runLeaseOwner,
        );
      },
    },
  );
  if (!claimed) {
    const current = dependencies.repository.workOrders.load(
      workOrder.id,
    );
    if (
      current &&
      ["submitted", "accepted", "blocked", "failed"].includes(
        current.status,
      )
    ) {
      return;
    }
    throw new CourseRunLeaseUnavailableError(
      `WorkOrder ${workOrder.id} 暂时无法领取`,
    );
  }
  dependencies.repository.events.append(
    {
      taskId: claimed.taskId,
      traceId: input.traceId,
      type: "work_order_claimed",
      stage: stageForOrder(claimed),
      pageId:
        claimed.scope.type === "page"
          ? claimed.scope.pageId
          : undefined,
      agent: agentForOrder(claimed),
      safeSummary: `${agentForOrder(claimed)} 已领取当前工作单`,
      payload: {
        workOrderId: claimed.id,
        kind: claimed.kind,
        executionAttempt: claimed.executionAttempt,
      },
      createdAt: dependencies.now(),
    },
    () => {
      const currentRun = requiredRun(
        dependencies.repository.runs.loadByTaskId(claimed.taskId),
        claimed.taskId,
      );
      assertRunExecutionFence(
        dependencies.repository.runs.database,
        currentRun,
        input.traceId,
        runLeaseOwner,
      );
    },
  );

  const agentId = agentForOrder(claimed);
  const agentDefinition =
    await dependencies.getAgentDefinition(agentId);
  const route = resolveModelRoute(agentDefinition.modelCapability);
  const tiers = [route.primary, route.fallback].filter(
    (tier, index, values): tier is NonNullable<typeof tier> =>
      Boolean(tier) && values.indexOf(tier) === index,
  );
  let lastError: unknown;
  try {
    for (let index = 0; index < tiers.length; index += 1) {
      await assertEngineExecutionActive(context);
      const current = renewExecutionLeases(
        requiredWorkOrder(
        dependencies.repository.workOrders.load(claimed.id),
        claimed.id,
        ),
        owner,
        runLeaseOwner,
        input.traceId,
        dependencies,
      );
      if (current.status !== "running") return;

      try {
        const model = dependencies.getModel(tiers[index]);
        await invokeAgent(
          current,
          model,
          input,
          context,
          runLeaseOwner,
          owner,
          dependencies,
        );
        await assertEngineExecutionActive(context);
        return;
      } catch (error) {
        if (isAbortError(error, context.abortSignal)) {
          releaseWorkOrder(claimed.id, owner, dependencies);
          throw error;
        }
        const terminal = dependencies.repository.workOrders.load(
          claimed.id,
        );
        if (
          terminal &&
          terminal.status !== "running"
        ) {
          return;
        }
        lastError = error;
        const hasFallback = index + 1 < tiers.length;
        console.error("[course-run]", {
          event: "agent:model-tier-failed",
          traceId: input.traceId,
          workOrderId: claimed.id,
          agentId,
          modelTier: tiers[index],
          retryable: isRetryableAgentExecutionError(error),
          fallbackAvailable: hasFallback,
          ...serializeErrorForLog(error),
        });
        if (!hasFallback || !isRetryableAgentExecutionError(error)) break;
      }
    }

    failWorkOrder(
      claimed.id,
      owner,
      lastError ?? new Error("Agent 未返回结果"),
      input.traceId,
      runLeaseOwner,
      dependencies,
    );
  } catch (error) {
    if (isAbortError(error, context.abortSignal)) {
      releaseWorkOrder(claimed.id, owner, dependencies);
      throw error;
    }
    failWorkOrder(
      claimed.id,
      owner,
      error,
      input.traceId,
      runLeaseOwner,
      dependencies,
    );
  }
}

async function invokeAgent(
  workOrder: WorkOrder,
  model: unknown,
  input: CourseRunEngineInput,
  context: CourseRunEngineContext,
  runLeaseOwner: string,
  workOrderLeaseOwner: string,
  dependencies: CourseRunEngineDependencies,
) {
  const agentId = agentForOrder(workOrder);
  await dependencies.agentExecutor.execute(agentId, {
    abortSignal: context.abortSignal,
    beforeToolCall: () => assertEngineExecutionActive(context),
    creationBrief: input.creationBrief,
    model,
    referencePacks: input.referencePacks ?? [],
    repository: dependencies.repository,
    runLeaseOwner,
    traceId: input.traceId,
    workOrder,
    workOrderLeaseOwner,
  });
}

async function assertEngineExecutionActive(
  context: CourseRunEngineContext,
) {
  throwIfAborted(context.abortSignal);
  await context.assertExecutionActive?.();
  throwIfAborted(context.abortSignal);
}

function currentRunnablePageOrders(
  run: CourseRun,
  orders: WorkOrder[],
) {
  const architectureId = run.activeArchitecture?.architectureRef.id;
  if (!architectureId) return [];
  return orders
    .filter(
      (workOrder) =>
        (workOrder.kind === "build_page" ||
          workOrder.kind === "fix_page") &&
        (workOrder.status === "queued" ||
          workOrder.status === "running") &&
        workOrder.inputArtifactRefs.some(
          ({ id }) => id === architectureId,
        ),
    )
    .sort(compareOrders);
}

function allCurrentPagesReady(
  run: CourseRun,
  repository: CourseRunRepository,
) {
  const architectureRef = run.activeArchitecture?.architectureRef;
  if (!architectureRef || run.stalePageIds.length > 0) return false;
  const architectureArtifact = repository.artifacts.load(
    architectureRef.id,
  );
  if (!architectureArtifact) return false;
  const architecture = CourseArchitectureSchema.parse(
    architectureArtifact.payload,
  );
  return architecture.pageTasks.every(
    ({ pageId }) => run.currentPages[pageId] !== undefined,
  );
}

function findBlockingCurrentOrder(
  run: CourseRun,
  orders: WorkOrder[],
) {
  const newestArchitect = newestOrder(
    orders.filter(({ kind }) => kind === "architect_course"),
  );
  if (
    newestArchitect &&
    (newestArchitect.status === "blocked" ||
      newestArchitect.status === "failed")
  ) {
    return newestArchitect;
  }

  const newestDirector = newestOrder(
    orders.filter(({ kind }) => kind === "director_round"),
  );
  if (
    newestDirector &&
    (newestDirector.status === "blocked" ||
      newestDirector.status === "failed")
  ) {
    return newestDirector;
  }

  const architectureId = run.activeArchitecture?.architectureRef.id;
  const currentBranch = architectureId
    ? orders.filter((workOrder) =>
        workOrder.inputArtifactRefs.some(({ id }) => id === architectureId),
      )
    : [];
  return newestOrder(
    currentBranch.filter(
      ({ status }) => status === "blocked" || status === "failed",
    ),
  );
}

function failRunForWorkOrder(
  run: CourseRun,
  workOrder: WorkOrder,
  leaseOwner: string,
  dependencies: CourseRunEngineDependencies,
) {
  createCourseRevisionCommands(dependencies.repository).failCourse({
    fence: toFence(run, leaseOwner),
    code: workOrder.error?.code ?? "WORK_ORDER_BLOCKED",
    causeCode: workOrder.error?.causeCode,
    message:
      workOrder.error?.message ??
      workOrder.submission?.issues.join("；") ??
      `${workOrder.kind} 无法完成`,
    now: dependencies.now(),
  });
}

function failWorkOrder(
  workOrderId: string,
  owner: string,
  error: unknown,
  traceId: string,
  runLeaseOwner: string,
  dependencies: CourseRunEngineDependencies,
) {
  const repository = dependencies.repository;
  const now = dependencies.now();
  runInTransaction(repository.runs.database, () => {
    const current = repository.workOrders.load(workOrderId);
    if (!current || current.status !== "running") return;
    const run = requiredRun(
      repository.runs.loadByTaskId(current.taskId),
      current.taskId,
    );
    assertRunExecutionFence(
      repository.runs.database,
      run,
      traceId,
      runLeaseOwner,
    );
    if (current.leaseOwner !== owner) {
      throw new CourseRunLeaseUnavailableError(
        `WorkOrder ${workOrderId} 的执行权已变化`,
      );
    }
    const publicError = classifyPublicAgentError({ error });
    const next = WorkOrderSchema.parse({
      ...current,
      lockVersion: current.lockVersion + 1,
      status: "failed",
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      error: {
        code: publicError.code,
        causeCode: publicError.causeCode,
        message: publicError.message,
        retryable: isRetryableAgentExecutionError(error),
        occurredAt: now,
      },
      updatedAt: now,
    });
    if (
      !repository.workOrders.compareAndSet(next, {
        expectedLockVersion: current.lockVersion,
        expectedStatus: "running",
        expectedLeaseOwner: owner,
      })
    ) {
      throw new Error("WorkOrder 失败终态写入发生并发冲突");
    }
    repository.events.appendInTransaction({
      taskId: current.taskId,
      traceId,
      type: "work_order_failed",
      stage: stageForOrder(current),
      pageId:
        current.scope.type === "page"
          ? current.scope.pageId
          : undefined,
      agent: agentForOrder(current),
      safeSummary: publicError.message,
      payload: { workOrderId: current.id, code: publicError.code },
      createdAt: now,
    });
  });
}

function isRetryableAgentExecutionError(error: unknown) {
  return (
    isRetryableModelError(error) ||
    error instanceof AgentTerminalNotCommittedError
  );
}

function projectCurrentState(
  input: CourseRunEngineInput,
  concurrency: number,
  repository: CourseRunRepository,
) {
  const run = requiredRun(
    repository.runs.loadByTaskId(input.taskId),
    input.taskId,
  );
  return projectCourseState({
    run,
    creationBrief: input.creationBrief,
    referencePacks: input.referencePacks,
    workOrders: repository.workOrders.listByTask(input.taskId),
    artifacts: repository.artifacts.listByTask(input.taskId),
    events: repository.events.list(input.taskId),
    workerConfig: { mode: "parallel", concurrency },
  });
}

function toFence(run: CourseRun, leaseOwner: string) {
  return {
    runId: run.id,
    expectedLockVersion: run.lockVersion,
    traceId: run.traceId,
    leaseOwner,
  };
}

function newestOrder(orders: WorkOrder[]) {
  return [...orders].sort(compareOrders).at(-1);
}

function compareOrders(left: WorkOrder, right: WorkOrder) {
  return (
    left.revision - right.revision ||
    Date.parse(left.updatedAt) - Date.parse(right.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function requiredRun(run: CourseRun | undefined, id: string) {
  if (!run) throw new Error(`CourseRun 不存在：${id}`);
  return run;
}

function requiredWorkOrder(
  workOrder: WorkOrder | undefined,
  id: string,
) {
  if (!workOrder) throw new Error(`WorkOrder 不存在：${id}`);
  return workOrder;
}
