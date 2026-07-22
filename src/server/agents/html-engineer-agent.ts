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
  validationFeedback?: HtmlEngineerValidationFeedback;
};

export type HtmlEngineerValidationFeedback = {
  code: string;
  issues: string[];
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

      let normalized = normalizeTrustedDslMarkup(generated, state.task);
      normalized = normalizeNativeInteractionMarker(normalized, state.task);
      normalized = normalizeRevealCardInteraction(normalized, state.task);
      normalized = normalizeReadyCssBackgroundAccessibility(
        normalized,
        state.task,
      );
      const { html, validation } = validateHtmlEngineerOutput(
        normalized,
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
    validationFeedback: input.validationFeedback,
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
  const mainOpenTags = html.match(/<main\b[^>]*>/gi) ?? [];
  const mainCloseTags = html.match(/<\/main\s*>/gi) ?? [];
  if (mainOpenTags.length !== 1 || mainCloseTags.length !== 1) {
    issues.push("页面必须包含且只能包含一个 main 主内容区域。");
  }
  if (
    input.content.interaction.type === "choice" &&
    hasDisabledChoiceControl(html)
  ) {
    issues.push("choice 互动的单选或复选控件不得包含 disabled 属性。");
  }
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
    if (
      !hasRequiredStaticContentText(html, visibleText, input.content, text)
    ) {
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

function hasDisabledChoiceControl(html: string) {
  return [...html.matchAll(/<input\b[^>]*>/gi)].some(({ 0: tag }) => {
    const type = tag.match(/\btype\s*=\s*["']?(radio|checkbox)\b/i)?.[1];
    const disabled =
      /\sdisabled(?:\s*=\s*(?:["'][^"']*["']|[^\s>]+))?(?=\s|\/?>)/i;
    return Boolean(type && disabled.test(tag));
  });
}

/**
 * 模型负责布局，但 DSL 正文是服务端事实。只在已有 main 和唯一 block marker
 * 内恢复被模型遗漏的可信文字，并先转义原样输出的数学比较符；插入内容保持
 * 可见且最终仍须通过完整 HTML、安全、素材和稳定标记合同。
 */
export function normalizeTrustedDslMarkup(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;

  let html = output;
  const requiredText = collectRequiredStaticContentText(input.content);
  for (const text of requiredText) {
    if (/[&<>]/.test(text) && html.includes(text)) {
      html = html.replaceAll(text, escapeHtmlText(text));
    }
  }

  for (const block of input.content.blocks) {
    const markers = findTagMatchesWithAttributes(html, {
      "data-block-id": block.id,
    });
    if (markers.length !== 1) continue;
    const marker = markers[0]!;
    const element = getElementHtml(html, marker);
    if (!element) continue;

    const visible = normalizeVisibleText(element);
    const missingHeading = !visible.includes(normalizeText(block.heading));
    const missingBody = !visible.includes(normalizeText(block.body));
    const missingPoints = block.supportingPoints.filter(
      (point) => !visible.includes(normalizeText(point)),
    );
    if (!missingHeading && !missingBody && missingPoints.length === 0) {
      continue;
    }

    const restored = [
      missingHeading ? `<h2>${escapeHtmlText(block.heading)}</h2>` : "",
      missingBody ? `<p>${escapeHtmlText(block.body)}</p>` : "",
      missingPoints.length > 0
        ? `<ul>${missingPoints.map((point) => `<li>${escapeHtmlText(point)}</li>`).join("")}</ul>`
        : "",
    ].join("");
    html = insertBeforeElementClose(
      html,
      marker,
      `<div data-course-contract-restored="block">${restored}</div>`,
    );
  }

  const mainMatches = [...html.matchAll(/<main\b[^>]*>/gi)].map((match) => ({
    index: match.index,
    tag: match[0],
  }));
  if (mainMatches.length !== 1) return html;

  const pageVisible = normalizeVisibleText(html);
  const pageText = [input.content.title, ...input.content.narration];
  if (
    input.content.interaction.type === "reveal" ||
    input.content.interaction.type === "explore"
  ) {
    pageText.push(input.content.interaction.prompt);
  }
  const missingPageText = pageText.filter(
    (text) => !pageVisible.includes(normalizeText(text)),
  );
  if (missingPageText.length === 0) return html;

  const restored = missingPageText
    .map((text, index) =>
      text === input.content.title && index === 0
        ? `<h1>${escapeHtmlText(text)}</h1>`
        : `<p>${escapeHtmlText(text)}</p>`,
    )
    .join("");
  return insertBeforeElementClose(
    html,
    mainMatches[0]!,
    `<div data-course-contract-restored="page">${restored}</div>`,
  );
}

/**
 * reveal 页面若已有完整 details 结构，仍由严格 marker 规范化处理；若模型只
 * 生成了普通卡片，则在所有唯一、互不嵌套的 block 根节点外包原生 details，
 * 保留模型内容与样式，并提供无脚本可操作的确定性降级。
 */
export function normalizeRevealCardInteraction(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (
    typeof output !== "string" ||
    input.content.interaction.type !== "reveal" ||
    hasDataAttribute(output, "data-interaction-type", "reveal") ||
    /<details\b/i.test(output)
  ) {
    return output;
  }

  const blocks = input.content.blocks.map((block, index) => {
    const markers = findTagMatchesWithAttributes(output, {
      "data-block-id": block.id,
    });
    if (markers.length !== 1) return undefined;
    const marker = markers[0]!;
    const element = getElementHtml(output, marker);
    return element
      ? { block, element, index, start: marker.index, end: marker.index + element.length }
      : undefined;
  });
  if (blocks.some((block) => !block)) return output;

  const ranges = blocks
    .filter((block): block is NonNullable<typeof block> => Boolean(block))
    .sort((left, right) => left.start - right.start);
  if (ranges.some((block, index) => index > 0 && ranges[index - 1]!.end > block.start)) {
    return output;
  }

  let html = output;
  for (const { block, element, index, start } of [...ranges].reverse()) {
    const interactionMarker =
      index === 0 ? ' data-interaction-type="reveal"' : "";
    const summary = escapeHtmlText(block.label ?? block.heading);
    const details = `<details${interactionMarker}><summary>${summary}</summary>${element}</details>`;
    html = `${html.slice(0, start)}${details}${html.slice(start + element.length)}`;
  }
  return html;
}

function insertBeforeElementClose(
  html: string,
  marker: OpeningTagMatch,
  markup: string,
) {
  const element = getElementHtml(html, marker);
  const tagName = marker.tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1];
  if (!element || !tagName) return html;

  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const closing = new RegExp(`</${escapedTagName}\\s*>\\s*$`, "i").exec(element);
  if (!closing?.index) return html;

  const insertionIndex = marker.index + closing.index;
  return `${html.slice(0, insertionIndex)}${markup}${html.slice(insertionIndex)}`;
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * data-interaction-type 是技术定位元数据。模型遗漏它时，只在 reveal 已经
 * 实现为与 DSL 逐项对应的完整 details/summary 结构时补到首个原生控件；
 * 不完整或静态伪互动仍交给严格校验拒绝。
 */
export function normalizeNativeInteractionMarker(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;
  const interaction = input.content.interaction;
  if (
    interaction.type !== "reveal" ||
    hasDataAttribute(output, "data-interaction-type", "reveal") ||
    interaction.items.length !== input.content.blocks.length
  ) {
    return output;
  }

  const details = [...output.matchAll(/<details\b[^>]*>[\s\S]*?<\/details\s*>/gi)];
  if (
    details.length !== interaction.items.length ||
    details.some((match, index) => {
      const block = input.content.blocks[index];
      const visibleText = normalizeVisibleText(match[0]);
      return (
        !block ||
        !/<summary\b[^>]*>[\s\S]*?<\/summary\s*>/i.test(match[0]) ||
        !visibleText.includes(normalizeText(block.heading)) ||
        !visibleText.includes(normalizeText(block.body))
      );
    })
  ) {
    return output;
  }

  const first = details[0];
  const openingTag = first?.[0].match(/^<details\b[^>]*>/i)?.[0];
  if (first?.index === undefined || !openingTag) return output;

  const normalizedOpeningTag = openingTag.replace(
    />$/,
    ' data-interaction-type="reveal">',
  );
  return (
    output.slice(0, first.index) +
    normalizedOpeningTag +
    output.slice(first.index + openingTag.length)
  );
}

/**
 * CSS 背景的可访问名称来自服务端已批准的 Asset.altText。模型常会对
 * aria-label 做同义改写，导致相同输入在重试时重复失败；这里仅把已经
 * 唯一绑定到真实素材槽的 CSS consumer 规范化，再交给原严格校验器复验。
 */
function normalizeReadyCssBackgroundAccessibility(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;

  let html = output;
  for (const result of input.assets ?? []) {
    if (result.status !== "ready" || !result.asset?.uri) continue;

    const { assetSlotId } = result.request;
    const markers = findTagMatchesWithAttributes(html, {
      "data-asset-slot-id": assetSlotId,
    });
    if (markers.length !== 1) continue;

    const marker = markers[0];
    const tagName = marker.tag
      .match(/^<\s*([a-z][\w:-]*)/i)?.[1]
      ?.toLowerCase();
    const directImage =
      tagName === "img" &&
      hasAttributeValue(marker.tag, "src", result.asset.uri);
    const descendantImage = directImage
      ? undefined
      : findUniqueDescendantImage(
          html,
          marker,
          assetSlotId,
          result.asset.uri,
        );
    if (directImage || descendantImage) continue;

    const cssConsumer = findReadyCssAssetConsumer(
      html,
      marker,
      result.asset.uri,
    );
    if (!cssConsumer) continue;

    const altText = result.asset.altText ?? "";
    if (hasAccessibleBackgroundContract(cssConsumer.tag, altText)) continue;

    const normalizedTag = setBackgroundAccessibility(cssConsumer.tag, altText);
    html =
      html.slice(0, cssConsumer.index) +
      normalizedTag +
      html.slice(cssConsumer.index + cssConsumer.tag.length);
  }

  return html;
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
    validationFeedback: input.validationFeedback,
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

/** ready 素材必须能唯一关联到自己的槽位根节点，不能跨槽误用。 */
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

  const assetTags = findTagMatchesWithAttributes(html, {
    "data-asset-slot-id": assetSlotId,
  });
  if (assetTags.length !== 1) {
    issues.push(`素材槽 ${assetSlotId} 必须且只能有一个槽位根节点。`);
    return;
  }

  const marker = assetTags[0];
  const tag = marker.tag;
  const tagName = tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1]?.toLowerCase();
  const directImageTag =
    tagName === "img" && hasAttributeValue(tag, "src", asset.uri);
  const descendantImageTag = directImageTag
    ? undefined
    : findUniqueDescendantImage(html, marker, assetSlotId, asset.uri);
  const imageTag = directImageTag ? tag : descendantImageTag;
  const cssConsumer = findReadyCssAssetConsumer(html, marker, asset.uri);
  const cssTag = cssConsumer?.tag;
  if (!imageTag && !cssTag) {
    issues.push(
      `素材槽 ${assetSlotId} 没有在对应节点引用已生成素材 URI（${describeUnboundAssetReference(html, asset.uri)}）。`,
    );
    return;
  }

  const altText = asset.altText ?? "";
  if (imageTag) {
    if (!hasAttributeValue(imageTag, "alt", altText)) {
      issues.push(`素材槽 ${assetSlotId} 的 alt 必须等于已批准的替代文本。`);
    }
    return;
  }
  if (!cssTag) {
    issues.push(`素材槽 ${assetSlotId} 没有在对应节点引用已生成素材 URI。`);
    return;
  }

  const accessible =
    hasAccessibleBackgroundContract(cssTag, altText) ||
    (cssTag !== tag && hasAccessibleBackgroundContract(tag, altText));
  if (!accessible) {
    issues.push(
      `素材槽 ${assetSlotId} 的 CSS 背景必须提供匹配的可访问说明或显式隐藏。`,
    );
  }
}

/** 只公开资源消费类别，不回显模型 HTML、选择器或正文。 */
function describeUnboundAssetReference(html: string, uri: string) {
  if (containsCssUrl(html, uri)) return "URI 位于未绑定的 CSS url()";

  for (const tag of html.match(/<[a-z][^>]*>/gi) ?? []) {
    const tagName =
      tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1]?.toLowerCase() ?? "元素";
    if (getAttributeValues(tag, "src").includes(uri)) {
      return `URI 位于未绑定的 <${tagName}> src`;
    }
    if (
      getAttributeValues(tag, "srcset").some((value) =>
        parseSrcset(value).includes(uri),
      )
    ) {
      return `URI 位于未绑定的 <${tagName}> srcset`;
    }
    if (getAttributeValues(tag, "poster").includes(uri)) {
      return `URI 位于未绑定的 <${tagName}> poster`;
    }
    if (
      getAttributeValues(tag, "href").includes(uri) ||
      getAttributeValues(tag, "xlink:href").includes(uri)
    ) {
      return `URI 位于未绑定的 <${tagName}> href`;
    }
  }

  return "URI 位于未绑定的资源节点";
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
  return findTagMatchesWithAttributes(html, attributes).map(({ tag }) => tag);
}

type OpeningTagMatch = { index: number; tag: string };

function findTagMatchesWithAttributes(
  html: string,
  attributes: Record<string, string>,
): OpeningTagMatch[] {
  return Array.from(html.matchAll(/<[a-z][^>]*>/gi))
    .map((match) => ({ index: match.index, tag: match[0] }))
    .filter(({ tag }) =>
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

  return backgroundDeclarationUsesUri(style, uri);
}

function containsCssUrl(css: string, uri: string) {
  const escapedUri = uri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `url\\(\\s*["']?${escapedUri}["']?\\s*\\)`,
    "i",
  ).test(css);
}

/** 接受语义化 wrapper 包裹唯一 img，但拒绝 marker 与图片互为兄弟节点。 */
function findUniqueDescendantImage(
  html: string,
  marker: OpeningTagMatch,
  assetSlotId: string,
  uri: string,
) {
  const elementHtml = getElementHtml(html, marker);
  if (!elementHtml) return undefined;

  const candidates = (elementHtml.match(/<img\b[^>]*>/gi) ?? []).filter(
    (tag) => {
      const nestedSlotIds = getAttributeValues(tag, "data-asset-slot-id");
      return (
        hasAttributeValue(tag, "src", uri) &&
        (nestedSlotIds.length === 0 || nestedSlotIds.includes(assetSlotId))
      );
    },
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function findReadyCssAssetConsumer(
  html: string,
  marker: OpeningTagMatch,
  uri: string,
) {
  if (
    hasCssUrl(marker.tag, uri) ||
    hasUniqueStylesheetBackground(html, marker.tag, uri)
  ) {
    return marker;
  }

  return findUniqueDescendantCssConsumer(html, marker, uri);
}

function findUniqueDescendantCssConsumer(
  html: string,
  marker: OpeningTagMatch,
  uri: string,
) {
  const elementHtml = getElementHtml(html, marker);
  if (!elementHtml) return undefined;

  const candidates = findTagMatchesWithAttributes(elementHtml, {})
    .filter(({ index }) => index > 0)
    .filter(({ tag }) => {
      const nestedSlotIds = getAttributeValues(tag, "data-asset-slot-id");
      return (
        nestedSlotIds.length === 0 &&
        (hasCssUrl(tag, uri) ||
          hasUniqueStylesheetBackground(html, tag, uri))
      );
    });
  return candidates.length === 1
    ? {
        index: marker.index + candidates[0].index,
        tag: candidates[0].tag,
      }
    : undefined;
}

function hasAccessibleBackgroundContract(tag: string, altText: string) {
  return altText
    ? hasAttributeValue(tag, "role", "img") &&
        hasAttributeValue(tag, "aria-label", altText)
    : hasAttributeValue(tag, "aria-hidden", "true");
}

function setBackgroundAccessibility(tag: string, altText: string) {
  const withoutAccessibility = tag.replace(
    /\s+(?:role|aria-label|aria-hidden)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'"=<>`]+)/gi,
    "",
  );
  const attributes = altText
    ? ` role="img" aria-label="${escapeHtmlAttribute(altText)}"`
    : ' aria-hidden="true"';

  return withoutAccessibility.replace(/\s*(\/?>)$/, `${attributes}$1`);
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

function getElementHtml(html: string, marker: OpeningTagMatch) {
  const tagName = marker.tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1];
  if (!tagName || /\/\s*>$/.test(marker.tag)) return marker.tag;

  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<\\/?\\s*${escapedTagName}\\b[^>]*>`, "gi");
  pattern.lastIndex = marker.index + marker.tag.length;
  let depth = 1;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const isClosingTag = /^<\s*\//.test(match[0]);
    if (isClosingTag) {
      depth -= 1;
    } else if (!/\/\s*>$/.test(match[0])) {
      depth += 1;
    }

    if (depth === 0) {
      return html.slice(marker.index, match.index + match[0].length);
    }
  }

  return undefined;
}

/**
 * 样式表背景只有在唯一 class/id 或精确槽位属性的单一简单选择器直接引用 URI
 * 时才成立，避免退回到不区分槽位的全局 URI 包含判断。
 */
function hasUniqueStylesheetBackground(html: string, tag: string, uri: string) {
  const classNames = getAttributeValues(tag, "class").flatMap((value) =>
    value.split(/\s+/).filter(Boolean),
  );
  const classBinding = classNames.some((className) => {
    const classOwners = findTagMatchesWithAttributes(html, {}).filter(
      ({ tag: candidate }) => hasClassName(candidate, className),
    );
    return (
      classOwners.length === 1 &&
      stylesheetBindsClassToUri(html, className, uri)
    );
  });
  if (classBinding) return true;

  const idBinding = getAttributeValues(tag, "id").some((id) => {
    const idOwners = findTagMatchesWithAttributes(html, { id });
    return (
      idOwners.length === 1 && stylesheetBindsIdToUri(html, id, uri)
    );
  });
  if (idBinding) return true;

  return getAttributeValues(tag, "data-asset-slot-id").some((slotId) => {
    const slotOwners = findTagMatchesWithAttributes(html, {
      "data-asset-slot-id": slotId,
    });
    return (
      slotOwners.length === 1 &&
      stylesheetBindsAssetSlotToUri(html, slotId, uri)
    );
  });
}

function hasClassName(tag: string, className: string) {
  return getAttributeValues(tag, "class").some((value) =>
    value.split(/\s+/).includes(className),
  );
}

function stylesheetBindsClassToUri(
  html: string,
  className: string,
  uri: string,
) {
  const escapedClassName = className.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const classSelector = new RegExp(
    `^\\.${escapedClassName}(?::(?:before|after)|::(?:before|after))?$`,
  );

  return stylesheetBindsSelectorToUri(html, classSelector, uri);
}

function stylesheetBindsIdToUri(html: string, id: string, uri: string) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return stylesheetBindsSelectorToUri(
    html,
    new RegExp(`^#${escapedId}(?::(?:before|after)|::(?:before|after))?$`),
    uri,
  );
}

function stylesheetBindsAssetSlotToUri(
  html: string,
  slotId: string,
  uri: string,
) {
  const escapedSlotId = slotId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const slotSelector = new RegExp(
    `^\\[\\s*data-asset-slot-id\\s*=\\s*(?:"${escapedSlotId}"|'${escapedSlotId}'|${escapedSlotId})\\s*\\](?::(?:before|after)|::(?:before|after))?$`,
  );

  return stylesheetBindsSelectorToUri(html, slotSelector, uri);
}

function stylesheetBindsSelectorToUri(
  html: string,
  selectorPattern: RegExp,
  uri: string,
) {
  for (const styleMatch of html.matchAll(
    /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
  )) {
    const css = styleMatch[1];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = rule[1]
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean);
      if (
        selectors.length === 1 &&
        selectorPattern.test(selectors[0]) &&
        backgroundDeclarationUsesUri(rule[2], uri)
      ) {
        return true;
      }
    }
  }

  return false;
}

function backgroundDeclarationUsesUri(declarations: string, uri: string) {
  const uncommentedDeclarations = declarations.replace(
    /\/\*[\s\S]*?\*\//g,
    " ",
  );

  for (const declaration of uncommentedDeclarations.matchAll(
    /(?:^|;)\s*(?:background|background-image)\s*:\s*([^;]+)/gi,
  )) {
    if (containsCssUrl(declaration[1] ?? "", uri)) return true;
  }

  return false;
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
        ...interaction.items.flatMap((item, index) =>
          isAlignedBlockReference(item, content.blocks[index])
            ? []
            : [item.label, item.content],
        ),
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

  return [
    ...new Set([
      content.title,
      ...content.narration,
      ...blockText,
      ...interactionText,
    ]),
  ];
}

/**
 * reveal/explore 常用互动项指向同序内容块，例如“知识点1卡片”指向
 * label="知识点1" 的 block。该引用不是额外教学正文；块标题、正文和稳定
 * blockId 仍由原合同逐项校验。只有 label/content 都是同一块的结构引用时收敛。
 */
function isAlignedBlockReference(
  item: { label: string; content: string },
  block: PageContentDSL["blocks"][number] | undefined,
) {
  if (!block) return false;

  const names = [block.label, block.heading]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, `${value}卡片`])
    .map(normalizeText);
  const references = new Set(names);

  return (
    references.has(normalizeText(item.label)) &&
    references.has(normalizeText(item.content))
  );
}

/**
 * choice prompt 可以把纯展示题号与题干拆开，但不能丢失或改写题干。
 * 仅当第 N 个 prompt 的序号前缀正好对应第 N 个 question block，且去掉
 * 序号后的文本等于该 block.body 并真实出现在对应稳定节点中时才接受。
 */
function hasRequiredStaticContentText(
  html: string,
  visibleText: string,
  content: PageContentDSL,
  requiredText: string,
) {
  const normalizedRequiredText = normalizeText(requiredText);
  if (visibleText.includes(normalizedRequiredText)) return true;

  if (content.interaction.type !== "choice") return false;
  const questionIndex = content.interaction.questions.findIndex(
    ({ prompt }) => prompt === requiredText,
  );
  if (questionIndex < 0) return false;

  const promptBody = stripChoiceQuestionNumber(
    normalizedRequiredText,
    questionIndex + 1,
  );
  const questionBlocks = content.blocks.filter(
    ({ kind }) => kind === "question",
  );
  const block = questionBlocks[questionIndex];
  if (!promptBody || !block || normalizeText(block.body) !== promptBody) {
    return false;
  }

  const blockMarkers = findTagMatchesWithAttributes(html, {
    "data-block-id": block.id,
  });
  if (blockMarkers.length !== 1) return false;
  const blockHtml = getElementHtml(html, blockMarkers[0]!);

  return Boolean(
    blockHtml && normalizeVisibleText(blockHtml).includes(promptBody),
  );
}

function stripChoiceQuestionNumber(value: string, questionNumber: number) {
  const numericPrefix = new RegExp(
    `^${questionNumber}\\s*[.、:)]\\s*(.+)$`,
  );
  const chinesePrefix = new RegExp(
    `^第\\s*${questionNumber}\\s*题\\s*[.、:：]?\\s*(.+)$`,
  );

  return value.match(numericPrefix)?.[1]?.trim() ??
    value.match(chinesePrefix)?.[1]?.trim();
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
