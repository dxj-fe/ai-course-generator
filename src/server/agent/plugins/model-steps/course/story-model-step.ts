import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/infra/ai/client";
import { AiSchemaValidationError } from "@/server/infra/ai/error";
import { buildStoryPrompts } from "@/server/agent/plugins/prompts/course/model-steps/story";
import {
  NarrativeModeSchema,
  StoryArcSchema,
  StoryCharacterSchema,
  type CourseIntent,
  type CoursePlan,
  type PedagogyPlan,
  type StoryArc,
} from "@/shared/course-schema";

import { normalizeSingleChoiceWording } from "./fixed-canvas-language";
import { createModelStep } from "./model-step";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepStateBase,
} from "./types";

const PROFESSIONAL_BRIEF_TIMEOUT_MS = 120_000;

const StoryModelOutputSchema = z.object({
  narrativeMode: NarrativeModeSchema,
  premise: z.string().min(5).max(400),
  learnerRole: z.string().min(2).max(200),
  mission: z.string().min(5).max(300),
  // 兼容会把简单角色对象压缩为名称字符串的模型输出。
  // 领域层仍会在规范化后用 StoryArcSchema 严格校验。
  characters: z.array(z.unknown()).max(6),
  pageBeats: z
    .array(
      z.object({
        beat: z.string().min(2).max(300),
        transition: z.string().min(2).max(240),
      }),
    )
    .min(1),
  tone: z.string().min(2).max(160),
  continuityRules: z.array(z.string().min(2).max(240)).min(1).max(10),
});

export type StoryModelStepState = ModelStepStateBase & {
  task: {
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
  };
  arc?: StoryArc;
};

export type StoryModelStepDependencies = {
  generateArc(input: {
    abortSignal?: AbortSignal;
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: StoryModelStepDependencies = { generateArc };

/** 创建只负责跨页叙事的一次模型步骤。 */
export function createStoryModelStep(
  dependencies: StoryModelStepDependencies = defaultDependencies,
): ModelStep<StoryModelStepState> {
  return createModelStep({
    name: "story-model-step",
    isComplete: (state) => Boolean(state.arc),
    step: async (state, context, emit) => {
      const arc = StoryArcSchema.parse(
        await dependencies.generateArc({
          abortSignal: context.abortSignal,
          intent: state.task.intent,
          outline: state.task.outline,
          pedagogy: state.task.pedagogy,
          traceId: context.traceId,
        }),
      );

      emit({
        type: "model_call",
        summary: `叙事模型步骤已生成 ${arc.pageBeats.length} 个跨页节点。`,
        data: { purpose: "story-planning" },
      });

      return { ...state, arc };
    },
  });
}

/** 创建叙事模型步骤的可序列化初始状态。 */
export function createStoryModelStepState(input: {
  intent: CourseIntent;
  outline: CoursePlan;
  pedagogy: PedagogyPlan;
}): StoryModelStepState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

/** 使用默认模型依赖运行一次叙事模型步骤。 */
export function runStoryModelStep(
  input: {
    intent: CourseIntent;
    outline: CoursePlan;
    pedagogy: PedagogyPlan;
  },
  context: ModelStepContext,
) {
  return createStoryModelStep().run(
    createStoryModelStepState(input),
    context,
  );
}

/** 生成叙事语义并按 CoursePlan 顺序补齐稳定 pageId。 */
async function generateArc(input: {
  abortSignal?: AbortSignal;
  intent: CourseIntent;
  outline: CoursePlan;
  pedagogy: PedagogyPlan;
  traceId: string;
}) {
  const prompts = await buildStoryPrompts({
    courseIntent: input.intent,
    coursePlan: input.outline,
    pedagogyPlan: input.pedagogy,
  });
  const draft = await generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "story",
    maxTokens: Math.max(
      6_000,
      2_200 + input.outline.pages.length * 380,
    ),
    normalizeOutput: (output) =>
      normalizeStoryModelOutput(output, input.outline),
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: StoryModelOutputSchema,
    schemaDescription:
      "A restrained cross-page narrative arc with one ordered beat per course page.",
    schemaName: "story_arc_content",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.3,
    timeoutMs: PROFESSIONAL_BRIEF_TIMEOUT_MS,
    traceId: input.traceId,
  });

  if (draft.pageBeats.length !== input.outline.pages.length) {
    throw new AiSchemaValidationError(
      `Story pageBeats 数量 ${draft.pageBeats.length} 与课程页数 ${input.outline.pages.length} 不一致。`,
    );
  }

  return StoryArcSchema.parse({
    ...draft,
    characters: normalizeStoryCharacters(
      draft.narrativeMode,
      draft.characters,
    ),
    pageBeats: draft.pageBeats.map((beat, index) => {
      const page = input.outline.pages[index];
      const alignedBeat =
        page.interactionType === "choice"
          ? {
              beat: normalizeSingleChoiceWording(beat.beat),
              transition: normalizeSingleChoiceWording(beat.transition),
            }
          : beat;

      return {
        ...alignedBeat,
        pageId: page.id,
      };
    }),
  });
}

/**
 * mission 与 premise/learnerRole 是同一叙事草稿的交接字段。只在后两者均
 * 已有效且 mission 确实缺失时，用可信 CoursePlan 首尾页生成最小任务线；
 * 显式空值或其他损坏输出不会被掩盖。
 */
export function normalizeStoryModelOutput(
  output: unknown,
  outline: CoursePlan,
): unknown {
  if (
    !isRecord(output) ||
    output.mission !== undefined ||
    !z.string().trim().min(5).max(400).safeParse(output.premise).success ||
    !z.string().trim().min(2).max(200).safeParse(output.learnerRole).success
  ) {
    return output;
  }

  const firstTitle = outline.pages[0]?.title.slice(0, 80);
  const lastTitle = outline.pages.at(-1)?.title.slice(0, 80);
  if (!firstTitle || !lastTitle) return output;

  return {
    ...output,
    mission: `完成从“${firstTitle}”到“${lastTitle}”的连续学习任务，并达成课程既定目标。`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * none 表示没有虚构角色；模型即使返回占位角色，也由适配层确定性丢弃。
 * light/full 模式仍兼容名称字符串，并在进入领域 Schema 前补齐角色职责。
 */
export function normalizeStoryCharacters(
  narrativeMode: z.infer<typeof NarrativeModeSchema>,
  characters: unknown[],
) {
  if (narrativeMode === "none") return [];

  return characters.map((item) => {
    const parsed = StoryCharacterSchema.safeParse(item);

    if (parsed.success) {
      return parsed.data;
    }

    if (typeof item === "string" && item.trim()) {
      return {
        name: item.trim(),
        role: "连接课程任务并提供简短提示",
      };
    }

    throw new AiSchemaValidationError(
      "Story characters 必须是名称文字或包含 name/role 的对象。",
    );
  });
}
