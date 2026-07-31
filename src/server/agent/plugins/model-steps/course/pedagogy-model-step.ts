import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/infra/ai/client";
import { AiSchemaValidationError } from "@/server/infra/ai/error";
import { buildPedagogyPrompts } from "@/server/agent/plugins/prompts/course/model-steps/pedagogy";
import {
  AgeAdaptationSchema,
  CognitiveLevelSchema,
  InteractionCadenceSchema,
  MisconceptionStrategySchema,
  PedagogyPlanSchema,
  type CourseIntent,
  type CoursePlan,
  type PedagogyPlan,
} from "@/shared/course-schema";

import { normalizeSingleChoiceWording } from "./fixed-canvas-language";
import { createModelStep } from "./model-step";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepStateBase,
} from "./types";

const PROFESSIONAL_BRIEF_TIMEOUT_MS = 120_000;

const PedagogyModelPageSchema = z
  .object({
    cognitiveLevel: CognitiveLevelSchema,
    scaffolding: z.array(z.string().min(2).max(200)).min(1).max(6),
    interactionPurpose: z.string().min(2).max(240),
    checkForUnderstanding: z.string().min(2).max(240),
  })
  .strict();

export const PedagogyModelOutputSchema = z
  .object({
    audienceSummary: z.string().min(5).max(300),
    ageAdaptation: AgeAdaptationSchema,
    learningProgression: z.array(z.string().min(5).max(300)).min(2).max(12),
    interactionCadence: InteractionCadenceSchema,
    pageGuidance: z.array(PedagogyModelPageSchema).min(1),
    misconceptions: z.array(MisconceptionStrategySchema).max(8),
    accessibilityStrategies: z
      .array(z.string().min(2).max(240))
      .min(1)
      .max(10),
  })
  .strict();

export type PedagogyModelStepState = ModelStepStateBase & {
  task: { intent: CourseIntent; outline: CoursePlan };
  plan?: PedagogyPlan;
};

export type PedagogyModelStepDependencies = {
  generatePlan(input: {
    abortSignal?: AbortSignal;
    intent: CourseIntent;
    outline: CoursePlan;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: PedagogyModelStepDependencies = { generatePlan };

/** 创建只负责教学策略的一次模型步骤。 */
export function createPedagogyModelStep(
  dependencies: PedagogyModelStepDependencies = defaultDependencies,
): ModelStep<PedagogyModelStepState> {
  return createModelStep({
    name: "pedagogy-model-step",
    isComplete: (state) => Boolean(state.plan),
    step: async (state, context, emit) => {
      const plan = PedagogyPlanSchema.parse(
        await dependencies.generatePlan({
          abortSignal: context.abortSignal,
          intent: state.task.intent,
          outline: state.task.outline,
          traceId: context.traceId,
        }),
      );

      emit({
        type: "model_call",
        summary: `教学策略模型步骤已生成 ${plan.pageGuidance.length} 页指导。`,
        data: { purpose: "pedagogy-planning" },
      });

      return { ...state, plan };
    },
  });
}

/** 创建教学策略模型步骤的可序列化初始状态。 */
export function createPedagogyModelStepState(
  intent: CourseIntent,
  outline: CoursePlan,
): PedagogyModelStepState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: { intent, outline },
  };
}

/** 使用默认模型依赖运行一次教学策略模型步骤。 */
export function runPedagogyModelStep(
  intent: CourseIntent,
  outline: CoursePlan,
  context: ModelStepContext,
) {
  return createPedagogyModelStep().run(
    createPedagogyModelStepState(intent, outline),
    context,
  );
}

/** 生成教学语义并按 CoursePlan 顺序补齐稳定 pageId。 */
async function generatePlan(input: {
  abortSignal?: AbortSignal;
  intent: CourseIntent;
  outline: CoursePlan;
  traceId: string;
}) {
  const prompts = await buildPedagogyPrompts({
    courseIntent: input.intent,
    coursePlan: input.outline,
  });
  const draft = await generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "pedagogy",
    maxTokens: Math.max(
      6_500,
      2_400 + input.outline.pages.length * 420,
    ),
    prompt: prompts.userPrompt,
    promptFingerprint: prompts.fingerprint,
    schema: PedagogyModelOutputSchema,
    schemaDescription:
      "Age-adapted pedagogy guidance with one ordered item per course page.",
    schemaName: "pedagogy_plan_content",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    timeoutMs: PROFESSIONAL_BRIEF_TIMEOUT_MS,
    traceId: input.traceId,
  });

  if (draft.pageGuidance.length !== input.outline.pages.length) {
    throw new AiSchemaValidationError(
      `Pedagogy pageGuidance 数量 ${draft.pageGuidance.length} 与课程页数 ${input.outline.pages.length} 不一致。`,
    );
  }

  return PedagogyPlanSchema.parse({
    ...draft,
    pageGuidance: draft.pageGuidance.map((guidance, index) => {
      const page = input.outline.pages[index];
      const alignedGuidance =
        page.interactionType === "choice"
          ? {
              ...guidance,
              scaffolding: guidance.scaffolding.map(
                normalizeSingleChoiceWording,
              ),
              interactionPurpose: normalizeSingleChoiceWording(
                guidance.interactionPurpose,
              ),
              checkForUnderstanding: normalizeSingleChoiceWording(
                guidance.checkForUnderstanding,
              ),
            }
          : guidance;

      return {
        ...alignedGuidance,
        pageId: page.id,
      };
    }),
  });
}
