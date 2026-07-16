import { z } from "zod";

export const CourseGenerationNodeNameSchema = z.enum([
  "intent",
  "planner",
  "course-design",
  "page-writer",
  "assets",
  "html-engineer",
]);

export const SupervisorNodeTargetSchema = z
  .object({
    nodeName: CourseGenerationNodeNameSchema,
    pageId: z.string().min(1).max(80).optional(),
  })
  .strict();

export const SupervisorStopReasonCodeSchema = z.enum([
  "requested",
  "retry_exhausted",
  "non_retryable_error",
  "invalid_decision",
  "no_available_node",
  "no_progress",
  "decision_limit",
]);

export const SupervisorStopReasonSchema = z
  .object({
    code: SupervisorStopReasonCodeSchema,
    message: z.string().min(1).max(500),
    recoverable: z.boolean(),
  })
  .strict();

const SupervisorReasonSummarySchema = z.string().min(2).max(300);

const SupervisorRunDecisionSchema = z
  .object({
    action: z.literal("run"),
    nextNode: SupervisorNodeTargetSchema,
    reasonSummary: SupervisorReasonSummarySchema,
  })
  .strict();

const SupervisorRetryDecisionSchema = z
  .object({
    action: z.literal("retry"),
    nextNode: SupervisorNodeTargetSchema,
    retryTarget: SupervisorNodeTargetSchema,
    reasonSummary: SupervisorReasonSummarySchema,
  })
  .strict()
  .superRefine((decision, context) => {
    if (targetKey(decision.nextNode) !== targetKey(decision.retryTarget)) {
      context.addIssue({
        code: "custom",
        message: "retry 决策的 nextNode 必须与 retryTarget 一致",
        path: ["retryTarget"],
      });
    }
  });

const SupervisorCompleteDecisionSchema = z
  .object({
    action: z.literal("complete"),
    reasonSummary: SupervisorReasonSummarySchema,
  })
  .strict();

const SupervisorStopDecisionSchema = z
  .object({
    action: z.literal("stop"),
    reasonSummary: SupervisorReasonSummarySchema,
    stopReason: SupervisorStopReasonSchema,
  })
  .strict();

export const SupervisorDecisionSchema = z.union([
  SupervisorRunDecisionSchema,
  SupervisorRetryDecisionSchema,
  SupervisorCompleteDecisionSchema,
  SupervisorStopDecisionSchema,
]);

export const SupervisorAttemptSchema = SupervisorNodeTargetSchema.extend({
  attempts: z.number().int().min(1).max(3),
}).strict();

export const SupervisorRuntimeStateSchema = z
  .object({
    decisionCount: z.number().int().nonnegative().max(64),
    attempts: z.array(SupervisorAttemptSchema).max(30),
    lastDecision: SupervisorDecisionSchema.optional(),
  })
  .strict();

export type CourseGenerationNodeName = z.infer<
  typeof CourseGenerationNodeNameSchema
>;
export type SupervisorNodeTarget = z.infer<
  typeof SupervisorNodeTargetSchema
>;
export type SupervisorStopReasonCode = z.infer<
  typeof SupervisorStopReasonCodeSchema
>;
export type SupervisorStopReason = z.infer<
  typeof SupervisorStopReasonSchema
>;
export type SupervisorDecision = z.infer<typeof SupervisorDecisionSchema>;
export type SupervisorAttempt = z.infer<typeof SupervisorAttemptSchema>;
export type SupervisorRuntimeState = z.infer<
  typeof SupervisorRuntimeStateSchema
>;

export function targetKey(target: SupervisorNodeTarget) {
  return `${target.nodeName}:${target.pageId ?? "course"}`;
}
