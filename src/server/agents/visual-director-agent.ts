import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import { buildVisualDirectorPrompts } from "@/server/prompts/visual-director";
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

import { createMinimalAgent } from "./core/minimal-agent";
import type {
  Agent,
  AgentRuntimeContext,
  AgentStateBase,
} from "./core/types";

const VisualModelOutputSchema = z.object({
  visualConcept: z.string().min(5).max(400),
  layoutPrinciples: z
    .array(z.string().trim().min(2).max(240))
    .min(1)
    .max(10),
  typographyGuidance: z.string().min(5).max(300),
  colorUsage: z.string().min(5).max(300),
  assetDirection: VisualAssetDirectionSchema,
  pageGuidance: z
    .array(
      z.object({
        focalPoint: z.string().min(2).max(240),
        composition: z.string().min(2).max(240),
        assetPurpose: z.string().min(2).max(240),
      }),
    )
    .min(1)
    .max(12),
  motionGuidance: VisualMotionGuidanceSchema,
  accessibilityRules: z.array(z.string().min(2).max(240)).min(2).max(12),
});

export type VisualDirectorAgentState = AgentStateBase & {
  task: {
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
    story: StoryArc;
  };
  brief?: VisualBrief;
};

export type VisualDirectorAgentDependencies = {
  generateBrief(input: {
    abortSignal?: AbortSignal;
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
    story: StoryArc;
    traceId: string;
  }): Promise<unknown>;
};

const visualLayoutFallbacks = [
  "跨页保持一致的内容网格、间距层级与清晰阅读顺序。",
  "核心学习内容和交互区域始终优先于装饰元素。",
] as const;

/**
 * 模型草稿允许偶发少一条原则，但最终领域对象仍必须满足两条独立规则。
 * 空输出继续失败，避免用默认值替代整个 Visual Director 的工作。
 */
export function normalizeVisualLayoutPrinciples(
  principles: readonly string[],
) {
  const normalized = principles
    .map((principle) => principle.trim())
    .filter(
      (principle, index, values) =>
        principle.length >= 2 && values.indexOf(principle) === index,
    );

  if (normalized.length === 0) {
    throw new AiSchemaValidationError(
      "Visual Director 至少包含一条布局原则。",
    );
  }

  if (normalized.length === 1) {
    for (const fallback of visualLayoutFallbacks) {
      if (!normalized.includes(fallback)) normalized.push(fallback);
    }
  }

  return normalized;
}

const defaultDependencies: VisualDirectorAgentDependencies = {
  generateBrief,
};

/** 创建只负责视觉规范的一步 VisualDirectorAgent。 */
export function createVisualDirectorAgent(
  dependencies: VisualDirectorAgentDependencies = defaultDependencies,
): Agent<VisualDirectorAgentState> {
  return createMinimalAgent({
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

/** 创建 VisualDirectorAgent 的可序列化初始状态。 */
export function createVisualDirectorAgentState(input: {
  intent: CourseIntent;
  outline: CoursePlan;
  pedagogy: PedagogyPlan;
  story: StoryArc;
}): VisualDirectorAgentState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

/** 使用默认模型依赖运行 VisualDirectorAgent。 */
export function runVisualDirectorAgent(
  input: {
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
    story: StoryArc;
  },
  context: AgentRuntimeContext,
) {
  return createVisualDirectorAgent().run(
    createVisualDirectorAgentState(input),
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
      assetGuidance: styleTemplate.assetGuidance,
      decoration: styleTemplate.decoration,
      motion: styleTemplate.motion,
    },
  });
  const draft = await generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "visual",
    maxTokens: 4_000,
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: VisualModelOutputSchema,
    schemaDescription:
      "A token-referencing visual brief with one ordered item per course page.",
    schemaName: "visual_brief_content",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    traceId: input.traceId,
  });

  if (draft.pageGuidance.length !== input.outline.pages.length) {
    throw new AiSchemaValidationError(
      `Visual pageGuidance 数量 ${draft.pageGuidance.length} 与课程页数 ${input.outline.pages.length} 不一致。`,
    );
  }

  return VisualBriefSchema.parse({
    ...draft,
    layoutPrinciples: normalizeVisualLayoutPrinciples(
      draft.layoutPrinciples,
    ),
    styleTemplateId,
    pageGuidance: draft.pageGuidance.map((guidance, index) => ({
      ...guidance,
      pageId: input.outline.pages[index].id,
    })),
  });
}
