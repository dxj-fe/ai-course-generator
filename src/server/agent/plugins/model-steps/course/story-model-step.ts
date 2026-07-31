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

export const StoryModelOutputSchema = z
  .object({
    narrativeMode: NarrativeModeSchema,
    premise: z.string().min(5).max(400),
    learnerRole: z.string().min(2).max(200),
    mission: z.string().min(5).max(300),
    characters: z.array(StoryCharacterSchema).max(6),
    pageBeats: z
      .array(
        z
          .object({
            beat: z.string().min(2).max(300),
            transition: z.string().min(2).max(240),
          })
          .strict(),
      )
      .min(1),
    tone: z.string().min(2).max(160),
    continuityRules: z.array(z.string().min(2).max(240)).min(1).max(10),
  })
  .strict();

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
    prompt: prompts.userPrompt,
    promptFingerprint: prompts.fingerprint,
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
