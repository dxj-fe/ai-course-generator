import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import { buildPageWriterPrompts } from "@/server/prompts/page-writer";
import {
  PageContentBlockKindSchema,
  PageContentDSLSchema,
  PageInteractionTypeSchema,
  ReferenceUsageSchema,
  validateReferenceUsages,
  type CourseIntent,
  type PageContentDSL,
  type PageContentInteraction,
  type PagePlan,
  type PageWorkerBrief,
  type ReferencePack,
} from "@/shared/course-schema";
import {
  getFunctionalTemplate,
  type FunctionalTemplate,
} from "@/shared/templates/functional";

import { createMinimalAgent } from "./core/minimal-agent";
import type {
  Agent,
  AgentRuntimeContext,
  AgentStateBase,
} from "./core/types";

const PageWriterBlockDraftSchema = z.object({
  kind: PageContentBlockKindSchema,
  label: z.string().min(1).max(80).optional(),
  heading: z.string().min(1).max(120),
  body: z.string().min(2).max(800),
  supportingPoints: z.array(z.string().min(2).max(240)).max(8),
});

const PageWriterInteractionDraftSchema = z.object({
  type: PageInteractionTypeSchema,
  prompt: z.string().max(500),
  items: z.array(z.string().min(1).max(500)).max(8),
  choicePrompts: z.array(z.string().min(2).max(500)).max(8),
  choiceOptions: z.array(z.string().min(1).max(240)).max(48),
  choiceOptionCounts: z.array(z.number().int().min(2).max(6)).max(8),
  correctOptionIndexes: z.array(z.number().int().min(0).max(5)).max(8),
  feedbackSuccess: z.array(z.string().min(2).max(300)).max(8),
  feedbackRetry: z.array(z.string().min(2).max(300)).max(8),
  maxAttempts: z.number().int().min(1).max(5),
  placeholder: z.string().max(160),
  evaluationCriteria: z.array(z.string().min(2).max(240)).max(6),
  actionLabel: z.string().max(80),
  // 对非 navigate 互动这是无意义占位字段，先兼容模型别名，再在适配层收敛。
  destination: z.string().trim().max(80),
});

const PageWriterModelOutputSchema = z.object({
  narration: z.array(z.string().min(2).max(500)).max(3),
  // 兼容部分模型把简单对象数组压缩为字符串数组；领域 Schema 仍保持严格。
  blocks: z.array(z.unknown()).max(12),
  interaction: PageWriterInteractionDraftSchema,
  // 模型可能使用 medium、紧凑等同义标签；适配层会收敛为领域枚举。
  contentDensity: z.string().trim().min(1).max(40),
  visualPriority: z.string().min(2).max(240),
  groupingStrategy: z.string().min(2).max(240),
  usedReferences: z.array(ReferenceUsageSchema).max(12).default([]),
});

export type PageWriterInput = {
  intent: CourseIntent;
  page: PagePlan;
  brief: PageWorkerBrief;
  referencePacks?: ReferencePack[];
};

export type PageWriterAgentState = AgentStateBase & {
  task: PageWriterInput;
  content?: PageContentDSL;
};

export type PageWriterAgentDependencies = {
  generateContent(input: PageWriterInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: PageWriterAgentDependencies = {
  generateContent,
};

/** 创建只负责一个页面内容 DSL 的一步 PageWriterAgent。 */
export function createPageWriterAgent(
  dependencies: PageWriterAgentDependencies = defaultDependencies,
): Agent<PageWriterAgentState> {
  return createMinimalAgent({
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

/** 创建 PageWriterAgent 的可序列化初始状态。 */
export function createPageWriterAgentState(
  input: PageWriterInput,
): PageWriterAgentState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

/** 使用默认模型依赖运行单页 PageWriterAgent。 */
export function runPageWriterAgent(
  input: PageWriterInput,
  context: AgentRuntimeContext,
) {
  return createPageWriterAgent().run(createPageWriterAgentState(input), context);
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
    pagePlan: input.page,
    pageWorkerBrief: input.brief,
    functionalTemplate: template,
    referenceContext: selectPageReferenceContext(input),
  });
  const draft = await generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    maxTokens: 4_000,
    normalizeOutput: normalizePageWriterModelOutput,
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: PageWriterModelOutputSchema,
    schemaDescription:
      "One page of semantic learning content without HTML or component details.",
    schemaName: "page_content_dsl_content",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    traceId: input.traceId,
  });
  const blocks = normalizeBlocks(draft.blocks);

  if (draft.interaction.type !== input.page.interactionType) {
    throw new AiSchemaValidationError(
      `模型 interaction.type ${draft.interaction.type} 与 PagePlan ${input.page.interactionType} 不一致。`,
    );
  }

  return validatePageWriterOutput(
    {
      version: 1,
      pageId: input.page.id,
      functionalTemplateId: input.page.functionalTemplateId,
      title: input.page.title,
      narration: draft.narration,
      blocks,
      interaction: materializeInteraction(draft.interaction),
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
        contentDensity: normalizePageContentDensity(
          draft.contentDensity,
          input.page.pageType,
        ),
        visualPriority: draft.visualPriority,
        groupingStrategy: draft.groupingStrategy,
        readingOrder: blocks.map(({ id }) => id),
      },
    },
    input,
  );
}

/**
 * 只收敛 JSON object mode 常见的多余数组层级和 choice 占位字段。
 * 未知对象、混合类型和真实业务字段仍交给严格 Schema 拒绝。
 */
export function normalizePageWriterModelOutput(output: unknown): unknown {
  if (!isRecord(output) || !isRecord(output.interaction)) return output;

  const interaction = output.interaction;
  if (interaction.type !== "choice") return output;

  return {
    ...output,
    interaction: {
      ...interaction,
      // choice 不使用 items；部分 Provider 会把空数组错误压缩成 0。
      items: [],
      choiceOptions: flattenNestedStringArray(interaction.choiceOptions),
    },
  };
}

function flattenNestedStringArray(value: unknown): unknown {
  if (
    !Array.isArray(value) ||
    !value.some(Array.isArray) ||
    !value.every(
      (item) =>
        typeof item === "string" ||
        (Array.isArray(item) && item.every((part) => typeof part === "string")),
    )
  ) {
    return value;
  }

  return value.flatMap((item) => (Array.isArray(item) ? item : [item]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const contentDensityAliases: Readonly<
  Record<string, PageContentDSL["layoutHints"]["contentDensity"]>
> = {
  sparse: "sparse",
  low: "sparse",
  light: "sparse",
  minimal: "sparse",
  airy: "sparse",
  spacious: "sparse",
  lowdensity: "sparse",
  稀疏: "sparse",
  简洁: "sparse",
  极简: "sparse",
  低密度: "sparse",
  balanced: "balanced",
  medium: "balanced",
  moderate: "balanced",
  normal: "balanced",
  standard: "balanced",
  comfortable: "balanced",
  mediumdensity: "balanced",
  平衡: "balanced",
  均衡: "balanced",
  适中: "balanced",
  中等: "balanced",
  dense: "dense",
  high: "dense",
  compact: "dense",
  highdensity: "dense",
  密集: "dense",
  紧凑: "dense",
  高密度: "dense",
};

/** 将模型使用的内容密度别名收敛为严格 PageContentDSL 枚举。 */
export function normalizePageContentDensity(
  value: string,
  pageType: PagePlan["pageType"],
): PageContentDSL["layoutHints"]["contentDensity"] {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliased = contentDensityAliases[normalized];

  if (aliased) {
    return aliased;
  }

  return pageType === "cover" || pageType === "quiz"
    ? "sparse"
    : "balanced";
}

/** 将模型的导航别名或非导航占位值收敛为稳定协议值。 */
export function normalizePageNavigationDestination(
  value: string,
): Extract<PageContentInteraction, { type: "navigate" }>["destination"] {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "");

  if (normalized === "previous" || normalized === "previouspage") {
    return "previous";
  }

  if (normalized === "coursehome" || normalized === "home") {
    return "course-home";
  }

  return "next";
}

/** 将兼容层草稿收敛为带稳定 blockId 的严格内容块。 */
function normalizeBlocks(items: unknown[]) {
  return items.map((item, index) => {
    const parsed = PageWriterBlockDraftSchema.safeParse(item);
    const id = `block-${String(index + 1).padStart(2, "0")}`;

    if (parsed.success) {
      return { id, ...parsed.data };
    }

    if (typeof item === "string" && item.trim().length >= 2) {
      return {
        id,
        kind: "fact" as const,
        heading: `内容要点 ${index + 1}`,
        body: item.trim(),
        supportingPoints: [],
      };
    }

    throw new AiSchemaValidationError(
      `Page Writer blocks.${index} 不是有效内容块。`,
    );
  });
}

/** 根据 interaction.type 投影必要字段，丢弃兼容草稿中的占位字段。 */
function materializeInteraction(
  draft: z.infer<typeof PageWriterInteractionDraftSchema>,
): PageContentInteraction {
  const prompt = usable(draft.prompt, "请完成本页互动。");
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
        actionLabel: usable(draft.actionLabel, "继续"),
        destination: normalizePageNavigationDestination(draft.destination),
      };
    case "reveal":
      return {
        type: "reveal",
        prompt,
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
        prompt,
        items,
        correctOrderIds: items.map(({ id }) => id),
        feedback,
      };
    }
    case "input":
      return {
        type: "input",
        prompt,
        placeholder: usable(draft.placeholder, "请输入你的答案"),
        evaluationCriteria: draft.evaluationCriteria,
        feedback,
      };
    case "explore":
      return {
        type: "explore",
        prompt,
        items: materializeInteractionItems(draft.items),
      };
  }
}

/** 把模型返回的简洁文字列表转换为可被 QA 定位的互动项。 */
export function materializeInteractionItems(items: string[]) {
  return items.map((content, index) => {
    const normalized = content.trim();
    const label =
      normalized.length <= 80
        ? normalized
        : `${normalized.slice(0, 79).trimEnd()}…`;

    return {
      id: `item-${String(index + 1).padStart(2, "0")}`,
      label,
      content: normalized,
    };
  });
}

/** 将扁平的选择题并行数组转换为多道严格 question 协议。 */
function materializeChoiceQuestions(
  draft: z.infer<typeof PageWriterInteractionDraftSchema>,
) {
  const questionCount = draft.choicePrompts.length;

  if (
    questionCount === 0 ||
    draft.choiceOptionCounts.length !== questionCount ||
    draft.correctOptionIndexes.length !== questionCount ||
    draft.feedbackSuccess.length !== questionCount ||
    draft.feedbackRetry.length !== questionCount ||
    draft.choiceOptionCounts.reduce((total, count) => total + count, 0) !==
      draft.choiceOptions.length
  ) {
    throw new AiSchemaValidationError(
      "choice 的 prompts、optionCounts、correctIndexes 和 feedback 数量必须一致。",
    );
  }

  let optionOffset = 0;

  return draft.choicePrompts.map((prompt, questionIndex) => {
    const optionCount = draft.choiceOptionCounts[questionIndex];
    const correctIndex = draft.correctOptionIndexes[questionIndex];
    const labels = draft.choiceOptions.slice(
      optionOffset,
      optionOffset + optionCount,
    );
    optionOffset += optionCount;

    if (correctIndex >= labels.length) {
      throw new AiSchemaValidationError(
        `choice question ${questionIndex + 1} 的正确选项位置越界。`,
      );
    }

    const questionNumber = String(questionIndex + 1).padStart(2, "0");
    const options = labels.map((label, optionIndex) => ({
      id: `option-${questionNumber}-${String(optionIndex + 1).padStart(2, "0")}`,
      label,
    }));

    return {
      id: `question-${questionNumber}`,
      prompt,
      options,
      correctOptionId: options[correctIndex]?.id ?? "",
      feedback: {
        success: draft.feedbackSuccess[questionIndex],
        retry: draft.feedbackRetry[questionIndex],
      },
      maxAttempts: draft.maxAttempts,
    };
  });
}

/** 按 FunctionalTemplate 的声明校验每个语义槽位是否越界。 */
function validateTemplateSlots(
  dsl: PageContentDSL,
  template: FunctionalTemplate,
) {
  const counts = {
    title: dsl.title ? 1 : 0,
    narration: dsl.narration.length,
    blocks: dsl.blocks.length,
    interaction: getInteractionItemCount(dsl.interaction),
    assetSlots: dsl.assetSlots.length,
  };
  const issues: string[] = [];

  for (const [name, count] of Object.entries(counts)) {
    const slot = template.slots.find((candidate) => candidate.name === name);

    if (!slot && count > 0) {
      issues.push(`${name} 未在模板中声明，数量必须为 0`);
    } else if (slot && (count < slot.minItems || count > slot.maxItems)) {
      issues.push(
        `${name} 数量 ${count} 不在模板范围 ${slot.minItems}-${slot.maxItems}`,
      );
    }
  }

  return issues;
}

/** 将不同互动协议投影为 FunctionalTemplate 使用的槽位数量。 */
function getInteractionItemCount(interaction: PageContentInteraction) {
  switch (interaction.type) {
    case "none":
      return 0;
    case "choice":
      return interaction.questions.length;
    case "reveal":
    case "explore":
      return interaction.items.length;
    default:
      return 1;
  }
}

/** 将兼容输出中的占位文本替换为稳定默认语义。 */
function usable(value: string, fallback: string) {
  const normalized = value.trim();

  return !normalized || normalized === "未使用" ? fallback : normalized;
}

function selectPageReferenceContext(input: PageWriterInput) {
  const packsById = new Map(
    (input.referencePacks ?? []).map((pack) => [pack.id, pack]),
  );

  return (input.page.usedReferences ?? []).flatMap((usage) => {
    const pack = packsById.get(usage.referencePackId);
    if (!pack) return [];
    const allowedChunkIds = new Set(usage.chunkIds);
    return [
      {
        id: pack.id,
        sourceName: pack.sourceName,
        summary: pack.summary,
        keyFacts: pack.keyFacts.filter((fact) =>
          fact.chunkIds.some((chunkId) => allowedChunkIds.has(chunkId)),
        ),
        chunks: pack.chunks.filter(({ id }) => allowedChunkIds.has(id)),
      },
    ];
  });
}
