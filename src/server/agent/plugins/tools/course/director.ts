import { tool } from "ai";
import { z } from "zod";

import { ToolIds } from "@/server/agent/ids";
import {
  createCourseDirectorExecution,
  buildCourseDirectorRunSummary,
  inspectCourseArchitecture,
  inspectCurrentCourseReview,
  resolveCourseDirectorFailureEligibility,
  type CourseDirectorExecution,
  type CourseDirectorExecutionInput,
  type CourseDirectorToolName,
} from "@/server/agent/plugins/contexts/course/director";
import { classifyPublicAgentError } from "@/server/course/projection/public-error";
import {
  ArchitectureRevisionBudgetExhaustedError,
  createCourseRevisionCommands,
} from "@/server/course/run/revision-commands";
import { createCourseRunCommands } from "@/server/course/run/commands";
import {
  FatalAgentRuntimeError,
  type AgentToolResult,
} from "@/server/agent/runtime";
import type {
  ArtifactRef,
  Submission,
} from "@/shared/course-schema";

const EmptyInputSchema = z.object({}).strict();
const ArchitectureRevisionInputSchema = z
  .object({
    issues: z
      .array(z.string().trim().min(2).max(1_000))
      .min(1)
      .max(30),
  })
  .strict();
const PageFixInputSchema = z
  .object({
    issueIds: z.array(z.string().min(1).max(160)).min(1).max(100),
  })
  .strict();
const FailCourseInputSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(2).max(1_000),
  })
  .strict();

export type CourseDirectorToolDependencies = {
  now?: () => string;
};

export function createCourseDirectorTools(
  execution: CourseDirectorExecution,
  dependencies: CourseDirectorToolDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const commands = createCourseRunCommands(execution.repository);
  const revisions = createCourseRevisionCommands(execution.repository);
  const runTerminal = createTerminalActionRunner(execution);

  return {
    [ToolIds.GetRunSummary]: tool({
      description:
        "读取当前课程的压缩状态：架构、各页工作单、整课 Review 和剩余返工预算。不返回原始 HTML。",
      inputSchema: EmptyInputSchema,
      execute: () =>
        success(
          "已读取 CourseRun 当前状态。",
          buildCourseDirectorRunSummary(execution),
        ),
    }),

    [ToolIds.InspectArchitecture]: tool({
      description:
        "检查不可变用户 brief 与当前封口课程架构：目标矩阵、页面职责、事实/术语定义、视觉拓扑、量的编码、样式材料语言、考核和真实生成依赖。",
      inputSchema: EmptyInputSchema,
      execute: () => {
        execution.inspections.architecture = true;
        return success(
          "已读取课程架构的语义验收信息。",
          inspectCourseArchitecture(execution),
        );
      },
    }),

    [ToolIds.InspectCourseReview]: tool({
      description:
        "读取当前整课 Review 的覆盖情况、问题、证据引用和建议结论。不返回页面原始 HTML。",
      inputSchema: EmptyInputSchema,
      execute: () => {
        execution.inspections.courseReview = true;
        return success(
          "已读取当前整课 Review。",
          inspectCurrentCourseReview(execution),
        );
      },
    }),

    [ToolIds.RequestArchitectureRevision]: tool({
      description:
        "当不可变 brief 未被保留，或目标矩阵、页面职责、难度、生成依赖、事实/术语正确性、视觉路径拓扑、量的编码或样式材料语言存在语义问题时，退回当前架构并创建新版 Architect WorkOrder。最多 2 轮，剩余次数见 RunSummary；必须给出 pageId/术语与可直接修正的具体矛盾。",
      inputSchema: ArchitectureRevisionInputSchema,
      execute: ({ issues }) =>
        runTerminal(
          ToolIds.RequestArchitectureRevision,
          "课程架构未通过主 Agent 语义验收，已退回修改。",
          () => {
            const result = revisions.requestArchitectureRevision({
              fence: fence(execution),
              architectWorkOrderId: execution.architectWorkOrder.id,
              directorWorkOrderId: execution.initialWorkOrder.id,
              directorRound: directorCommit(
                execution,
                ToolIds.RequestArchitectureRevision,
                "课程架构未通过主 Agent 语义验收，已退回修改。",
                [execution.architectureRef],
              ),
              issues,
              now: now(),
            });
            return {
              previousWorkOrderId: result.previous.id,
              replacementWorkOrderId: result.replacement.id,
              issues,
            };
          },
          [execution.architectureRef],
        ),
    }),

    [ToolIds.AcceptArchitectureAndDispatchPages]: tool({
      description:
        "只在不可变 brief、事实/术语、逐页职责、视觉拓扑、量的编码、样式材料语言和考核都已证明一致时，才接受当前完整课程架构，并在一个事务里按全部 PageTask 创建页面 WorkOrder。任一机制支路未明确连到接收者、主路未明确继续到物理终点、量编码冲突或术语把代理量冒充原量时不得接受。不能改写或补造 PageTask。",
      inputSchema: EmptyInputSchema,
      execute: () =>
        runTerminal(
          ToolIds.AcceptArchitectureAndDispatchPages,
          `课程架构已接受，将派发 ${execution.architecture.pageTasks.length} 个页面任务。`,
          () => {
            const result =
              execution.repository.acceptArchitectureAndDispatchPages({
                fence: fence(execution),
                architectWorkOrderId: execution.architectWorkOrder.id,
                directorWorkOrderId: execution.initialWorkOrder.id,
                directorRound: directorCommit(
                  execution,
                  ToolIds.AcceptArchitectureAndDispatchPages,
                  `课程架构已接受，已派发 ${execution.architecture.pageTasks.length} 个页面任务。`,
                  [execution.architectureRef],
                ),
                now: now(),
              });
            return {
              architectureRef: execution.architectureRef,
              planningRevision: result.run.planningRevision,
              pageWorkOrders: result.pageWorkOrders.map(
                ({ id, scope, status, dependencyWorkOrderIds }) => ({
                  id,
                  pageId:
                    scope.type === "page" ? scope.pageId : undefined,
                  status,
                  dependencyWorkOrderIds,
                }),
              ),
            };
          },
          [execution.architectureRef],
        ),
    }),

    [ToolIds.AssignPageFixes]: tool({
      description:
        "只针对当前 revise_pages Review 中选定的页面 issue 派发 Fix WorkOrder；系统会自动加入这些页面的传递依赖闭包。",
      inputSchema: PageFixInputSchema,
      execute: ({ issueIds }) =>
        runTerminal(
          ToolIds.AssignPageFixes,
          `已按 ${issueIds.length} 个 Review issue 派发定向页面返工。`,
          () => {
            const reviewWorkOrder = requiredReviewWorkOrder(execution);
            const result = revisions.assignPageFixes({
              fence: fence(execution),
              reviewWorkOrderId: reviewWorkOrder.id,
              directorWorkOrderId: execution.initialWorkOrder.id,
              directorRound: directorCommit(
                execution,
                ToolIds.AssignPageFixes,
                `已按 ${issueIds.length} 个 Review issue 派发定向页面返工。`,
                execution.reviewRef ? [execution.reviewRef] : [],
              ),
              issueIds,
              now: now(),
            });
            return {
              issueIds,
              stalePageIds: result.run.stalePageIds,
              fixWorkOrders: result.fixWorkOrders.map(
                ({ id, scope, status, dependencyWorkOrderIds }) => ({
                  id,
                  pageId:
                    scope.type === "page" ? scope.pageId : undefined,
                  status,
                  dependencyWorkOrderIds,
                }),
              ),
            };
          },
          execution.reviewRef ? [execution.reviewRef] : [],
        ),
    }),

    [ToolIds.RequestReplan]: tool({
      description:
        "确认当前 replan Review 指向全局规划错误，接受该结论并创建新版 Architect WorkOrder。",
      inputSchema: EmptyInputSchema,
      execute: () =>
        runTerminal(
          ToolIds.RequestReplan,
          "整课问题需要重新规划，已创建新版 Architect WorkOrder。",
          () => {
            const reviewWorkOrder = requiredReviewWorkOrder(execution);
            const result = revisions.requestReplan({
              fence: fence(execution),
              reviewWorkOrderId: reviewWorkOrder.id,
              directorWorkOrderId: execution.initialWorkOrder.id,
              directorRound: directorCommit(
                execution,
                ToolIds.RequestReplan,
                "整课问题需要重新规划，已创建新版 Architect WorkOrder。",
                execution.reviewRef ? [execution.reviewRef] : [],
              ),
              now: now(),
            });
            return {
              replanRound: result.run.replanRound,
              architectWorkOrderId: result.architectWorkOrder.id,
            };
          },
          execution.reviewRef ? [execution.reviewRef] : [],
        ),
    }),

    [ToolIds.AcceptCourseReviewAndPublish]: tool({
      description:
        "确认当前 pass Review，并运行 Final Gate；只有 Review 与当前 manifest 精确一致时才发布。",
      inputSchema: EmptyInputSchema,
      execute: () =>
        runTerminal(
          ToolIds.AcceptCourseReviewAndPublish,
          "整课 Review 和 Final Gate 已通过，课程已发布。",
          () => {
            const reviewWorkOrder = requiredReviewWorkOrder(execution);
            const result = commands.acceptCourseReviewAndPublish({
              fence: fence(execution),
              reviewWorkOrderId: reviewWorkOrder.id,
              directorWorkOrderId: execution.initialWorkOrder.id,
              directorRound: directorCommit(
                execution,
                ToolIds.AcceptCourseReviewAndPublish,
                "整课 Review 和 Final Gate 已通过，课程已发布。",
                execution.reviewRef ? [execution.reviewRef] : [],
              ),
              now: now(),
            });
            return {
              phase: result.run.phase,
              manifestArtifactId: result.manifestArtifact.id,
              reviewWorkOrderId: result.reviewWorkOrder.id,
            };
          },
          execution.reviewRef ? [execution.reviewRef] : [],
        ),
    }),

    [ToolIds.FailCourse]: tool({
      description:
        "只在机器 Gate 已确认受控 revision/replan/fix 预算耗尽或不可恢复状态时终止课程。模型自报错误不能获得失败权限。",
      inputSchema: FailCourseInputSchema,
      execute: () =>
        runTerminal(
          ToolIds.FailCourse,
          "课程生成已按受控失败条件终止。",
          () => {
            const eligibility =
              resolveCourseDirectorFailureEligibility(execution);
            if (!eligibility.eligible) {
              throw new DirectorActionRejectedError(
                "DIRECTOR_FAIL_NOT_ELIGIBLE",
                eligibility.message,
              );
            }
            const publicError = classifyPublicAgentError({
              code: eligibility.code,
              fallbackCode: "COURSE_DIRECTOR_STOPPED",
            });
            const run = revisions.failCourse({
              fence: fence(execution),
              code: publicError.code,
              causeCode: publicError.causeCode,
              message: publicError.message,
              directorRound: directorCommit(
                execution,
                ToolIds.FailCourse,
                `课程生成已终止：${publicError.message}`,
                [],
              ),
              now: now(),
            });
            return { phase: run.phase, error: run.error };
          },
          [],
        ),
    }),
  };
}

export type CourseDirectorTools = ReturnType<
  typeof createCourseDirectorTools
>;

export function createCourseDirectorToolExecution(
  input: CourseDirectorExecutionInput,
) {
  return createCourseDirectorExecution(input);
}

function createTerminalActionRunner(
  execution: CourseDirectorExecution,
) {
  let pending = Promise.resolve();

  return <Data>(
    action: CourseDirectorToolName,
    summary: string,
    operation: () => Data,
    artifactRefs: ArtifactRef[],
  ) => {
    const result = pending.then(() => {
      const current = execution.repository.workOrders.load(
        execution.initialWorkOrder.id,
      );
      if (
        current?.status === "accepted" &&
        current.submission?.status === "done"
      ) {
        return committed(
          "当前 Director 回合已经完成。",
          {
            action: completedAction(current.submission),
            workOrderId: current.id,
          },
          current.submission.artifactRefs,
        );
      }

      const missingInspection = requiredInspection(execution);
      if (missingInspection) {
        return failure(
          "DIRECTOR_REQUIRED_INSPECTION_MISSING",
          missingInspection,
        );
      }

      try {
        return committed(summary, operation(), artifactRefs);
      } catch (error) {
        if (error instanceof ArchitectureRevisionBudgetExhaustedError) {
          execution.failCourseAuthorization = {
            code: error.code,
            message: error.message,
          };
          return failure(error.code, error.message);
        }
        if (error instanceof DirectorActionRejectedError) {
          return failure(error.code, error.message);
        }
        if (isRecoverableDirectorRejection(error)) {
          return failure(
            "DIRECTOR_ACTION_REJECTED",
            error instanceof Error
              ? error.message
              : "Director 动作不满足当前状态前置条件。",
          );
        }
        throw new FatalAgentRuntimeError(
          "DIRECTOR_COMMAND_COMMIT_FAILED",
          "Director 领域命令写入失败，Engine 必须重新读取状态。",
          error,
        );
      }
    });
    pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

class DirectorActionRejectedError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DirectorActionRejectedError";
  }
}

function requiredInspection(
  execution: CourseDirectorExecution,
) {
  if (
    execution.roundKind === "review_architecture" &&
    !execution.inspections.architecture
  ) {
    return "决定接受、退回或终止课程架构前，必须先调用 inspect_architecture 读取语义验收证据。";
  }
  if (
    execution.roundKind === "decide_course_review" &&
    !execution.inspections.courseReview
  ) {
    return "决定发布、返工、重规划或终止课程前，必须先调用 inspect_course_review 读取结论和证据。";
  }
  return undefined;
}

function fence(execution: CourseDirectorExecution) {
  return {
    runId: execution.initialRun.id,
    expectedLockVersion: execution.initialRun.lockVersion,
    traceId: execution.traceId,
    leaseOwner: execution.runLeaseOwner,
  };
}

function directorCommit(
  execution: CourseDirectorExecution,
  action: CourseDirectorToolName,
  summary: string,
  artifactRefs: ArtifactRef[],
) {
  return {
    workOrderId: execution.initialWorkOrder.id,
    expectedLockVersion: execution.initialWorkOrder.lockVersion,
    leaseOwner: execution.workOrderLeaseOwner,
    action,
    summary,
    artifactRefs,
  };
}

function requiredReviewWorkOrder(execution: CourseDirectorExecution) {
  if (!execution.reviewWorkOrder) {
    throw new Error("当前 Director 回合没有 submitted CourseReview");
  }
  return execution.reviewWorkOrder;
}

function completedAction(submission: Submission) {
  return submission.evidence
    .find((item) => item.startsWith("director_action:"))
    ?.slice("director_action:".length);
}

function isRecoverableDirectorRejection(error: unknown) {
  if (!(error instanceof Error)) return false;
  return [
    "只有",
    "必须",
    "不能",
    "尚未",
    "达到上限",
    "不是 CourseRun 当前版本",
    "不存在的 Review issue",
    "Final Gate 未通过",
  ].some((fragment) => error.message.includes(fragment));
}

function success<Data>(
  summary: string,
  data: Data,
): AgentToolResult<Data, ArtifactRef> {
  return {
    ok: true,
    committed: false,
    terminal: false,
    summary,
    data,
  };
}

function committed<Data>(
  summary: string,
  data: Data,
  artifactRefs: ArtifactRef[],
): AgentToolResult<Data, ArtifactRef> {
  return {
    ok: true,
    committed: true,
    terminal: true,
    summary,
    data,
    artifactRefs,
  };
}

function failure(
  code: string,
  message: string,
): AgentToolResult<never, ArtifactRef> {
  return {
    ok: false,
    committed: false,
    terminal: false,
    code,
    message,
    retryable: true,
    feedback: [message],
  };
}
