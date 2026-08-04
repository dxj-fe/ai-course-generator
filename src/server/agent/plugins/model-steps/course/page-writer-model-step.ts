import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/infra/ai/client";
import { AiSchemaValidationError } from "@/server/infra/ai/error";
import { buildPageWriterPrompts } from "@/server/agent/plugins/prompts/course/model-steps/page-writer";
import type { LoadedLocalResource } from "@/server/agent/skill";
import {
  PageContentDSLSchema,
  validateReferenceUsages,
  type CourseIntent,
  type CourseBlueprint,
  type CourseCreationBrief,
  type CoursePack,
  type PageContentDSL,
  type PageContentInteraction,
  type PagePlan,
  type PageSummary,
  type PageTask,
  type PageWorkerBrief,
  type ReferencePack,
} from "@/shared/course-schema";
import {
  getFunctionalTemplate,
} from "@/shared/templates/functional";

import {
  ACHIEVEMENT_VISUAL_INPUT_LIMITS,
  RENDERED_VISUAL_FIXED_CANVAS_LIMITS,
  STORY_INTRO_VISUAL_CHOICE_LIMITS,
} from "./page-writer-capacity";
import {
  PageWriterInteractionDraftSchema,
  PageWriterInteractionItemDraftSchema,
  PageWriterModelOutputSchema,
  normalizePageWriterModelOutput,
} from "./page-writer-schema";
import {
  buildLessonRuntime,
  selectPageReferenceContext,
} from "./page-writer-runtime";
import {
  materializeChoiceQuestions,
  validateTemplateSlots,
} from "./page-writer-interaction";
import { createModelStep } from "./model-step";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepStateBase,
} from "./types";

export { PageWriterNarrationDraftSchema } from "./page-writer-schema";
export { buildLessonRuntime } from "./page-writer-runtime";

export const PageWriterValidationFeedbackSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    issues: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  })
  .strict();

export type PageWriterValidationFeedback = z.infer<
  typeof PageWriterValidationFeedbackSchema
>;

export type PageWriterCourseContext = {
  creationBrief: CourseCreationBrief;
  courseTitle: string;
  audience: CourseBlueprint["audience"];
  language: CourseBlueprint["language"];
  objectives: CourseBlueprint["objectives"];
  courseRules: CourseBlueprint["courseRules"];
  coursePack: CoursePack;
  pageTask: PageTask;
  neighboringPageTasks: Array<
    Pick<
      PageTask,
      | "pageId"
      | "order"
      | "title"
      | "purpose"
      | "objectiveIds"
      | "learnerAction"
    >
  >;
  dependencySummaries: PageSummary[];
  pageDesignGuidance?: LoadedLocalResource[];
};

export type PageWriterInput = {
  intent: CourseIntent;
  page: PagePlan;
  brief: PageWorkerBrief;
  courseContext?: PageWriterCourseContext;
  referencePacks?: ReferencePack[];
  validationFeedback?: PageWriterValidationFeedback;
};

export type PageWriterModelStepState = ModelStepStateBase & {
  task: PageWriterInput;
  content?: PageContentDSL;
};

export type PageWriterModelStepDependencies = {
  generateContent(input: PageWriterInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: PageWriterModelStepDependencies = {
  generateContent,
};

/** 创建只负责一次页面内容 DSL 生成的模型步骤，不承担编排或自主决策。 */
export function createPageWriterModelStep(
  dependencies: PageWriterModelStepDependencies = defaultDependencies,
): ModelStep<PageWriterModelStepState> {
  return createModelStep({
    name: "page-writer-model-step",
    isComplete: (state) => Boolean(state.content),
    step: async (state, context, emit) => {
      const content = validatePageWriterOutput(
        await dependencies.generateContent({
          ...state.task,
          abortSignal: context.abortSignal,
          traceId: context.traceId,
        }),
        state.task,
      );

      emit({
        type: "model_call",
        summary: `Page Writer 已生成 ${content.blocks.length} 个内容块。`,
        data: {
          pageId: content.pageId,
          purpose: "page-content-writing",
          templateId: content.functionalTemplateId,
        },
      });

      return { ...state, content };
    },
  });
}

/** 创建 Page Writer 模型步骤的可序列化初始状态。 */
export function createPageWriterModelStepState(
  input: PageWriterInput,
): PageWriterModelStepState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

/** 使用默认模型依赖运行一次 Page Writer 模型步骤。 */
export function runPageWriterModelStep(
  input: PageWriterInput,
  context: ModelStepContext,
) {
  return createPageWriterModelStep().run(
    createPageWriterModelStepState(input),
    context,
  );
}

/** 校验技术引用、模板槽位和 PagePlan/brief/DSL 之间的业务一致性。 */
export function validatePageWriterOutput(
  output: unknown,
  input: PageWriterInput,
): PageContentDSL {
  const parsed = PageContentDSLSchema.safeParse(output);

  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `PageContentDSL 结构校验失败：${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const dsl = parsed.data;
  const template = getFunctionalTemplate(input.page.functionalTemplateId);
  const issues: string[] = [];

  if (!template) {
    issues.push(`找不到功能模板 ${input.page.functionalTemplateId}`);
  } else if (template.pageType !== input.page.pageType) {
    issues.push(`功能模板 ${template.id} 与 pageType ${input.page.pageType} 不匹配`);
  }

  if (
    input.brief.pageId !== input.page.id ||
    input.brief.pedagogy.pageId !== input.page.id ||
    input.brief.story.pageId !== input.page.id ||
    input.brief.visual.pageId !== input.page.id
  ) {
    issues.push("PageWorkerBrief 必须完整引用当前 pageId");
  }

  if (dsl.pageId !== input.page.id) {
    issues.push(`DSL pageId 必须是 ${input.page.id}`);
  }

  if (dsl.functionalTemplateId !== input.page.functionalTemplateId) {
    issues.push(`DSL functionalTemplateId 必须是 ${input.page.functionalTemplateId}`);
  }

  if (dsl.title !== input.page.title) {
    issues.push("DSL title 必须复用 PagePlan.title");
  }

  if (dsl.interaction.type !== input.page.interactionType) {
    issues.push(
      `DSL interaction.type ${dsl.interaction.type} 与 PagePlan ${input.page.interactionType} 不一致`,
    );
  }
  if (
    dsl.interaction.type === "choice" &&
    dsl.interaction.questions.length !== 1
  ) {
    issues.push(
      "固定课程画布中的 choice 页面必须且只能包含 1 道完整题目",
    );
  }
  if (input.page.pageType === "quiz" && dsl.blocks.length !== 1) {
    issues.push(
      "固定课程画布中的 quiz 页面必须且只能包含 1 个题目内容块",
    );
  }

  issues.push(
    ...validateReferenceUsages(
      dsl.usedReferences ?? [],
      input.referencePacks ?? [],
    ),
  );
  const plannedByPack = new Map(
    (input.page.usedReferences ?? []).map((usage) => [
      usage.referencePackId,
      new Set(usage.chunkIds),
    ]),
  );
  for (const usage of dsl.usedReferences ?? []) {
    const allowedChunks = plannedByPack.get(usage.referencePackId);
    if (
      !allowedChunks ||
      usage.chunkIds.some((chunkId) => !allowedChunks.has(chunkId))
    ) {
      issues.push("Page Writer 的资料引用必须是 PagePlan 引用的子集");
    }
  }

  if (dsl.assetSlots.length !== input.page.assetNeeds.length) {
    issues.push("DSL assetSlots 必须逐项对应 PagePlan.assetNeeds");
  } else {
    dsl.assetSlots.forEach((slot, index) => {
      const need = input.page.assetNeeds[index];

      if (
        slot.type !== need.type ||
        slot.role !== need.role ||
        slot.purpose !== need.purpose ||
        slot.required !== need.required
      ) {
        issues.push(`assetSlots.${index} 与 PagePlan.assetNeeds 不一致`);
      }
    });
  }

  if (template) {
    issues.push(...validateTemplateSlots(dsl, template));
  }
  issues.push(...validateContentSubstance(dsl));

  if (issues.length > 0) {
    throw new AiSchemaValidationError(
      `PageContentDSL 业务校验失败：${issues.join("；")}`,
    );
  }

  return dsl;
}

/** 调用模型生成语义草稿，再由代码补齐所有稳定技术字段。 */
async function generateContent(
  input: PageWriterInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  },
) {
  const template = getFunctionalTemplate(input.page.functionalTemplateId);

  if (!template) {
    throw new AiSchemaValidationError(
      `Page Writer 找不到功能模板 ${input.page.functionalTemplateId}。`,
    );
  }

  const prompts = await buildPageWriterPrompts({
    courseIntent: input.intent,
    courseArchitectureContext: input.courseContext ?? null,
    pagePlan: input.page,
    pageWorkerBrief: input.brief,
    functionalTemplate: template,
    referenceContext: selectPageReferenceContext(input),
    validationFeedback: input.validationFeedback
      ? PageWriterValidationFeedbackSchema.parse(input.validationFeedback)
      : undefined,
  });
  const draft = await generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "page-writer",
    includeSchemaInPrompt: true,
    maxTokens: 4_000,
    prompt: prompts.userPrompt,
    promptFingerprint: prompts.fingerprint,
    schema: PageWriterModelOutputSchema,
    schemaDescription:
      "One page of semantic learning content without HTML or component details.",
    schemaName: "page_content_dsl_content",
    normalizeOutput: normalizePageWriterModelOutput,
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    traceId: input.traceId,
  });
  const blocks = materializeBlocks(draft.blocks);

  if (draft.interaction.type !== input.page.interactionType) {
    throw new AiSchemaValidationError(
      `模型 interaction.type ${draft.interaction.type} 与 PagePlan ${input.page.interactionType} 不一致。`,
    );
  }

  const interaction = materializePageWriterInteraction(draft.interaction);
  const candidate: PageContentDSL = {
    pageId: input.page.id,
    functionalTemplateId: input.page.functionalTemplateId,
    title: input.page.title,
    narration: draft.narration,
    blocks,
    interaction,
    usedReferences: draft.usedReferences,
    assetSlots: input.page.assetNeeds.map((need, index) => ({
      id: `asset-slot-${String(index + 1).padStart(2, "0")}`,
      ...need,
      altTextGuidance:
        need.role === "decorative"
          ? "装饰性素材不传达信息，最终使用空 alt 文本。"
          : `${need.purpose.replace(/[。.!！?？]+$/u, "")}。`,
    })),
    layoutHints: {
      contentDensity: draft.contentDensity,
      visualPriority: draft.visualPriority,
      groupingStrategy: draft.groupingStrategy,
      readingOrder: blocks.map(({ id }) => id),
    },
    runtime: buildLessonRuntime({
      page: input.page,
      blocks,
      interaction,
    }),
  };

  // 静态容量只能提示渲染密度，不能替代真实浏览器证据拒绝教学所需内容。
  if (exceedsFixedCanvasCapacity(candidate)) {
    candidate.layoutHints.contentDensity = "dense";
  }

  return validatePageWriterOutput(candidate, input);
}

/** 为模型内容块补齐稳定 blockId。 */
function materializeBlocks(
  items: z.infer<typeof PageWriterModelOutputSchema>["blocks"],
) {
  return items.map((item, index) => {
    const id = `block-${String(index + 1).padStart(2, "0")}`;

    return {
      id,
      ...item,
      body: normalizeMultilineBulletBody(item.body),
    };
  });
}

/** 将正文中的多行清单转换为适合 HTML 精确复现的一句话。 */
export function normalizeMultilineBulletBody(body: string) {
  const lines = body
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const bulletPattern = /^(?:✅|☑️?|✔️?|✓|•|[-*])\s*/u;
  if (
    lines.length < 2 ||
    lines.some((line) => !bulletPattern.test(line))
  ) {
    return body;
  }

  return lines
    .map((line) => line.replace(bulletPattern, "").trim())
    .filter(Boolean)
    .join("；");
}

/** 根据 interaction.type 投影当前领域协议所需字段。 */
export function materializePageWriterInteraction(
  draft: z.infer<typeof PageWriterInteractionDraftSchema>,
): PageContentInteraction {
  const feedback = {
    success: draft.feedbackSuccess[0] ?? "回答正确。",
    retry: draft.feedbackRetry[0] ?? "请根据页面内容再试一次。",
  };

  switch (draft.type) {
    case "none":
      return { type: "none" };
    case "navigate":
      return {
        type: "navigate",
        actionLabel: draft.actionLabel,
        destination: draft.destination,
      };
    case "reveal":
      return {
        type: "reveal",
        prompt: draft.prompt,
        items: materializeInteractionItems(draft.items),
      };
    case "choice": {
      return {
        type: "choice",
        questions: materializeChoiceQuestions(draft),
      };
    }
    case "sort": {
      const items = materializeInteractionItems(draft.items);

      return {
        type: "sort",
        prompt: draft.prompt,
        items,
        correctOrderIds: items.map(({ id }) => id),
        feedback,
      };
    }
    case "input":
      return {
        type: "input",
        prompt: draft.prompt,
        placeholder: draft.placeholder,
        evaluationCriteria: draft.evaluationCriteria,
        feedback,
      };
    case "explore":
      return {
        type: "explore",
        prompt: draft.prompt,
        items: materializeInteractionItems(draft.items),
      };
  }
}

/** 为互动项补齐可被 QA 定位的稳定 ID。 */
export function materializeInteractionItems(
  items: Array<z.infer<typeof PageWriterInteractionItemDraftSchema>>,
) {
  return items.map((item, index) => {
    return {
      id: `item-${String(index + 1).padStart(2, "0")}`,
      label: item.label.trim(),
      content: item.content.trim(),
    };
  });
}

/**
 * 阻止结构合法但教学信息几乎为空的页面进入 HTML 阶段。
 * 这里只检查可确定识别的低质量模式，事实正确性仍交给 QA。
 */
function validateContentSubstance(dsl: PageContentDSL) {
  const issues: string[] = [];

  dsl.narration.forEach((line, index) => {
    if (semanticTextLength(line) < 10) {
      issues.push(`narration.${index} 过短，必须说明本页任务或认知推进`);
    }
  });

  dsl.blocks.forEach((block, index) => {
    const minimumLength = ["instruction", "question"].includes(block.kind)
      ? 8
      : 12;

    if (semanticTextLength(block.body) < minimumLength) {
      issues.push(
        `blocks.${index}.body 信息不足，必须使用完整解释而不是词组`,
      );
    }
    if (
      normalizeComparableText(block.body) ===
      normalizeComparableText(block.heading)
    ) {
      issues.push(`blocks.${index}.body 不能只重复 heading`);
    }
  });

  if (dsl.interaction.type === "reveal" || dsl.interaction.type === "explore") {
    dsl.interaction.items.forEach((item, index) => {
      if (
        normalizeComparableText(item.content) ===
        normalizeComparableText(item.label)
      ) {
        issues.push(
          `interaction.items.${index}.content 必须解释标签，不能只重复 label`,
        );
      }
    });
  }

  for (const [path, message] of interactionFeedback(dsl.interaction)) {
    if (semanticTextLength(message) < 8 || isGenericFeedback(message)) {
      issues.push(feedbackSubstanceIssue(dsl.interaction, path));
    }
  }

  return issues;
}

function feedbackSubstanceIssue(
  interaction: PageContentInteraction,
  path: string,
) {
  if (interaction.type === "input") {
    const criteria = interaction.evaluationCriteria
      .map((criterion) => `“${criterion}”`)
      .join("、");
    return path.endsWith(".success")
      ? `${path} 必须点名已满足的 evaluationCriteria，并说明回答中用于判断的可观察内容；当前评价标准：${criteria}`
      : `${path} 必须点名尚未满足的 evaluationCriteria，并说明应补充的事实、证据、步骤或理由；当前评价标准：${criteria}`;
  }

  if (interaction.type === "sort") {
    return path.endsWith(".success")
      ? `${path} 必须说明该顺序成立的先后关系依据`
      : `${path} 必须指出需要重新检查的具体先后关系`;
  }

  return path.endsWith(".success")
    ? `${path} 必须把正确答案连接到本页的具体判断依据`
    : `${path} 必须给出重新判断所需的具体观察线索或改进方法`;
}

/**
 * 最窄课程画布需要同时容纳必需插图、正文与真实互动。FunctionalTemplate
 * 的槽位上限描述语义能力，不等于在 366×500 固定画布中可同时完整展示的
 * 数量；这里先处理两种高成本任务，再用统一预算兜住其他必需插图页面。
 */
export function exceedsFixedCanvasCapacity(dsl: PageContentDSL) {
  if (dsl.assetSlots.length === 0) return false;

  const supportingPointCount = dsl.blocks.reduce(
    (total, block) => total + block.supportingPoints.length,
    0,
  );

  if (
    dsl.functionalTemplateId === "story-intro" &&
    dsl.interaction.type === "choice"
  ) {
    const question = dsl.interaction.questions[0];
    return (
      dsl.narration.length > STORY_INTRO_VISUAL_CHOICE_LIMITS.narration ||
      dsl.blocks.length > STORY_INTRO_VISUAL_CHOICE_LIMITS.blocks ||
      supportingPointCount >
        STORY_INTRO_VISUAL_CHOICE_LIMITS.supportingPoints ||
      (question?.options.length ?? 0) >
        STORY_INTRO_VISUAL_CHOICE_LIMITS.options
    );
  }

  if (
    dsl.functionalTemplateId === "achievement-task" &&
    dsl.interaction.type === "input"
  ) {
    return (
      dsl.narration.length > ACHIEVEMENT_VISUAL_INPUT_LIMITS.narration ||
      dsl.blocks.length > ACHIEVEMENT_VISUAL_INPUT_LIMITS.blocks ||
      supportingPointCount >
        ACHIEVEMENT_VISUAL_INPUT_LIMITS.supportingPoints ||
      dsl.interaction.evaluationCriteria.length >
        ACHIEVEMENT_VISUAL_INPUT_LIMITS.evaluationCriteria
    );
  }

  return (
    dsl.narration.length > RENDERED_VISUAL_FIXED_CANVAS_LIMITS.narration ||
    dsl.blocks.length > RENDERED_VISUAL_FIXED_CANVAS_LIMITS.blocks ||
    supportingPointCount >
      RENDERED_VISUAL_FIXED_CANVAS_LIMITS.supportingPoints ||
    fixedCanvasInteractionEntryCount(dsl.interaction) >
      RENDERED_VISUAL_FIXED_CANVAS_LIMITS.interactionEntries
  );
}

function fixedCanvasInteractionEntryCount(
  interaction: PageContentInteraction,
) {
  switch (interaction.type) {
    case "choice":
      return interaction.questions[0]?.options.length ?? 0;
    case "reveal":
    case "explore":
    case "sort":
      return interaction.items.length;
    case "input":
      return interaction.evaluationCriteria.length;
    case "navigate":
      return 1;
    case "none":
      return 0;
  }
}


function interactionFeedback(
  interaction: PageContentInteraction,
): Array<[path: string, message: string]> {
  switch (interaction.type) {
    case "choice":
      return interaction.questions.flatMap((question, index) => [
        [
          `interaction.questions.${index}.feedback.success`,
          question.feedback.success,
        ],
        [
          `interaction.questions.${index}.feedback.retry`,
          question.feedback.retry,
        ],
      ]);
    case "sort":
    case "input":
      return [
        ["interaction.feedback.success", interaction.feedback.success],
        ["interaction.feedback.retry", interaction.feedback.retry],
      ];
    default:
      return [];
  }
}

function semanticTextLength(value: string) {
  return value.replace(/[\s\p{P}\p{S}]/gu, "").length;
}

function normalizeComparableText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .toLocaleLowerCase();
}

function isGenericFeedback(value: string) {
  return /^(?:(?:回答|作答)?(?:正确|错误)|完成得很好|太棒了|很好|再试一次|请重试|请再试一次)[哦呀吧啊]*$/u.test(
    normalizeComparableText(value),
  );
}
