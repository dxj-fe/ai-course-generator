import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/infra/ai/client";
import { AiSchemaValidationError } from "@/server/infra/ai/error";
import { buildVisualDirectorPrompts } from "@/server/agent/plugins/prompts/course/model-steps/visual";
import {
  VisualAssetDirectionSchema,
  VisualBriefSchema,
  VisualMotionGuidanceSchema,
  type CourseIntent,
  type CoursePlan,
  type PedagogyPlan,
  type StoryArc,
  type VisualBrief,
} from "@/shared/course-schema";
import { getStyleTemplate } from "@/shared/templates/style";

import { createModelStep } from "./model-step";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepStateBase,
} from "./types";

const PROFESSIONAL_BRIEF_TIMEOUT_MS = 120_000;

export const VisualModelOutputSchema = z
  .object({
    visualConcept: z.string().min(5).max(400),
    layoutPrinciples: z
      .array(z.string().trim().min(2).max(240))
      .min(2)
      .max(10),
    typographyGuidance: z.string().min(5).max(300),
    colorUsage: z.string().min(5).max(300),
    assetDirection: VisualAssetDirectionSchema,
    pageGuidance: z
      .array(
        z
          .object({
            focalPoint: z.string().min(2).max(240),
            composition: z.string().min(2).max(240),
            assetPurpose: z.string().min(2).max(240),
          })
          .strict(),
      )
      .min(1),
    motionGuidance: VisualMotionGuidanceSchema,
    accessibilityRules: z.array(z.string().min(2).max(240)).min(2).max(12),
  })
  .strict();

export type VisualBriefModelStepState = ModelStepStateBase & {
  task: {
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
    story: StoryArc;
  };
  brief?: VisualBrief;
};

export type VisualBriefModelStepDependencies = {
  generateBrief(input: {
    abortSignal?: AbortSignal;
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
    story: StoryArc;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: VisualBriefModelStepDependencies = {
  generateBrief,
};

/** 创建只负责视觉规范的一次模型步骤。 */
export function createVisualBriefModelStep(
  dependencies: VisualBriefModelStepDependencies = defaultDependencies,
): ModelStep<VisualBriefModelStepState> {
  return createModelStep({
    name: "visual-brief-model-step",
    isComplete: (state) => Boolean(state.brief),
    step: async (state, context, emit) => {
      const brief = VisualBriefSchema.parse(
        await dependencies.generateBrief({
          abortSignal: context.abortSignal,
          intent: state.task.intent,
          outline: state.task.outline,
          pedagogy: state.task.pedagogy,
          story: state.task.story,
          traceId: context.traceId,
        }),
      );

      emit({
        type: "model_call",
        summary: `Visual Director 已生成 ${brief.pageGuidance.length} 页视觉指导。`,
        data: {
          purpose: "visual-planning",
          styleTemplateId: brief.styleTemplateId,
        },
      });

      return { ...state, brief };
    },
  });
}

/** 创建视觉规范模型步骤的可序列化初始状态。 */
export function createVisualBriefModelStepState(input: {
  intent: CourseIntent;
  outline: CoursePlan;
  pedagogy: PedagogyPlan;
  story: StoryArc;
}): VisualBriefModelStepState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

/** 使用默认模型依赖运行一次视觉规范模型步骤。 */
export function runVisualBriefModelStep(
  input: {
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
    story: StoryArc;
  },
  context: ModelStepContext,
) {
  return createVisualBriefModelStep().run(
    createVisualBriefModelStepState(input),
    context,
  );
}

/** 引用真实 StyleTemplate 生成视觉语义，并补齐技术 ID。 */
async function generateBrief(input: {
  abortSignal?: AbortSignal;
  intent: CourseIntent;
  outline: CoursePlan;
  pedagogy: PedagogyPlan;
  story: StoryArc;
  traceId: string;
}) {
  const styleIds = new Set(
    input.outline.pages.map(({ styleTemplateId }) => styleTemplateId),
  );

  if (styleIds.size !== 1) {
    throw new AiSchemaValidationError(
      "CoursePlan 必须先收敛为唯一 StyleTemplate。",
    );
  }

  const styleTemplateId = [...styleIds][0];
  const styleTemplate = getStyleTemplate(styleTemplateId);

  if (!styleTemplate) {
    throw new AiSchemaValidationError(
      `Visual Director 找不到 StyleTemplate ${styleTemplateId}。`,
    );
  }

  const prompts = await buildVisualDirectorPrompts({
    courseIntent: input.intent,
    coursePlan: input.outline,
    pedagogyPlan: input.pedagogy,
    pageCount: input.outline.pages.length,
    storyArc: input.story,
    styleTemplate: {
      id: styleTemplate.id,
      name: styleTemplate.name,
      goal: styleTemplate.goal,
      layoutDensity: styleTemplate.layoutDensity,
      typography: styleTemplate.typography,
      spacing: styleTemplate.spacing,
      surface: styleTemplate.surface,
      assetGuidance: styleTemplate.assetGuidance,
      decoration: styleTemplate.decoration,
      motion: styleTemplate.motion,
    },
  });
  const draft = await generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "visual",
    maxTokens: Math.max(
      6_500,
      2_400 + input.outline.pages.length * 400,
    ),
    prompt: prompts.userPrompt,
    promptFingerprint: prompts.fingerprint,
    schema: VisualModelOutputSchema,
    schemaDescription:
      "A token-referencing visual brief with one ordered item per course page.",
    schemaName: "visual_brief_content",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    timeoutMs: PROFESSIONAL_BRIEF_TIMEOUT_MS,
    traceId: input.traceId,
  });

  if (draft.pageGuidance.length !== input.outline.pages.length) {
    throw new AiSchemaValidationError(
      `Visual pageGuidance 数量 ${draft.pageGuidance.length} 与课程页数 ${input.outline.pages.length} 不一致。`,
    );
  }

  return VisualBriefSchema.parse({
    ...draft,
    styleTemplateId,
    pageGuidance: draft.pageGuidance.map((guidance, index) => ({
      ...guidance,
      pageId: input.outline.pages[index].id,
    })),
  });
}
