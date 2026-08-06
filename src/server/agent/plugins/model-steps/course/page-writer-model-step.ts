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
import { findPageWriterSemanticCapacityIssues } from "./page-writer-capacity";
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
import { materializeChoiceQuestions } from "./page-writer-interaction";
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

/** 创建有界 Page Writer 步骤：首稿超出语义预算时只允许一次同阶段重写。 */
export function createPageWriterModelStep(
  dependencies: PageWriterModelStepDependencies = defaultDependencies,
): ModelStep<PageWriterModelStepState> {
  return createModelStep({
    name: "page-writer-model-step",
    isComplete: (state) => Boolean(state.content),
    step: async (state, context, emit) => {
      let content = validatePageWriterOutput(
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

      const capacityIssues = findPageWriterSemanticCapacityIssues(content);
      if (capacityIssues.length > 0) {
        content = validatePageWriterOutput(
          await dependencies.generateContent({
            ...state.task,
            validationFeedback: {
              code: "PAGE_WRITER_CAPACITY_REWRITE",
              issues: [
                ...(state.task.validationFeedback?.issues.slice(0, 6) ?? []),
                ...capacityIssues,
              ].slice(0, 12),
            },
            abortSignal: context.abortSignal,
            traceId: context.traceId,
          }),
          state.task,
        );

        emit({
          type: "model_call",
          summary: "Page Writer 已依据语义容量反馈重写页面内容。",
          data: {
            pageId: content.pageId,
            purpose: "page-content-capacity-rewrite",
            templateId: content.functionalTemplateId,
          },
        });
      }

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
  const issues: string[] = [];

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

  issues.push(...validateContentSubstance(dsl));
  issues.push(...validateLearnerFacingLanguage(dsl, input));

  if (issues.length > 0) {
    throw new AiSchemaValidationError(
      `PageContentDSL 业务校验失败：${issues.join("；")}`,
    );
  }

  return dsl;
}

/**
 * 阻止模型把整页学习内容写成与课程语言不一致的语言。阈值按“多个完整句段”判断，
 * 因此不会因为 API、HTML 等术语或单个双语词汇误拒绝页面。
 */
function validateLearnerFacingLanguage(
  dsl: PageContentDSL,
  input: PageWriterInput,
) {
  const language = input.courseContext?.language ?? input.intent.language;
  if (language === "bilingual" || isTargetLanguageLesson(input, language)) {
    return [];
  }

  const segments = collectLearnerFacingSegments(dsl);
  const dominantSegments = segments.map(classifySegmentLanguage);
  const chineseSegments = dominantSegments.filter(
    (segment) => segment === "zh",
  ).length;
  const englishSegments = dominantSegments.filter(
    (segment) => segment === "en",
  ).length;

  if (
    language === "zh-CN" &&
    englishSegments >= 3 &&
    englishSegments > chineseSegments * 2
  ) {
    return [
      "课程语言为中文，但页面正文以英文为主；所有面向学习者的标题、讲解、题干、选项和反馈必须使用中文",
    ];
  }
  if (
    language === "en-US" &&
    chineseSegments >= 3 &&
    chineseSegments > englishSegments * 2
  ) {
    return [
      "The course language is English, but the page is predominantly Chinese; write learner-facing titles, explanations, questions, options, and feedback in English",
    ];
  }

  return [];
}

function collectLearnerFacingSegments(dsl: PageContentDSL) {
  const segments = [
    dsl.title,
    ...dsl.narration,
    ...dsl.blocks.flatMap((block) => [
      block.label,
      block.heading,
      block.body,
      ...block.supportingPoints,
    ]),
  ];
  const interaction = dsl.interaction;

  switch (interaction.type) {
    case "none":
      break;
    case "navigate":
      segments.push(interaction.actionLabel);
      break;
    case "reveal":
    case "explore":
      segments.push(
        interaction.prompt,
        ...interaction.items.flatMap((item) => [item.label, item.content]),
      );
      break;
    case "choice":
      segments.push(
        ...interaction.questions.flatMap((question) => [
          question.prompt,
          ...question.options.map((option) => option.label),
          question.feedback.success,
          question.feedback.retry,
        ]),
      );
      break;
    case "sort":
      segments.push(
        interaction.prompt,
        ...interaction.items.flatMap((item) => [item.label, item.content]),
        interaction.feedback.success,
        interaction.feedback.retry,
      );
      break;
    case "input":
      segments.push(
        interaction.prompt,
        interaction.placeholder,
        ...interaction.evaluationCriteria,
        interaction.feedback.success,
        interaction.feedback.retry,
      );
      break;
  }

  return segments.filter((segment): segment is string => Boolean(segment));
}

function classifySegmentLanguage(segment: string): "zh" | "en" | "neutral" {
  const hanCount = segment.match(/\p{Script=Han}/gu)?.length ?? 0;
  const latinWords = segment.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? [];
  const latinLetterCount = latinWords.join("").length;

  if (hanCount >= 4 && hanCount > latinLetterCount * 0.5) return "zh";
  if (latinWords.length >= 4 && latinLetterCount > hanCount * 2) return "en";
  return "neutral";
}

function isTargetLanguageLesson(
  input: PageWriterInput,
  language: "zh-CN" | "en-US",
) {
  const intentText = [
    input.intent.topic,
    input.intent.learningGoal,
    ...input.intent.mustInclude,
  ]
    .filter(Boolean)
    .join(" ");

  return language === "zh-CN"
    ? /英语|英文|单词|词汇|语法|口语|听力|翻译|\benglish\b/i.test(intentText)
    : /中文|汉语|普通话|汉字|拼音|\bchinese\b/i.test(intentText);
}

function buildCompactPageWriterBrief(input: PageWriterInput) {
  const context = input.courseContext;
  return {
    course: {
      title: context?.courseTitle ?? input.intent.topic,
      audience: context?.audience ?? input.intent.audienceAgeRange,
      language: context?.language ?? input.intent.language,
      learningGoal: input.intent.learningGoal,
      objectives:
        context?.objectives.map(({ outcome, evidence }) => ({
          outcome,
          evidence,
        })) ?? [input.page.learningObjective],
      tone: context?.courseRules.tone,
      terminology: context?.courseRules.terminology ?? [],
      facts:
        context?.coursePack.facts.map(({ id, text }) => ({ id, text })) ?? [],
      terms:
        context?.coursePack.terms.map(({ term, definition }) => ({
          term,
          definition,
        })) ?? [],
      constraints: context?.coursePack.constraints ?? input.intent.avoid,
    },
    page: {
      id: input.page.id,
      title: input.page.title,
      pageType: input.page.pageType,
      objective: input.page.learningObjective,
      interactionType: input.page.interactionType,
      task: context?.pageTask ?? {
        purpose: input.page.contentSummary,
        teachingPoints: input.intent.mustInclude,
        learnerAction: input.brief.pedagogy.interactionPurpose,
      },
      pedagogy: input.brief.pedagogy,
      visualFocus: input.brief.visual,
      neighbors: context?.neighboringPageTasks ?? [],
      dependencySummaries: context?.dependencySummaries ?? [],
      assetNeeds: input.page.assetNeeds,
    },
  };
}

function inferContentDensity(
  draft: z.infer<typeof PageWriterModelOutputSchema>,
): "sparse" | "balanced" | "dense" {
  const interactionEntries =
    draft.interaction.type === "choice"
      ? draft.interaction.options.length
      : "items" in draft.interaction
        ? draft.interaction.items.length
        : draft.interaction.type === "none"
          ? 0
          : 1;
  const weight =
    draft.narration.length + draft.blocks.length * 2 + interactionEntries;
  return weight <= 4 ? "sparse" : weight <= 9 ? "balanced" : "dense";
}

/** 调用模型生成语义草稿，再由代码补齐所有稳定技术字段。 */
async function generateContent(
  input: PageWriterInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  },
) {
  const prompts = await buildPageWriterPrompts({
    pageBrief: buildCompactPageWriterBrief(input),
    referenceContext: selectPageReferenceContext(input),
    validationFeedback: input.validationFeedback
      ? PageWriterValidationFeedbackSchema.parse(input.validationFeedback)
      : undefined,
  });
  const draft = await generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "page-writer",
    includeSchemaInPrompt: false,
    maxTokens: 3_200,
    prompt: prompts.userPrompt,
    promptFingerprint: prompts.fingerprint,
    schema: PageWriterModelOutputSchema,
    schemaDescription:
      "One page of semantic learning content without HTML or component details.",
    schemaName: "page_content_dsl_content",
    normalizeOutput: normalizePageWriterModelOutput,
    systemPrompt: prompts.systemPrompt,
    temperature: 0.4,
    traceId: input.traceId,
  });
  const blocks = materializeBlocks(draft.blocks);

  if (draft.interaction.type !== input.page.interactionType) {
    throw new AiSchemaValidationError(
      `模型 interaction.type ${draft.interaction.type} 与 PagePlan ${input.page.interactionType} 不一致。`,
    );
  }

  const interaction = materializePageWriterInteraction(
    draft.interaction,
    input.courseContext?.language ?? input.intent.language,
  );
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
      contentDensity: inferContentDensity(draft),
      visualPriority: input.brief.visual.focalPoint,
      groupingStrategy: input.brief.visual.composition,
      readingOrder: blocks.map(({ id }) => id),
    },
    runtime: buildLessonRuntime({
      page: input.page,
      blocks,
      interaction,
    }),
  };

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
  language: "zh-CN" | "en-US" | "bilingual" = "zh-CN",
): PageContentInteraction {
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
        feedback: {
          success: draft.feedbackSuccess,
          retry: draft.feedbackRetry,
        },
      };
    }
    case "input":
      return {
        type: "input",
        prompt: draft.prompt,
        placeholder:
          draft.placeholder ?? defaultInputPlaceholder(language),
        evaluationCriteria: draft.evaluationCriteria,
        feedback: {
          success: draft.feedbackSuccess,
          retry: draft.feedbackRetry,
        },
      };
    case "explore":
      return {
        type: "explore",
        prompt: draft.prompt,
        items: materializeInteractionItems(draft.items),
      };
  }
}

function defaultInputPlaceholder(
  language: "zh-CN" | "en-US" | "bilingual",
) {
  if (language === "en-US") return "Type your answer";
  if (language === "bilingual") return "写下你的回答 / Type your answer";
  return "写下你的回答";
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

/** 兼容现有调用方；容量只触发一次源头重写，不作为最终 DSL 门禁。 */
export function exceedsFixedCanvasCapacity(dsl: PageContentDSL) {
  return findPageWriterSemanticCapacityIssues(dsl).length > 0;
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
