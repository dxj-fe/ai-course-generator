import type { UIMessage } from "ai";

import { generateTextSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import { buildHtmlEngineerPrompts } from "@/server/prompts/html-engineer";
import {
  HtmlOutputSchema,
  type AssetGenerationResult,
  type HtmlOutput,
  type PageContentDSL,
  type VisualBrief,
  type VisualPageGuidance,
} from "@/shared/course-schema";
import {
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";
import {
  getFunctionalTemplate,
  type FunctionalTemplate,
} from "@/shared/templates/functional";
import {
  getStyleTemplate,
  type StyleTemplate,
} from "@/shared/templates/style";

import { createMinimalAgent } from "./core/minimal-agent";
import type {
  Agent,
  AgentRuntimeContext,
  AgentStateBase,
} from "./core/types";

const MAX_GENERATED_HTML_LENGTH = 200_000;

export type HtmlEngineerInput = {
  content: PageContentDSL;
  visualBrief: VisualBrief;
  assets?: AssetGenerationResult[];
};

export type HtmlEngineerResolvedInput = HtmlEngineerInput & {
  functionalTemplate: FunctionalTemplate;
  pageGuidance: VisualPageGuidance;
  styleTemplate: StyleTemplate;
};

export type HtmlEngineerValidation = {
  contract: ReturnType<typeof validateGeneratedHtmlContract>;
  safety: ReturnType<typeof sanitizeHtmlLite>;
};

export type HtmlEngineerAgentState = AgentStateBase & {
  task: HtmlEngineerInput;
  htmlOutput?: HtmlOutput;
  validation?: HtmlEngineerValidation;
};

export type HtmlEngineerAgentDependencies = {
  generateHtml(
    input: HtmlEngineerResolvedInput & {
      abortSignal?: AbortSignal;
      traceId: string;
    },
  ): Promise<unknown>;
};

const defaultDependencies: HtmlEngineerAgentDependencies = {
  generateHtml,
};

/** 创建只负责把一个 PageContentDSL 实现为静态 HTML 的一步 Agent。 */
export function createHtmlEngineerAgent(
  dependencies: HtmlEngineerAgentDependencies = defaultDependencies,
): Agent<HtmlEngineerAgentState> {
  return createMinimalAgent({
    isComplete: (state) => Boolean(state.htmlOutput),
    step: async (state, context, emit) => {
      const resolved = resolveHtmlEngineerInput(state.task);
      const generated = await dependencies.generateHtml({
        ...resolved,
        abortSignal: context.abortSignal,
        traceId: context.traceId,
      });

      emit({
        type: "model_call",
        summary: "HTML Engineer 已返回单页 HTML 文档。",
        data: {
          pageId: state.task.content.pageId,
          purpose: "page-html-generation",
          styleTemplateId: resolved.styleTemplate.id,
        },
      });

      const { html, validation } = validateHtmlEngineerOutput(
        generated,
        state.task,
      );
      const htmlOutput = HtmlOutputSchema.parse({
        html,
        generatedAt: new Date().toISOString(),
        version: 1,
      });

      emit({
        type: "validation",
        summary: "HTML 合同、内容标记与安全预检已通过。",
        data: {
          blockCount: state.task.content.blocks.length,
          pageId: state.task.content.pageId,
          safetyIssueCount: validation.safety.issues.length,
        },
      });

      return { ...state, htmlOutput, validation };
    },
  });
}

/** 创建 HtmlEngineerAgent 的可序列化初始状态。 */
export function createHtmlEngineerAgentState(
  input: HtmlEngineerInput,
): HtmlEngineerAgentState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

/** 使用服务端 Registry 和默认模型依赖生成一个页面的 HTML。 */
export function runHtmlEngineerAgent(
  input: HtmlEngineerInput,
  context: AgentRuntimeContext,
) {
  return createHtmlEngineerAgent().run(
    createHtmlEngineerAgentState(input),
    context,
  );
}

/** 解析唯一允许使用的模板和本页视觉指导，不接受客户端复制模板正文。 */
export function resolveHtmlEngineerInput(
  input: HtmlEngineerInput,
): HtmlEngineerResolvedInput {
  const functionalTemplate = getFunctionalTemplate(
    input.content.functionalTemplateId,
  );
  const styleTemplate = getStyleTemplate(input.visualBrief.styleTemplateId);
  const pageGuidance = input.visualBrief.pageGuidance.find(
    ({ pageId }) => pageId === input.content.pageId,
  );
  const issues: string[] = [];

  if (!functionalTemplate) {
    issues.push(`找不到功能模板 ${input.content.functionalTemplateId}`);
  }
  if (!styleTemplate) {
    issues.push(`找不到样式模板 ${input.visualBrief.styleTemplateId}`);
  }
  if (!pageGuidance) {
    issues.push(`VisualBrief 缺少页面 ${input.content.pageId} 的视觉指导`);
  }

  if (issues.length > 0 || !functionalTemplate || !styleTemplate || !pageGuidance) {
    throw new AiSchemaValidationError(
      `HTML Engineer 输入校验失败：${issues.join("；")}`,
    );
  }

  return {
    ...input,
    assets: input.assets ?? [],
    functionalTemplate,
    styleTemplate,
    pageGuidance,
  };
}

/** 拒绝不完整、不安全或未保留 DSL 稳定定位标记的模型输出。 */
export function validateHtmlEngineerOutput(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string" || output.trim().length === 0) {
    throw new AiSchemaValidationError("HTML Engineer 没有返回 HTML 字符串。");
  }

  const html = output.trim();
  if (html.length > MAX_GENERATED_HTML_LENGTH) {
    throw new AiSchemaValidationError(
      `HTML 文档超过 ${MAX_GENERATED_HTML_LENGTH} 字符上限。`,
    );
  }

  const contract = validateGeneratedHtmlContract(html);
  const safety = sanitizeHtmlLite(html);
  const issues = [
    ...contract.issues.map(({ message }) => message),
    ...safety.issues.map(({ message }) => message),
  ];
  const requiredMarkers = [
    ["data-page-id", input.content.pageId],
    ["data-interaction-type", input.content.interaction.type],
    ...input.content.blocks.map(({ id }) => ["data-block-id", id]),
    ...input.content.assetSlots.map(({ id }) => ["data-asset-slot-id", id]),
  ] as const;

  for (const [attribute, value] of requiredMarkers) {
    if (!hasDataAttribute(html, attribute, value)) {
      issues.push(`缺少 ${attribute}="${value}" 稳定标记。`);
    }
  }

  validateAssetReferences(html, input.content, input.assets ?? [], issues);

  const visibleText = normalizeVisibleText(html);
  for (const text of collectRequiredContentText(input.content)) {
    if (!visibleText.includes(normalizeText(text))) {
      issues.push(`页面正文缺少 DSL 文本：${text}`);
    }
  }

  if (issues.length > 0) {
    throw new AiSchemaValidationError(
      `生成 HTML 校验失败：${issues.join("；")}`,
    );
  }

  return { html, validation: { contract, safety } };
}

/** 调用文本模型生成原始 HTML 文档，避免再套一层 JSON 转义。 */
async function generateHtml(
  input: HtmlEngineerResolvedInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  },
) {
  const prompts = await buildHtmlEngineerPrompts({
    pageContentDsl: input.content,
    functionalTemplate: input.functionalTemplate,
    styleTemplate: input.styleTemplate,
    visualBrief: input.visualBrief,
    pageGuidance: input.pageGuidance,
    assets: input.assets ?? [],
  });
  const messages = [
    {
      id: "html-engineer-request",
      role: "user",
      parts: [{ type: "text", text: prompts.userPrompt }],
    },
  ] satisfies UIMessage[];
  const result = await generateTextSafe({
    abortSignal: input.abortSignal,
    maxTokens: 8_000,
    messages,
    promptVersion: prompts.version,
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    timeoutMs: 60_000,
    traceId: input.traceId,
  });

  return result.text;
}

function validateAssetReferences(
  html: string,
  content: PageContentDSL,
  assets: AssetGenerationResult[],
  issues: string[],
) {
  const slotIds = content.assetSlots.map(({ id }) => id);
  const resultIds = assets.map(({ request }) => request.assetSlotId);

  if (
    resultIds.length !== slotIds.length ||
    new Set(resultIds).size !== resultIds.length ||
    resultIds.some((id) => !slotIds.includes(id))
  ) {
    issues.push("素材生成结果必须无重复地覆盖当前页面全部 assetSlots。");
    return;
  }

  for (const result of assets) {
    const uri = result.asset?.uri;
    if (result.status === "ready" && (!uri || !html.includes(uri))) {
      issues.push(`素材槽 ${result.request.assetSlotId} 没有引用已生成素材 URI。`);
    }
    if (
      result.status === "fallback" &&
      result.fallback &&
      !hasAttributesOnSameTag(html, {
        "data-asset-slot-id": result.request.assetSlotId,
        "data-asset-fallback": result.fallback.kind,
      })
    ) {
      issues.push(
        `素材槽 ${result.request.assetSlotId} 缺少 data-asset-fallback="${result.fallback.kind}" 标记。`,
      );
    }
  }

  const allowedUris = new Set(
    assets.flatMap(({ asset }) => (asset?.uri ? [asset.uri] : [])),
  );
  const imageSources = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi)]
    .map((match) => match[2])
    .filter(Boolean);
  for (const source of imageSources) {
    if (!allowedUris.has(source)) {
      issues.push(`图片 src 不在已批准素材清单中：${source}`);
    }
  }
}

function hasAttributesOnSameTag(
  html: string,
  attributes: Record<string, string>,
) {
  return (html.match(/<[a-z][^>]*>/gi) ?? []).some((tag) =>
    Object.entries(attributes).every(([attribute, value]) =>
      hasDataAttribute(tag, attribute, value),
    ),
  );
}

function hasDataAttribute(html: string, attribute: string, value: string) {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `\\b${attribute}\\s*=\\s*(["'])${escapedValue}\\1`,
    "i",
  );

  return pattern.test(html);
}

function collectRequiredContentText(content: PageContentDSL) {
  const blockText = content.blocks.flatMap((block) => [
    block.heading,
    block.body,
    ...block.supportingPoints,
  ]);
  const interaction = content.interaction;
  let interactionText: string[] = [];

  switch (interaction.type) {
    case "none":
      break;
    case "navigate":
      interactionText = [interaction.actionLabel];
      break;
    case "reveal":
    case "explore":
      interactionText = [
        interaction.prompt,
        ...interaction.items.flatMap((item) => [item.label, item.content]),
      ];
      break;
    case "choice":
      interactionText = interaction.questions.flatMap((question) => [
        question.prompt,
        ...question.options.map(({ label }) => label),
        question.feedback.success,
        question.feedback.retry,
      ]);
      break;
    case "sort":
      interactionText = [
        interaction.prompt,
        ...interaction.items.flatMap((item) => [item.label, item.content]),
        interaction.feedback.success,
        interaction.feedback.retry,
      ];
      break;
    case "input":
      interactionText = [
        interaction.prompt,
        interaction.placeholder,
        ...interaction.evaluationCriteria,
        interaction.feedback.success,
        interaction.feedback.retry,
      ];
      break;
  }

  return [content.title, ...content.narration, ...blockText, ...interactionText];
}

function normalizeVisibleText(html: string) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? html;
  return normalizeText(
    body
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(?:39|x27);/gi, "'")
      .replace(/&#(\d+);/g, (_, code: string) =>
        String.fromCodePoint(Number(code)),
      )
      .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
        String.fromCodePoint(Number.parseInt(code, 16)),
      ),
  );
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}
