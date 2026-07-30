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

const PedagogyModelPageSchema = z.object({
  cognitiveLevel: CognitiveLevelSchema,
  scaffolding: z.array(z.string().min(2).max(200)).min(1).max(6),
  interactionPurpose: z.string().min(2).max(240),
  checkForUnderstanding: z.string().min(2).max(240),
});

const PedagogyModelOutputSchema = z.object({
  audienceSummary: z.string().min(5).max(300),
  ageAdaptation: AgeAdaptationSchema,
  learningProgression: z.array(z.string().min(5).max(300)).min(2).max(12),
  interactionCadence: InteractionCadenceSchema,
  pageGuidance: z.array(PedagogyModelPageSchema).min(1),
  // 部分 OpenAI-compatible 模型会把对象数组退化为字符串数组。
  // 此处允许松散接收，随后立即规范化并交给严格领域 Schema 复验。
  misconceptions: z.array(z.unknown()).max(8),
  accessibilityStrategies: z
    .array(z.string().min(2).max(240))
    .min(1)
    .max(10),
});

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
    normalizeOutput: (output) =>
      normalizePedagogyModelOutput(output, input.outline),
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
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
    misconceptions: draft.misconceptions.map((item) => {
      const parsed = MisconceptionStrategySchema.safeParse(item);

      if (parsed.success) {
        return parsed.data;
      }

      if (typeof item === "string" && item.trim().length >= 2) {
        return {
          misconception: item.trim(),
          correction: `使用对比例子和理解检查纠正这一误区：${item.trim()}`,
        };
      }

      throw new AiSchemaValidationError(
        "Pedagogy misconceptions 必须是文字或包含 misconception/correction 的对象。",
      );
    }),
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

/**
 * 部分 JSON object mode Provider 会把完整课程递进压成一句话。仅当模型
 * 已提供一条合法策略时，才用可信 CoursePlan 的首尾页面补成第二条；空数组、
 * 非字符串和其他非法字段继续由模型 Schema 严格拒绝。
 */
export function normalizePedagogyModelOutput(
  output: unknown,
  outline: CoursePlan,
): unknown {
  if (!isRecord(output) || !Array.isArray(output.learningProgression)) {
    return output;
  }
  const progression = output.learningProgression;
  if (
    progression.length !== 1 ||
    !z.string().trim().min(5).max(300).safeParse(progression[0]).success
  ) {
    return output;
  }

  const firstTitle = outline.pages[0]?.title.slice(0, 80);
  const lastTitle = outline.pages.at(-1)?.title.slice(0, 80);
  if (!firstTitle || !lastTitle) return output;

  return {
    ...output,
    learningProgression: [
      progression[0],
      `按页面顺序从“${firstTitle}”推进到“${lastTitle}”，完成由导入、理解到总结的学习闭环。`,
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
