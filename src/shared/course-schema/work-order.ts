import { z } from "zod";

import { ArtifactRefSchema } from "./course-artifact";
import {
  CourseGenerationCauseCodeSchema,
  CourseIdSchema,
} from "./course-generation-state";
import { CourseTaskIdSchema } from "./course-task-event";

export const WorkOrderKindSchema = z.enum([
  "director_round",
  "architect_course",
  "build_page",
  "fix_page",
  "review_course",
]);

export const WorkOrderStatusSchema = z.enum([
  "waiting_dependencies",
  "queued",
  "running",
  "submitted",
  "accepted",
  "revision_requested",
  "superseded",
  "blocked",
  "failed",
  "cancelled",
]);

export const WorkOrderScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("course") }).strict(),
  z
    .object({
      type: z.literal("page"),
      pageId: z.string().min(1).max(80),
    })
    .strict(),
]);

export const AgentBudgetSchema = z
  .object({
    maxSteps: z.number().int().positive().max(100),
    maxToolCalls: z.number().int().positive().max(500),
    timeoutMs: z.number().int().positive().max(60 * 60 * 1_000),
    maxOutputTokens: z.number().int().positive().max(1_000_000),
  })
  .strict();

export const SubmissionSchema = z
  .object({
    workOrderId: z.string().min(1).max(160),
    status: z.enum(["done", "blocked"]),
    artifactRefs: z.array(ArtifactRefSchema).max(100),
    evidence: z.array(z.string().trim().min(1).max(1_000)).max(100),
    issues: z.array(z.string().trim().min(1).max(1_000)).max(100),
  })
  .strict();

export const WorkOrderErrorSchema = z
  .object({
    code: z.string().min(1).max(100),
    causeCode: CourseGenerationCauseCodeSchema.optional(),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const WorkOrderSchema = z
  .object({
    version: z.literal(1),
    lockVersion: z.number().int().nonnegative(),
    id: z.string().min(1).max(160),
    taskId: CourseTaskIdSchema,
    courseId: CourseIdSchema,
    parentWorkOrderId: z.string().min(1).max(160).optional(),
    supersedesWorkOrderId: z.string().min(1).max(160).optional(),
    causedByReviewIssueIds: z.array(z.string().min(1).max(160)).max(100),
    dependencyWorkOrderIds: z.array(z.string().min(1).max(160)).max(200),
    /**
     * 新写入 WorkOrder 必须指定执行 Agent。optional 仅用于读取迁移前的
     * durable payload；Engine 会通过兼容映射补齐旧数据。
     */
    agentId: z.string().min(1).max(120).optional(),
    kind: WorkOrderKindSchema,
    scope: WorkOrderScopeSchema,
    status: WorkOrderStatusSchema,
    idempotencyKey: z.string().min(1).max(300),
    inputArtifactRefs: z.array(ArtifactRefSchema).max(200),
    buildDependencyPageIds: z.array(z.string().min(1).max(80)).max(200),
    inputSealedAt: z.string().datetime({ offset: true }).optional(),
    checkpointArtifactRefs: z.array(ArtifactRefSchema).max(200),
    acceptance: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
    allowedTools: z.array(z.string().min(1).max(120)).min(1).max(100),
    budget: AgentBudgetSchema,
    executionAttempt: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    leaseOwner: z.string().min(1).max(160).optional(),
    leaseExpiresAt: z.string().datetime({ offset: true }).optional(),
    submission: SubmissionSchema.optional(),
    error: WorkOrderErrorSchema.optional(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((workOrder, context) => {
    const pageKind =
      workOrder.kind === "build_page" || workOrder.kind === "fix_page";
    if (pageKind !== (workOrder.scope.type === "page")) {
      context.addIssue({
        code: "custom",
        message: pageKind
          ? `${workOrder.kind} 必须使用页面 scope`
          : `${workOrder.kind} 必须使用课程 scope`,
        path: ["scope"],
      });
    }

    for (const [field, values] of [
      ["causedByReviewIssueIds", workOrder.causedByReviewIssueIds],
      ["dependencyWorkOrderIds", workOrder.dependencyWorkOrderIds],
      ["buildDependencyPageIds", workOrder.buildDependencyPageIds],
      ["allowedTools", workOrder.allowedTools],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${field} 不能包含重复值`,
          path: [field],
        });
      }
    }

    if (
      workOrder.parentWorkOrderId === workOrder.id ||
      workOrder.supersedesWorkOrderId === workOrder.id ||
      workOrder.dependencyWorkOrderIds.includes(workOrder.id)
    ) {
      context.addIssue({
        code: "custom",
        message: "WorkOrder 不能通过父级、替代或依赖关系引用自身",
        path: ["id"],
      });
    }

    if (
      workOrder.scope.type === "page" &&
      workOrder.buildDependencyPageIds.includes(workOrder.scope.pageId)
    ) {
      context.addIssue({
        code: "custom",
        message: "页面 WorkOrder 不能把自身页面作为生成依赖",
        path: ["buildDependencyPageIds"],
      });
    }

    if (
      workOrder.status === "waiting_dependencies" &&
      workOrder.buildDependencyPageIds.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "waiting_dependencies 必须包含尚待满足的页面生成依赖",
        path: ["buildDependencyPageIds"],
      });
    }
    if (
      workOrder.status === "waiting_dependencies" &&
      workOrder.inputSealedAt
    ) {
      context.addIssue({
        code: "custom",
        message: "依赖未满足时不能封口输入",
        path: ["inputSealedAt"],
      });
    }

    const requiresSealedInput = ![
      "waiting_dependencies",
      "cancelled",
    ].includes(workOrder.status);
    if (requiresSealedInput && !workOrder.inputSealedAt) {
      context.addIssue({
        code: "custom",
        message: `${workOrder.status} WorkOrder 必须已封口输入`,
        path: ["inputSealedAt"],
      });
    }

    const hasCompleteLease =
      Boolean(workOrder.leaseOwner) && Boolean(workOrder.leaseExpiresAt);
    if (workOrder.status === "running" && !hasCompleteLease) {
      context.addIssue({
        code: "custom",
        message: "running WorkOrder 必须持有完整 lease",
        path: ["leaseOwner"],
      });
    }
    if (
      workOrder.status !== "running" &&
      (workOrder.leaseOwner || workOrder.leaseExpiresAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "非 running WorkOrder 不能持有 lease",
        path: ["leaseOwner"],
      });
    }

    if (workOrder.submission?.workOrderId !== undefined) {
      if (workOrder.submission.workOrderId !== workOrder.id) {
        context.addIssue({
          code: "custom",
          message: "Submission.workOrderId 必须指向当前 WorkOrder",
          path: ["submission", "workOrderId"],
        });
      }
    }
    if (
      ["submitted", "accepted", "revision_requested", "superseded"].includes(
        workOrder.status,
      ) &&
      workOrder.submission?.status !== "done"
    ) {
      context.addIssue({
        code: "custom",
        message: `${workOrder.status} WorkOrder 必须包含 done Submission`,
        path: ["submission"],
      });
    }
    if (
      workOrder.status === "blocked" &&
      workOrder.submission?.status !== "blocked"
    ) {
      context.addIssue({
        code: "custom",
        message: "blocked WorkOrder 必须包含 blocked Submission",
        path: ["submission"],
      });
    }
    if (workOrder.status === "failed" && !workOrder.error) {
      context.addIssue({
        code: "custom",
        message: "failed WorkOrder 必须包含 error",
        path: ["error"],
      });
    }

    workOrder.inputArtifactRefs.forEach((artifact, index) => {
      if (artifact.courseId !== workOrder.courseId) {
        context.addIssue({
          code: "custom",
          message: "输入 Artifact 必须属于当前课程",
          path: ["inputArtifactRefs", index, "courseId"],
        });
      }
    });
  });

export type WorkOrderKind = z.infer<typeof WorkOrderKindSchema>;
export type WorkOrderStatus = z.infer<typeof WorkOrderStatusSchema>;
export type WorkOrderScope = z.infer<typeof WorkOrderScopeSchema>;
export type AgentBudget = z.infer<typeof AgentBudgetSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
export type WorkOrderError = z.infer<typeof WorkOrderErrorSchema>;
export type WorkOrder = z.infer<typeof WorkOrderSchema>;
