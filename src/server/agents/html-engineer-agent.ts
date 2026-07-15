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
  const requiredMarkers: Array<readonly [string, string]> = [
    ["data-page-id", input.content.pageId],
    ...input.content.blocks.map(
      ({ id }) => ["data-block-id", id] as const,
    ),
    ...input.content.assetSlots.map(
      ({ id }) => ["data-asset-slot-id", id] as const,
    ),
  ];
  if (input.content.interaction.type !== "none") {
    requiredMarkers.push([
      "data-interaction-type",
      input.content.interaction.type,
    ]);
  }

  for (const [attribute, value] of requiredMarkers) {
    if (!hasDataAttribute(html, attribute, value)) {
      issues.push(`缺少 ${attribute}="${value}" 稳定标记。`);
    }
  }

  validateAssetReferences(html, input.content, input.assets ?? [], issues);

  const visibleText = normalizeVisibleText(html);
  for (const text of collectRequiredStaticContentText(input.content)) {
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
    if (result.status === "ready" && result.asset) {
      validateReadyAssetNode(html, result, issues);
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

  const expectedUsageCounts = new Map<string, number>();
  for (const { asset, status } of assets) {
    if (status === "ready" && asset?.uri) {
      expectedUsageCounts.set(
        asset.uri,
        (expectedUsageCounts.get(asset.uri) ?? 0) + 1,
      );
    }
  }
  const allowedUris = new Set(expectedUsageCounts.keys());
  const assetSources = collectAssetSources(html);
  for (const source of new Set(assetSources)) {
    if (!allowedUris.has(source)) {
      issues.push(`素材 URI 不在已批准素材清单中：${source}`);
    }
  }

  for (const [uri, expectedCount] of expectedUsageCounts) {
    const usageCount = assetSources.filter((source) => source === uri).length;
    if (usageCount !== expectedCount) {
      issues.push(
        `已批准素材 URI ${uri} 必须恰好被对应的 ${expectedCount} 个素材槽引用。`,
      );
    }
  }
}

/** ready 素材的 URI 与替代文本必须绑定到自己的槽位节点，不能跨槽误用。 */
function validateReadyAssetNode(
  html: string,
  result: AssetGenerationResult,
  issues: string[],
) {
  const { assetSlotId } = result.request;
  const asset = result.asset;
  if (!asset?.uri) {
    issues.push(`素材槽 ${assetSlotId} 缺少已生成素材 URI。`);
    return;
  }

  const assetTags = findTagsWithAttributes(html, {
    "data-asset-slot-id": assetSlotId,
  });
  if (assetTags.length !== 1) {
    issues.push(`素材槽 ${assetSlotId} 必须且只能有一个直接消费素材的节点。`);
    return;
  }

  const tag = assetTags[0];
  const tagName = tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1]?.toLowerCase();
  const usesImageSource =
    tagName === "img" && hasAttributeValue(tag, "src", asset.uri);
  const usesCssBackground = hasCssUrl(tag, asset.uri);
  if (!usesImageSource && !usesCssBackground) {
    issues.push(`素材槽 ${assetSlotId} 没有在对应节点引用已生成素材 URI。`);
    return;
  }

  const altText = asset.altText ?? "";
  if (usesImageSource) {
    if (!hasAttributeValue(tag, "alt", altText)) {
      issues.push(`素材槽 ${assetSlotId} 的 alt 必须等于已批准的替代文本。`);
    }
    return;
  }

  const accessible = altText
    ? hasAttributeValue(tag, "role", "img") &&
      hasAttributeValue(tag, "aria-label", altText)
    : hasAttributeValue(tag, "aria-hidden", "true");
  if (!accessible) {
    issues.push(
      `素材槽 ${assetSlotId} 的 CSS 背景必须提供匹配的可访问说明或显式隐藏。`,
    );
  }
}

function collectAssetSources(html: string) {
  const sources: string[] = [];
  const tags = html.match(/<[a-z][^>]*>/gi) ?? [];

  for (const tag of tags) {
    const tagName = tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1]?.toLowerCase();
    sources.push(...getAttributeValues(tag, "src"));

    if (tagName === "img" || tagName === "source") {
      for (const srcset of getAttributeValues(tag, "srcset")) {
        sources.push(...parseSrcset(srcset));
      }
    }
    if (tagName === "video") {
      sources.push(...getAttributeValues(tag, "poster"));
    }
    if (tagName === "image") {
      sources.push(...getAttributeValues(tag, "href"));
      sources.push(...getAttributeValues(tag, "xlink:href"));
    }
  }

  for (const match of html.matchAll(
    /url\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi,
  )) {
    const source = match[1] ?? match[2] ?? match[3];
    if (source) sources.push(decodeHtmlEntities(source.trim()));
  }

  return sources.filter((source) => source && !source.startsWith("#"));
}

function parseSrcset(value: string) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? "")
    .filter(Boolean);
}

function hasAttributesOnSameTag(
  html: string,
  attributes: Record<string, string>,
) {
  return findTagsWithAttributes(html, attributes).length > 0;
}

function findTagsWithAttributes(
  html: string,
  attributes: Record<string, string>,
) {
  return (html.match(/<[a-z][^>]*>/gi) ?? []).filter((tag) =>
    Object.entries(attributes).every(([attribute, value]) =>
      hasAttributeValue(tag, attribute, value),
    ),
  );
}

function hasDataAttribute(html: string, attribute: string, value: string) {
  return hasAttributeValue(html, attribute, value);
}

function hasAttributeValue(html: string, attribute: string, value: string) {
  return getAttributeValues(html, attribute).some(
    (attributeValue) => attributeValue === value,
  );
}

function getAttributeValues(html: string, attribute: string) {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\s)${escapedAttribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s'"=<>\u0060]+))`,
    "gi",
  );
  const values: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    values.push(decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? ""));
  }

  return values;
}

function hasCssUrl(tag: string, uri: string) {
  const style =
    tag.match(/\bstyle\s*=\s*"([^"]*)"/i)?.[1] ??
    tag.match(/\bstyle\s*=\s*'([^']*)'/i)?.[1];
  if (!style) return false;

  const escapedUri = uri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `url\\(\\s*["']?${escapedUri}["']?\\s*\\)`,
    "i",
  ).test(style);
}

/** 静态预览必须常显的正文；答错后的 retry 反馈仍由 DSL 保存，不要求永久铺在页面上。 */
function collectRequiredStaticContentText(content: PageContentDSL) {
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
      ]);
      break;
    case "sort":
      interactionText = [
        interaction.prompt,
        ...interaction.items.flatMap((item) => [item.label, item.content]),
        interaction.feedback.success,
      ];
      break;
    case "input":
      interactionText = [
        interaction.prompt,
        interaction.placeholder,
        ...interaction.evaluationCriteria,
        interaction.feedback.success,
      ];
      break;
  }

  return [content.title, ...content.narration, ...blockText, ...interactionText];
}

function normalizeVisibleText(html: string) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body\s*>/i)?.[1] ?? html;
  return normalizeText(
    decodeHtmlEntities(
      body
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

/** Prompt 合同只允许这组基础命名实体；其他字符必须使用原字符或数字实体。 */
function decodeHtmlEntities(value: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal: string, hexadecimal: string, named: string) => {
      if (decimal || hexadecimal) {
        const codePoint = decimal
          ? Number(decimal)
          : Number.parseInt(hexadecimal, 16);
        return Number.isInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }

      return namedEntities[named.toLowerCase()] ?? entity;
    },
  );
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}
