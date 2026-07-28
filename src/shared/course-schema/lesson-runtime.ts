import { z } from "zod";

/** 页面承担的教学场景；只描述教学意图，不绑定组件。 */
export const LessonSceneKindSchema = z.enum([
  "explain",
  "demo",
  "practice",
  "reflect",
  "recap",
]);

/** 由平台优先提供的代码原生视觉原语。 */
export const LessonVisualPrimitiveSchema = z.enum([
  "none",
  "concept-map",
  "function-graph",
  "venn",
  "timeline",
  "process",
  "comparison",
]);

export const LessonMotionCueActionSchema = z.enum([
  "reveal",
  "highlight",
  "draw",
  "wait-for-interaction",
]);

export const LessonMotionCueSchema = z
  .object({
    id: z.string().regex(/^cue-[a-z0-9-]+$/).max(80),
    action: LessonMotionCueActionSchema,
    targetId: z.string().min(1).max(80).optional(),
    delayMs: z.number().int().min(0).max(4_000),
    durationMs: z.number().int().min(100).max(2_000),
  })
  .strict();

export const LessonMotionPlanSchema = z
  .object({
    intensity: z.enum(["none", "subtle", "guided"]),
    cuePoints: z.array(LessonMotionCueSchema).max(16),
  })
  .strict();

export const LessonCompletionRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("view") }).strict(),
  z
    .object({
      type: z.literal("interaction-complete"),
      interactionId: z.string().min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("correct-answer"),
      interactionId: z.string().min(1).max(100),
    })
    .strict(),
]);

export const LessonRuntimeSchema = z
  .object({
    runtimeVersion: z.literal(1),
    sceneKind: LessonSceneKindSchema,
    visualPrimitive: LessonVisualPrimitiveSchema,
    motionPlan: LessonMotionPlanSchema,
    completionRule: LessonCompletionRuleSchema,
  })
  .strict();

const LessonRuntimeEventBaseSchema = z.object({
  channel: z.literal("keya.lesson-runtime"),
  pageId: z.string().min(1).max(80),
  runtimeVersion: z.literal(1),
});

/** iframe 可信运行时允许发给宿主的唯一消息集合。 */
export const LessonRuntimeEventSchema = z.discriminatedUnion("type", [
  LessonRuntimeEventBaseSchema.extend({
    type: z.literal("section-ready"),
  }).strict(),
  LessonRuntimeEventBaseSchema.extend({
    type: z.literal("interaction-started"),
    interactionId: z.string().min(1).max(100),
  }).strict(),
  LessonRuntimeEventBaseSchema.extend({
    type: z.literal("interaction-submitted"),
    interactionId: z.string().min(1).max(100),
    attempt: z.number().int().positive().max(100),
    result: z.enum(["correct", "incorrect", "partial"]),
  }).strict(),
  LessonRuntimeEventBaseSchema.extend({
    type: z.literal("section-completed"),
  }).strict(),
  LessonRuntimeEventBaseSchema.extend({
    type: z.literal("section-error"),
    code: z.string().min(1).max(80),
  }).strict(),
]);

export type LessonSceneKind = z.infer<typeof LessonSceneKindSchema>;
export type LessonVisualPrimitive = z.infer<
  typeof LessonVisualPrimitiveSchema
>;
export type LessonMotionPlan = z.infer<typeof LessonMotionPlanSchema>;
export type LessonCompletionRule = z.infer<
  typeof LessonCompletionRuleSchema
>;
export type LessonRuntime = z.infer<typeof LessonRuntimeSchema>;
export type LessonRuntimeEvent = z.infer<typeof LessonRuntimeEventSchema>;
