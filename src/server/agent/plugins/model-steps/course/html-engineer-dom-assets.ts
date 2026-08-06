import type { AssetGenerationResult, PageContentDSL } from "@/shared/course-schema";

import { decodeHtmlEntities } from "./html-engineer-text";

export function validateAssetReferences(
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
      issues.push(describeUnapprovedAssetSource(source));
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

function describeUnapprovedAssetSource(source: string) {
  if (/^data:image\/svg\+xml(?:;|,)/i.test(source)) {
    return "代码原生 SVG 必须直接使用文档内 <svg>，不得编码为 data URI。";
  }
  if (/^(?:data|blob):/i.test(source)) {
    return "页面不得使用 data: 或 blob: 素材 URI；只能使用已批准的 ready 素材 URI。";
  }
  return `素材 URI 不在已批准素材清单中：${source}`;
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

export type OpeningTagMatch = { index: number; tag: string };

export function findTagMatchesWithAttributes(
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

export function hasDataAttribute(html: string, attribute: string, value: string) {
  return hasAttributeValue(html, attribute, value);
}

export function hasAttributeValue(html: string, attribute: string, value: string) {
  return getAttributeValues(html, attribute).some(
    (attributeValue) => attributeValue === value,
  );
}

export function getAttributeValues(html: string, attribute: string) {
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
export function findUniqueDescendantImage(
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

export function findReadyCssAssetConsumer(
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

export function hasAccessibleBackgroundContract(tag: string, altText: string) {
  return altText
    ? hasAttributeValue(tag, "role", "img") &&
        hasAttributeValue(tag, "aria-label", altText)
    : hasAttributeValue(tag, "aria-hidden", "true");
}

export function setBackgroundAccessibility(tag: string, altText: string) {
  const withoutAccessibility = tag.replace(
    /\s+(?:role|aria-label|aria-hidden)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s'"=<>`]+)/gi,
    "",
  );
  const attributes = altText
    ? ` role="img" aria-label="${escapeHtmlAttribute(altText)}"`
    : ' aria-hidden="true"';

  return withoutAccessibility.replace(/\s*(\/?>)$/, `${attributes}$1`);
}

export function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

export function getElementHtml(html: string, marker: OpeningTagMatch) {
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

export function isOpeningTagInsideElement(
  html: string,
  child: OpeningTagMatch,
  parent: OpeningTagMatch,
) {
  const parentHtml = getElementHtml(html, parent);
  if (!parentHtml || child.index <= parent.index) return false;
  return (
    child.index + child.tag.length <= parent.index + parentHtml.length
  );
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
