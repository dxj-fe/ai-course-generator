import type { PageContentDSL } from "@/shared/course-schema";

import type { HtmlEngineerInput } from "./html-engineer-model-step";
import {
  collectRequiredStaticContentText,
  isRevealItemRepresentedByBlock,
} from "./html-engineer-content-text";
import {
  escapeHtmlAttribute,
  findReadyCssAssetConsumer,
  findTagMatchesWithAttributes,
  findUniqueDescendantImage,
  getAttributeValues,
  getElementHtml,
  hasAccessibleBackgroundContract,
  hasAttributeValue,
  hasDataAttribute,
  isOpeningTagInsideElement,
  setBackgroundAccessibility,
  type OpeningTagMatch,
} from "./html-engineer-dom-assets";
import {
  containsTrustedText,
  normalizeText,
  normalizeVisibleText,
} from "./html-engineer-text";

const TRUSTED_PLAYER_LAYOUT_GUARD = `<style data-keya-layout-guard="current">
html,body{width:100%!important;height:100%!important;margin:0!important;overflow:visible!important;box-sizing:border-box}
main[data-page-id]{position:relative;width:100%!important;max-width:none!important;height:100%!important;min-width:0;min-height:0;margin:0 auto!important;overflow:visible!important;box-sizing:border-box}
main[data-page-id],main[data-page-id] *,main[data-page-id] *::before,main[data-page-id] *::after{box-sizing:border-box}
main[data-page-id]>*{min-width:0}
main[data-page-id] img,main[data-page-id] svg,main[data-page-id] canvas,main[data-page-id] video{max-width:100%;max-height:100%}
main[data-page-id] :where(button,[role="button"],summary,select,input:not([type="hidden"]),textarea){min-width:44px;min-height:44px}
main[data-page-id] :where(button,[role="button"],summary,select,input,textarea):focus-visible{outline:2px solid var(--course-color-primary,currentColor);outline-offset:3px}
main[data-page-id] [data-feedback-kind][hidden]{display:none!important}
@media (max-width:520px){
  html,body{height:auto!important;min-height:100%!important}
  main[data-page-id]{height:auto!important;min-height:100%!important}
}
@media (prefers-reduced-motion:reduce){
  main[data-page-id] *,main[data-page-id] *::before,main[data-page-id] *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
}
</style>`;

/**
 * HTML 模型完整负责构图；运行层只注入与视觉语言无关的根画布、触控目标、
 * 焦点和 reduced-motion 护栏。不要在这里重排、缩字或隐藏模型内容，否则会
 * 把 frontend-slides 的设计身份确定性压平成通用卡片页面。
 */
export function normalizeTrustedPlayerLayout(output: unknown) {
  if (
    typeof output !== "string" ||
    output.includes('data-keya-layout-guard="current"')
  ) {
    return output;
  }

  const headClose = output.match(/<\/head\s*>/i);
  if (headClose?.index === undefined) return output;
  return (
    output.slice(0, headClose.index) +
    TRUSTED_PLAYER_LAYOUT_GUARD +
    output.slice(headClose.index)
  );
}

/**
 * 低高度平板仍需要保持横向构图。模型偶尔会在 712/768/922px 把 grid 或
 * flex 整体折成单列；这里只把这种明确的单列断点推迟到 520px，不改字体、
 * 间距等其他响应式规则，也不重写模型的桌面构图。
 */
export function normalizeWideSingleColumnBreakpoints(output: unknown) {
  if (typeof output !== "string") return output;

  const mediaPattern = /@media\s*\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)(?:\s+and\s+\([^{}]*\))*\s*(?=\{)/gi;
  const matches = [...output.matchAll(mediaPattern)];
  if (matches.length === 0) return output;

  let html = output;
  for (const match of [...matches].reverse()) {
    const threshold = Number(match[1]);
    if (
      !Number.isFinite(threshold) ||
      threshold <= 520 ||
      match.index === undefined
    ) {
      continue;
    }
    const bodyStart = match.index + match[0].length;
    const nextMedia = output.indexOf("@media", bodyStart);
    const styleEnd = output.indexOf("</style", bodyStart);
    const boundaries = [nextMedia, styleEnd].filter(
      (index) => index >= 0,
    );
    const bodyEnd =
      boundaries.length > 0
        ? Math.min(...boundaries)
        : output.length;
    const segment = output.slice(bodyStart, bodyEnd);
    const collapsesToSingleColumn =
      /grid-template-columns\s*:\s*1fr\s*(?:!important\s*)?(?:;|})/i.test(
        segment,
      ) ||
      /flex-direction\s*:\s*column\s*(?:!important\s*)?(?:;|})/i.test(
        segment,
      );
    if (!collapsesToSingleColumn) continue;

    const normalizedHeader = match[0]
      .replace(match[1]!, "520")
      .replace(
        /\s+and\s+\(\s*min-width\s*:\s*[^)]+\)/gi,
        "",
      );
    html = `${html.slice(0, match.index)}${normalizedHeader}${html.slice(
      match.index + match[0].length,
    )}`;
  }

  return html;
}

/**
 * 模型偶尔会把同一个素材槽同时标在语义 wrapper 与其唯一的 img 上。仅当
 * main 内存在唯一、直接消费已批准 URI 的节点时，将技术槽位标记收敛到
 * 真实 consumer；若有多个 URI consumer 或标记跨出 main，则保持原样并由
 * 严格校验拒绝。
 */
export function normalizeUniqueReadyAssetSlotRoots(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;

  let html = output;
  for (const result of input.assets ?? []) {
    if (result.status !== "ready" || !result.asset?.uri) continue;
    const { assetSlotId } = result.request;
    const uri = result.asset.uri;
    let markers = findTagMatchesWithAttributes(html, {
      "data-asset-slot-id": assetSlotId,
    });
    let main = findTagMatchesWithAttributes(html, {
      "data-page-id": input.content.pageId,
    }).filter(({ tag }) => /^<main\b/i.test(tag));
    if (main.length !== 1) continue;
    if (markers.length > 1) {
      const directConsumers = markers.filter((marker) => {
        if (!isOpeningTagInsideElement(html, marker, main[0]!)) return false;
        const tagName = marker.tag
          .match(/^<\s*([a-z][\w:-]*)/i)?.[1]
          ?.toLowerCase();
        if (
          tagName === "img" &&
          hasAttributeValue(marker.tag, "src", uri)
        ) {
          return true;
        }
        return (
          findReadyCssAssetConsumer(html, marker, uri)?.index ===
          marker.index
        );
      });
      if (directConsumers.length !== 1) continue;
      const consumer = directConsumers[0]!;
      const allInsideMain = markers.every((marker) =>
        isOpeningTagInsideElement(html, marker, main[0]!),
      );
      if (!allInsideMain) continue;

      for (const marker of [...markers]
        .filter(({ index }) => index !== consumer.index)
        .sort((left, right) => right.index - left.index)) {
        html = replaceOpeningTag(
          html,
          marker,
          removeAttribute(marker.tag, "data-asset-slot-id"),
        );
      }
    }

    markers = findTagMatchesWithAttributes(html, {
      "data-asset-slot-id": assetSlotId,
    });
    main = findTagMatchesWithAttributes(html, {
      "data-page-id": input.content.pageId,
    }).filter(({ tag }) => /^<main\b/i.test(tag));
    if (
      markers.length !== 1 ||
      main.length !== 1 ||
      !isOpeningTagInsideElement(html, markers[0]!, main[0]!)
    ) {
      continue;
    }
    const slot = input.content.assetSlots.find(
      ({ id }) => id === assetSlotId,
    );
    if (!slot) continue;
    html = replaceOpeningTag(
      html,
      markers[0]!,
      setAttributeValue(
        setAttributeValue(
          markers[0]!.tag,
          "data-keya-asset-type",
          slot.type,
        ),
        "data-keya-asset-role",
        slot.role,
      ),
    );
  }

  return html;
}

/**
 * DSL 正文是服务端事实，模型只负责布局。对可由稳定 block/item 标记唯一
 * 定位的改写或遗漏，以可信 DSL 重建该节点内部正文，避免保留模型同义改写
 * 形成重复内容；无法唯一定位的结构仍交给严格校验。数学比较符同时按 HTML
 * 文本规则转义。
 */
export function normalizeTrustedDslMarkup(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;

  const cleaned = removeRedundantRestoredDslMarkup(output, input);
  let html = typeof cleaned === "string" ? cleaned : output;
  if (input.content.interaction.type !== "choice") {
    html = restoreTrustedBlockMarkup(html, input.content);
  }
  html = restoreTrustedInteractionItemMarkup(html, input.content);
  html = restoreTrustedInteractionPrompt(html, input.content);
  html = restoreTrustedNarration(html, input.content);

  const requiredText = collectRequiredStaticContentText(input.content);
  for (const text of requiredText) {
    if (/[&<>]/.test(text) && html.includes(text)) {
      html = html.replaceAll(text, escapeHtmlText(text));
    }
  }
  return html;
}

function restoreTrustedBlockMarkup(
  html: string,
  content: PageContentDSL,
) {
  let normalized = html;
  for (const block of content.blocks) {
    const markers = findTagMatchesWithAttributes(normalized, {
      "data-block-id": block.id,
    });
    if (markers.length !== 1) continue;
    const element = getElementHtml(normalized, markers[0]!);
    if (!element) continue;
    const visible = normalizeVisibleText(element);
    const required = [
      block.heading,
      block.body,
      ...block.supportingPoints,
    ];
    if (required.every((text) => containsTrustedText(visible, text))) {
      continue;
    }

    const label =
      block.label &&
      normalizeText(block.label) !== normalizeText(block.heading)
        ? `<span data-keya-trusted-block-label="true">${escapeHtmlText(block.label)}</span>`
        : "";
    const points =
      block.supportingPoints.length > 0
        ? `<ul>${block.supportingPoints
            .map((point) => `<li>${escapeHtmlText(point)}</li>`)
            .join("")}</ul>`
        : "";
    normalized = replaceElementInnerHtml(
      normalized,
      markers[0]!,
      `<div data-course-contract-restored="block">${label}<h2>${escapeHtmlText(block.heading)}</h2><p>${escapeHtmlText(block.body)}</p>${points}</div>`,
    );
  }
  return normalized;
}

function restoreTrustedInteractionItemMarkup(
  html: string,
  content: PageContentDSL,
) {
  if (
    content.interaction.type !== "reveal" &&
    content.interaction.type !== "explore" &&
    content.interaction.type !== "sort"
  ) {
    return html;
  }

  let normalized = html;
  for (const [index, item] of content.interaction.items.entries()) {
    if (
      content.interaction.type === "reveal" &&
      isRevealItemRepresentedByBlock(item, content.blocks[index])
    ) {
      continue;
    }
    const markers = findTagMatchesWithAttributes(normalized, {
      "data-interaction-item-id": item.id,
    });
    if (markers.length !== 1) continue;
    const marker = markers[0]!;
    const element = getElementHtml(normalized, marker);
    if (!element) continue;
    const visible = normalizeVisibleText(element);
    if (
      containsTrustedText(visible, item.label) &&
      containsTrustedText(visible, item.content)
    ) {
      continue;
    }

    const alignedBlock = content.blocks[index];
    const blockRoots = alignedBlock
      ? findTagMatchesWithAttributes(normalized, {
          "data-block-id": alignedBlock.id,
        })
      : [];
    const containsAlignedBlock =
      blockRoots.length === 1 &&
      (blockRoots[0]!.index === marker.index ||
        isOpeningTagInsideElement(normalized, blockRoots[0]!, marker));
    if (containsAlignedBlock) {
      normalized = insertBeforeElementClose(
        normalized,
        marker,
        `<div data-course-contract-restored="interaction-item"><strong>${escapeHtmlText(item.label)}</strong><p>${escapeHtmlText(item.content)}</p></div>`,
      );
      continue;
    }

    const inner = /^<details\b/i.test(marker.tag)
      ? `<summary>${escapeHtmlText(item.label)}</summary><div data-course-contract-restored="interaction-item">${escapeHtmlText(item.content)}</div>`
      : `<strong>${escapeHtmlText(item.label)}</strong><p data-course-contract-restored="interaction-item">${escapeHtmlText(item.content)}</p>`;
    normalized = replaceElementInnerHtml(normalized, marker, inner);
  }
  return normalized;
}

function restoreTrustedInteractionPrompt(
  html: string,
  content: PageContentDSL,
) {
  const interaction = content.interaction;
  if (
    interaction.type === "none" ||
    interaction.type === "navigate" ||
    interaction.type === "choice"
  ) {
    return html;
  }
  const root = findUniqueInteractionRoot(html, content);
  const rootHtml = root ? getElementHtml(html, root) : undefined;
  if (
    !root ||
    !rootHtml ||
    containsTrustedText(
      normalizeVisibleText(rootHtml),
      interaction.prompt,
    )
  ) {
    return html;
  }

  return insertAfterOpeningTag(
    html,
    root,
    `<p data-course-contract-restored="interaction-prompt">${escapeHtmlText(interaction.prompt)}</p>`,
  );
}

function restoreTrustedNarration(
  html: string,
  content: PageContentDSL,
) {
  const main = findTagMatchesWithAttributes(html, {
    "data-page-id": content.pageId,
  }).filter(({ tag }) => /^<main\b/i.test(tag));
  if (main.length !== 1) return html;
  const mainHtml = getElementHtml(html, main[0]!);
  if (!mainHtml) return html;
  const visible = normalizeVisibleText(mainHtml);
  const missing = content.narration.filter(
    (line) => !containsTrustedText(visible, line),
  );
  if (missing.length === 0) return html;

  return insertAfterOpeningTag(
    html,
    main[0]!,
    `<div data-course-contract-restored="narration">${missing
      .map((line) => `<p>${escapeHtmlText(line)}</p>`)
      .join("")}</div>`,
  );
}

/**
 * Page Writer 把 reveal/explore/sort 的同序 block 与 item 规划为同一知识对象
 * 时，模型偶尔仍会先铺一组静态正文、再复制一组互动项。该结构在固定画布
 * 必然造成溢出。只有每一对文本都能从可信 DSL 证明语义对齐、且两组根节点
 * 当前确实分离时，才把它们合并为同一个原生 details；不猜测任意页面关系。
 */
export function normalizeMergedInteractiveBlocks(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content">,
) {
  if (typeof output !== "string") return output;
  const { blocks, interaction } = input.content;
  if (
    interaction.type !== "reveal" &&
    interaction.type !== "explore" &&
    interaction.type !== "sort"
  ) {
    return output;
  }
  if (
    blocks.length === 0 ||
    blocks.length !== interaction.items.length ||
    !interaction.items.every((item, index) =>
      isRevealItemRepresentedByBlock(item, blocks[index]),
    )
  ) {
    return output;
  }

  const root = findUniqueInteractionRoot(output, input.content);
  if (!root) return output;
  const blockRoots = blocks.map((block) =>
    findTagMatchesWithAttributes(output, {
      "data-block-id": block.id,
    }),
  );
  const itemRoots = interaction.items.map((item) =>
    findTagMatchesWithAttributes(output, {
      "data-interaction-item-id": item.id,
    }),
  );
  if (
    blockRoots.some((matches) => matches.length !== 1) ||
    itemRoots.some((matches) => matches.length !== 1) ||
    blockRoots.some(([marker]) =>
      isOpeningTagInsideElement(output, marker!, root),
    )
  ) {
    return output;
  }

  let html = blockRoots
    .flatMap((matches) => matches)
    .sort((left, right) => right.index - left.index)
    .reduce((document, marker) => removeElement(document, marker), output);
  html = removeEmptyBlockCollections(html);
  const currentRoot = findUniqueInteractionRoot(html, input.content);
  if (!currentRoot) return output;

  const mergedItems = blocks
    .map((block, index) => {
      const item = interaction.items[index]!;
      const label =
        block.label &&
        normalizeText(block.label) !== normalizeText(item.label)
          ? `<span data-keya-trusted-block-label="true">${escapeHtmlText(block.label)}</span>`
          : "";
      const points =
        block.supportingPoints.length > 0
          ? `<ul>${block.supportingPoints
              .map((point) => `<li>${escapeHtmlText(point)}</li>`)
              .join("")}</ul>`
          : "";
      return `<details class="keya-merged-interactive-block" data-block-id="${escapeHtmlAttribute(block.id)}" data-runtime-target-id="${escapeHtmlAttribute(block.id)}" data-interaction-item-id="${escapeHtmlAttribute(item.id)}"><summary>${escapeHtmlText(item.label)}</summary><div data-keya-merged-interactive-content="true">${label}<h2>${escapeHtmlText(block.heading)}</h2><p>${escapeHtmlText(block.body)}</p>${points}</div></details>`;
    })
    .join("");
  const sortControls =
    interaction.type === "sort"
      ? `<button type="button" data-runtime-submit="true">提交排序</button><div data-feedback-kind="success" hidden>${escapeHtmlText(interaction.feedback.success)}</div><div data-feedback-kind="retry" hidden>${escapeHtmlText(interaction.feedback.retry)}</div>`
      : "";

  return replaceElementInnerHtml(
    html,
    currentRoot,
    `<p data-course-contract-restored="interaction-prompt">${escapeHtmlText(interaction.prompt)}</p>${mergedItems}${sortControls}`,
  );
}

function removeEmptyBlockCollections(html: string) {
  return html.replace(
    /<(div|section|article)\b(?=[^>]*\bclass\s*=\s*(["'])[^"']*\b(?:blocks|block-list|block-grid|cards|card-grid)\b[^"']*\2)[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*<\/\1\s*>/gi,
    "",
  );
}

/**
 * 页面标题来自封口 DSL，不属于模型可改写的文案。pageId 根唯一且已有唯一
 * h1 时规范化其正文；模型完全漏掉 h1 时在主内容根起始处补入可信标题。
 * 多个 h1 的歧义结构仍交给严格校验，不猜测哪一个是主标题。
 */
export function normalizeTrustedPageTitle(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content">,
) {
  if (typeof output !== "string") return output;

  const pageRoots = findTagMatchesWithAttributes(output, {
    "data-page-id": input.content.pageId,
  });
  if (pageRoots.length !== 1) return output;
  const pageHtml = getElementHtml(output, pageRoots[0]!);
  if (!pageHtml) return output;

  const headings = [...pageHtml.matchAll(/<h1\b([^>]*)>[\s\S]*?<\/h1\s*>/gi)];
  if (headings.length === 0) {
    const matchingDisplayHeadings = [
      ...pageHtml.matchAll(
        /<(h[2-6])\b([^>]*)>[\s\S]*?<\/\1\s*>/gi,
      ),
    ].filter(
      (heading) =>
        normalizeText(normalizeVisibleText(heading[0])) ===
        normalizeText(input.content.title),
    );
    if (
      matchingDisplayHeadings.length === 1 &&
      matchingDisplayHeadings[0]!.index !== undefined
    ) {
      const heading = matchingDisplayHeadings[0]!;
      const originalOpening = `<${heading[1]}${heading[2] ?? ""}>`;
      const originalStyle =
        getAttributeValues(originalOpening, "style")[0]?.trim();
      const fallbackDisplayStyle = [
        originalStyle,
        "font-family:var(--course-font-heading,serif)",
        "font-weight:var(--course-font-weight-heading,800)",
        "font-size:clamp(2rem,7.5vw,5rem)",
        "line-height:.92",
        "letter-spacing:-.03em",
        "margin:0",
      ]
        .filter(Boolean)
        .join(";");
      const promotedOpening = setAttributeValue(
        setAttributeValue(
          originalOpening.replace(/^<h[2-6]/i, "<h1"),
          "data-keya-trusted-page-title",
          "true",
        ),
        "style",
        fallbackDisplayStyle,
      );
      const index = pageRoots[0]!.index + heading.index;
      const promoted = `${promotedOpening}${escapeHtmlText(input.content.title)}</h1>`;
      return (
        output.slice(0, index) +
        promoted +
        output.slice(index + heading[0].length)
      );
    }
    const insertionIndex = pageRoots[0]!.index + pageRoots[0]!.tag.length;
    const trustedHeading = `<h1 data-keya-trusted-page-title="true">${escapeHtmlText(input.content.title)}</h1>`;
    return (
      output.slice(0, insertionIndex) +
      trustedHeading +
      output.slice(insertionIndex)
    );
  }
  if (headings.length !== 1) return output;
  const heading = headings[0]!;
  if (heading.index === undefined) return output;
  const openingTag = `<h1${heading[1] ?? ""}>`;
  const normalizedHeading = `${openingTag}${escapeHtmlText(input.content.title)}</h1>`;
  const index = pageRoots[0]!.index + heading.index;

  return (
    output.slice(0, index) +
    normalizedHeading +
    output.slice(index + heading[0].length)
  );
}

/**
 * 正文合同恢复可能把 Markdown 反引号与等价的 <code> 文本误判为缺失并在
 * block 内追加重复内容。仅当删除恢复节点后，该 block 仍完整包含可信 DSL
 * 正文时移除它；真实缺失内容继续保留。
 */
export function removeRedundantRestoredDslMarkup(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content">,
) {
  if (typeof output !== "string") return output;

  let html = output;
  for (const block of input.content.blocks) {
    const blockMarkers = findTagMatchesWithAttributes(html, {
      "data-block-id": block.id,
    });
    if (blockMarkers.length !== 1) continue;
    const blockMarker = blockMarkers[0]!;
    const blockHtml = getElementHtml(html, blockMarker);
    if (!blockHtml) continue;
    const restored = findTagMatchesWithAttributes(blockHtml, {
      "data-course-contract-restored": "block",
    });
    if (restored.length === 0) continue;

    let candidate = html;
    for (const marker of [...restored].sort(
      (left, right) => right.index - left.index,
    )) {
      candidate = removeElement(candidate, {
        ...marker,
        index: blockMarker.index + marker.index,
      });
    }
    const candidateBlock = findTagMatchesWithAttributes(candidate, {
      "data-block-id": block.id,
    });
    if (candidateBlock.length !== 1) continue;
    const candidateHtml = getElementHtml(candidate, candidateBlock[0]!);
    if (!candidateHtml) continue;
    const visible = normalizeVisibleText(candidateHtml);
    if (
      [block.heading, block.body, ...block.supportingPoints].every((text) =>
        containsTrustedText(visible, text),
      )
    ) {
      html = candidate;
    }
  }

  return html;
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

function replaceElementInnerHtml(
  html: string,
  marker: OpeningTagMatch,
  innerHtml: string,
) {
  const element = getElementHtml(html, marker);
  const tagName = marker.tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1];
  if (!element || !tagName) return html;

  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const closing = new RegExp(`</${escapedTagName}\\s*>\\s*$`, "i").exec(
    element,
  );
  if (closing?.index === undefined) return html;
  const start = marker.index + marker.tag.length;
  const end = marker.index + closing.index;
  return `${html.slice(0, start)}${innerHtml}${html.slice(end)}`;
}

function removeElement(html: string, marker: OpeningTagMatch) {
  const element = getElementHtml(html, marker);
  if (!element) return html;
  return `${html.slice(0, marker.index)}${html.slice(marker.index + element.length)}`;
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * 模型遗漏 reveal 根标记时，只在完整 details/summary 结构存在唯一公共容器
 * 时补齐当前运行时要求的 type 与 id；不完整或静态伪互动仍交给严格校验拒绝。
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
        !containsTrustedText(visibleText, block.heading) ||
        !containsTrustedText(visibleText, block.body)
      );
    })
  ) {
    return output;
  }

  const detailMarkers = details.flatMap((match) => {
    const tag = match[0].match(/^<details\b[^>]*>/i)?.[0];
    return match.index === undefined || !tag
      ? []
      : [{ index: match.index, tag }];
  });
  const candidates = findTagMatchesWithAttributes(output, {})
    .filter(({ tag }) => /^<(?:main|section|article|div|form)\b/i.test(tag))
    .map((marker) => ({
      marker,
      element: getElementHtml(output, marker),
    }))
    .filter(
      (
        candidate,
      ): candidate is { marker: OpeningTagMatch; element: string } =>
        Boolean(candidate.element) &&
        detailMarkers.every((detail) =>
          isOpeningTagInsideElement(output, detail, candidate.marker),
        ),
    )
    .sort((left, right) => left.element.length - right.element.length);
  if (
    candidates.length === 0 ||
    (candidates[1] &&
      candidates[0]!.element.length === candidates[1].element.length)
  ) {
    return output;
  }

  const root = candidates[0]!.marker;
  return replaceOpeningTag(
    output,
    root,
    setAttributeValue(
      setAttributeValue(root.tag, "data-interaction-type", "reveal"),
      "data-interaction-id",
      `interaction-${input.content.pageId}`,
    ),
  );
}

/**
 * reveal 的 item id 只承担平台运行时定位职责。模型已经逐项生成完整原生
 * 控件、却漏掉 id 时，按 DSL 的 label 与 content 唯一定位最小控件根并补齐；
 * 任何文本不完整、候选重叠或一项多解都保持原样交给严格校验。
 */
export function normalizeRevealRuntimeMarkers(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (
    typeof output !== "string" ||
    input.content.interaction.type !== "reveal"
  ) {
    return output;
  }

  const root = findUniqueInteractionRoot(output, input.content);
  if (!root) return output;
  const interaction = input.content.interaction;
  const allTags = findTagMatchesWithAttributes(output, {});
  const resolved = interaction.items.map((item) => {
    const existing = findTagMatchesWithAttributes(output, {
      "data-interaction-item-id": item.id,
    }).filter((marker) => isOpeningTagInsideElement(output, marker, root));
    if (existing.length === 1) return existing[0];
    if (existing.length > 1) return undefined;

    const candidates = allTags
      .filter(
        (marker) =>
          marker.index !== root.index &&
          /^(?:<details|<section|<article|<div|<li|<button)\b/i.test(
            marker.tag,
          ) &&
          isOpeningTagInsideElement(output, marker, root) &&
          getAttributeValues(marker.tag, "data-interaction-item-id").length ===
            0,
      )
      .map((marker) => ({
        marker,
        element: getElementHtml(output, marker),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          marker: OpeningTagMatch;
          element: string;
        } => Boolean(candidate.element),
      )
      .filter(({ element }) => {
        const visible = normalizeVisibleText(element);
        return (
          containsTrustedText(visible, item.label) &&
          containsTrustedText(visible, item.content)
        );
      })
      .sort((left, right) => left.element.length - right.element.length);
    if (
      candidates.length === 0 ||
      (candidates[1] &&
        candidates[0]!.element.length === candidates[1].element.length)
    ) {
      return undefined;
    }
    return candidates[0]!.marker;
  });
  if (
    resolved.some((marker) => !marker) ||
    new Set(resolved.map((marker) => marker!.index)).size !== resolved.length
  ) {
    return output;
  }

  return resolved
    .map((marker, index) => ({
      marker: marker!,
      item: interaction.items[index]!,
    }))
    .filter(
      ({ marker, item }) =>
        !hasAttributeValue(
          marker.tag,
          "data-interaction-item-id",
          item.id,
        ),
    )
    .sort((left, right) => right.marker.index - left.marker.index)
    .reduce(
      (html, { marker, item }) =>
        replaceOpeningTag(
          html,
          marker,
          setAttributeValue(
            marker.tag,
            "data-interaction-item-id",
            item.id,
          ),
        ),
      output,
    );
}

/**
 * 豆包偶尔会把 choice 标记放到每道题上，或只漏掉互动区 id。只有当 DSL 的
 * 全部原生选项都能唯一定位，且存在唯一最小公共可提交容器时，才把该容器
 * 规范为唯一互动根；任何分叉或重复选项都会保留原样交给严格校验。
 */
export function normalizeChoiceInteractionRoot(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content"> &
    Partial<Omit<HtmlEngineerInput, "content">>,
) {
  if (
    typeof output !== "string" ||
    input.content.interaction.type !== "choice"
  ) {
    return output;
  }

  const html = output;
  const interaction = input.content.interaction;
  const expectedId = `interaction-${input.content.pageId}`;
  const main = findTagMatchesWithAttributes(html, {
    "data-page-id": input.content.pageId,
  }).filter(({ tag }) => /^<main\b/i.test(tag));
  if (main.length !== 1) return html;

  const optionIds = interaction.questions.flatMap(({ options }) =>
    options.map(({ id }) => id),
  );
  if (
    optionIds.length === 0 ||
    optionIds.some(
      (optionId) =>
        findTagMatchesWithAttributes(html, { value: optionId }).filter(
          ({ tag }) => /^<input\b/i.test(tag),
        ).length !== 1,
    )
  ) {
    return html;
  }

  const allTags = findTagMatchesWithAttributes(html, {});
  const choiceMarkers = allTags.filter(({ tag }) =>
    hasAttributeValue(tag, "data-interaction-type", "choice"),
  );
  const expectedIdMarkers = allTags.filter(({ tag }) =>
    hasAttributeValue(tag, "data-interaction-id", expectedId),
  );
  if (
    expectedIdMarkers.some(
      ({ tag }) =>
        getAttributeValues(tag, "data-interaction-type").some(
          (type) => type !== "choice",
        ),
    )
  ) {
    return html;
  }

  const relatedMarkers = [
    ...new Map(
      [...choiceMarkers, ...expectedIdMarkers].map((marker) => [
        marker.index,
        marker,
      ]),
    ).values(),
  ];
  const isWithin = (child: OpeningTagMatch, parent: OpeningTagMatch) =>
    child.index === parent.index ||
    isOpeningTagInsideElement(html, child, parent);
  const candidates = allTags
    .filter(
      (marker) =>
        /^(?:<main|<form|<section|<article|<div|<fieldset)\b/i.test(
          marker.tag,
        ) &&
        isWithin(marker, main[0]),
    )
    .map((marker) => ({
      marker,
      element: getElementHtml(html, marker),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        marker: OpeningTagMatch;
        element: string;
      } => Boolean(candidate.element),
    )
    .filter(
      ({ marker, element }) =>
        optionIds.every(
          (optionId) =>
            findTagMatchesWithAttributes(element, { value: optionId }).filter(
              ({ tag }) => /^<input\b/i.test(tag),
            ).length === 1,
        ) &&
        findTagMatchesWithAttributes(element, {}).some(({ tag }) =>
          /^<button\b/i.test(tag),
        ) &&
        relatedMarkers.every((related) => isWithin(related, marker)),
    );
  const smallestLength = Math.min(
    ...candidates.map(({ element }) => element.length),
  );
  const smallest = candidates.filter(
    ({ element }) => element.length === smallestLength,
  );
  if (smallest.length !== 1) return html;

  const root = smallest[0].marker;
  let normalized = html;
  for (const marker of [...relatedMarkers]
    .filter(({ index }) => index !== root.index)
    .sort((left, right) => right.index - left.index)) {
    normalized = replaceOpeningTag(
      normalized,
      marker,
      removeAttribute(
        removeAttribute(marker.tag, "data-interaction-type"),
        "data-interaction-id",
      ),
    );
  }

  return replaceOpeningTag(
    normalized,
    root,
    setAttributeValue(
      setAttributeValue(
        root.tag,
        "data-interaction-type",
        "choice",
      ),
      "data-interaction-id",
      expectedId,
    ),
  );
}

/**
 * choice 页面只对能够从已校验 DSL 与现有原生控件唯一证明的节点补运行时
 * 元数据。题目与选项从不创建；当全部题目控件已经完整时，缺失或重复的
 * 页面级提交按钮可按可信运行时合同机械收敛为一个。
 */
export function normalizeChoiceRuntimeMarkers(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content"> &
    Partial<Omit<HtmlEngineerInput, "content">>,
) {
  if (
    typeof output !== "string" ||
    input.content.interaction.type !== "choice"
  ) {
    return output;
  }

  let html = output;
  const interaction = input.content.interaction;
  for (const question of interaction.questions) {
    let root = findUniqueInteractionRoot(html, input.content);
    if (!root) return html;
    const otherOptionIds = new Set(
      interaction.questions
        .filter(({ id }) => id !== question.id)
        .flatMap(({ options }) => options.map(({ id }) => id)),
    );
    const containsOnlyQuestionOptions = (element: string) =>
      question.options.every(({ id }) => hasInputValue(element, id)) &&
      [...otherOptionIds].every(
        (optionId) => !hasInputValue(element, optionId),
      );
    const isQuestionScope = (marker: OpeningTagMatch) =>
      isOpeningTagInsideElement(html, marker, root!) ||
      (interaction.questions.length === 1 &&
        marker.index === root!.index);
    const existing = findTagMatchesWithAttributes(html, {
      "data-question-id": question.id,
    }).filter(isQuestionScope);
    if (existing.length > 1) return html;
    if (existing.length === 1) {
      const existingElement = getElementHtml(html, existing[0]);
      if (existingElement && containsOnlyQuestionOptions(existingElement)) {
        continue;
      }
      html = replaceOpeningTag(
        html,
        existing[0],
        removeAttribute(existing[0].tag, "data-question-id"),
      );
      root = findUniqueInteractionRoot(html, input.content);
      if (!root) return html;
    }

    const candidates = findTagMatchesWithAttributes(html, {})
      .filter(
        (marker) =>
          /^(?:<form|<fieldset|<section|<article|<div|<li)\b/i.test(
            marker.tag,
          ) &&
          (isOpeningTagInsideElement(html, marker, root) ||
            (interaction.questions.length === 1 &&
              marker.index === root.index)),
      )
      .map((marker) => ({
        marker,
        element: getElementHtml(html, marker),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          marker: OpeningTagMatch;
          element: string;
        } => Boolean(candidate.element),
      )
      .filter(({ element }) => containsOnlyQuestionOptions(element));
    const smallestLength = Math.min(
      ...candidates.map(({ element }) => element.length),
    );
    const smallest = candidates.filter(
      ({ element }) => element.length === smallestLength,
    );
    if (smallest.length !== 1) return html;

    html = replaceOpeningTag(
      html,
      smallest[0].marker,
      setAttributeValue(
        smallest[0].marker.tag,
        "data-question-id",
        question.id,
      ),
    );
    if (!containsTrustedText(normalizeVisibleText(html), question.prompt)) {
      const normalizedRoot = findUniqueInteractionRoot(
        html,
        input.content,
      );
      if (!normalizedRoot) return html;
      const questionRoot = findTagMatchesWithAttributes(html, {
        "data-question-id": question.id,
      }).find(
        (marker) =>
          isOpeningTagInsideElement(html, marker, normalizedRoot) ||
          (interaction.questions.length === 1 &&
            marker.index === normalizedRoot.index),
      );
      if (!questionRoot) return html;
      html = insertAfterOpeningTag(
        html,
        questionRoot,
        `<p data-runtime-question-prompt="${escapeHtmlAttribute(question.id)}">${escapeHtmlText(question.prompt)}</p>`,
      );
    }
  }

  let root = findUniqueInteractionRoot(html, input.content);
  if (!root) return html;
  let rootHtml = getElementHtml(html, root);
  if (!rootHtml) return html;
  const submitMarkers = findTagMatchesWithAttributes(rootHtml, {
    "data-runtime-submit": "true",
  });
  if (submitMarkers.length !== 1) {
    const interactionRoot = root;
    const buttons = findTagMatchesWithAttributes(html, {})
      .filter(
        (marker) =>
          /^<button\b/i.test(marker.tag) &&
          isOpeningTagInsideElement(html, marker, interactionRoot),
      )
      .map((marker) => ({
        marker,
        element: getElementHtml(html, marker),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          marker: OpeningTagMatch;
          element: string;
        } => Boolean(candidate.element),
      );
    const completeQuestions = hasCompleteChoiceQuestionStructure(
      rootHtml,
      interaction,
    );
    const submitCandidates = buttons.filter(({ marker, element }) =>
      /(?:提交|确认|检查|验证|完成|作答|答案|submit|check|confirm|answer)/i.test(
        [
          normalizeVisibleText(element),
          ...["aria-label", "id", "class", "name", "value", "title"].flatMap(
            (attribute) => getAttributeValues(marker.tag, attribute),
          ),
        ].join(" "),
      ),
    );

    if (completeQuestions) {
      const removableButtons = buttons.filter(
        ({ marker }) =>
          hasAttributeValue(marker.tag, "data-runtime-submit", "true") ||
          submitCandidates.some(
            ({ marker: candidate }) => candidate.index === marker.index,
          ),
      );
      for (const candidate of [...removableButtons].reverse()) {
        html = removeElement(html, candidate.marker);
      }
      root = findUniqueInteractionRoot(html, input.content);
      if (!root) return html;
      html = insertBeforeElementClose(
        html,
        root,
        '<button type="button" data-runtime-submit="true">提交答案</button>',
      );
    } else {
      if (submitMarkers.length > 1) return html;
      if (buttons.length !== 1 || submitCandidates.length !== 1) return html;
      html = replaceOpeningTag(
        html,
        submitCandidates[0].marker,
        setAttributeValue(
          submitCandidates[0].marker.tag,
          "data-runtime-submit",
          "true",
        ),
      );
    }
  }

  for (const kind of ["success", "retry"] as const) {
    root = findUniqueInteractionRoot(html, input.content);
    if (!root) return html;
    rootHtml = getElementHtml(html, root);
    if (!rootHtml) return html;
    const feedback = findTagMatchesWithAttributes(rootHtml, {
      "data-feedback-kind": kind,
    });
    if (feedback.length > 1) return html;
    if (feedback.length === 1) {
      if (!/\shidden(?:\s|=|\/?>)/i.test(feedback[0].tag)) {
        const globalMarker = {
          ...feedback[0],
          index: root.index + feedback[0].index,
        };
        html = replaceOpeningTag(
          html,
          globalMarker,
          setAttributeValue(feedback[0].tag, "hidden", "hidden"),
        );
      }
      continue;
    }

    const text = [
      ...new Set(
        interaction.questions.map(
          (question) => question.feedback[kind],
        ),
      ),
    ].join(" ");
    html = insertBeforeElementClose(
      html,
      root,
      `<div data-feedback-kind="${kind}" hidden>${escapeHtmlText(text)}</div>`,
    );
  }

  return html;
}

export function findUniqueInteractionRoot(
  html: string,
  content: PageContentDSL,
) {
  if (content.interaction.type === "none") return undefined;
  const roots = findTagMatchesWithAttributes(html, {
    "data-interaction-type": content.interaction.type,
    "data-interaction-id": `interaction-${content.pageId}`,
  });
  return roots.length === 1 ? roots[0] : undefined;
}

function hasInputValue(html: string, value: string) {
  return findTagMatchesWithAttributes(html, { value }).some(({ tag }) =>
    /^<input\b/i.test(tag),
  );
}

function hasCompleteChoiceQuestionStructure(
  rootHtml: string,
  interaction: Extract<
    PageContentDSL["interaction"],
    { type: "choice" }
  >,
) {
  return interaction.questions.every(
    (question) =>
      findTagMatchesWithAttributes(rootHtml, {
        "data-question-id": question.id,
      }).length === 1 &&
      question.options.every(({ id }) => hasInputValue(rootHtml, id)),
  );
}

/**
 * visualPrimitive 是可信 DSL 的展示元数据。豆包偶尔已经生成完整的代码原生
 * 互动图示，却只漏掉该属性；此处只在唯一、可证明的图示根节点上补齐标记，
 * 不生成新教学内容，也不把图片素材冒充代码原生图示。
 */
export function normalizeVisualPrimitiveMarker(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (
    typeof output !== "string" ||
    input.content.runtime.visualPrimitive === "none"
  ) {
    return output;
  }

  const expected = input.content.runtime.visualPrimitive;
  const allTags = findTagMatchesWithAttributes(output, {});
  const mainMarkers = findTagMatchesWithAttributes(output, {
    "data-page-id": input.content.pageId,
  }).filter(({ tag }) => /^<main\b/i.test(tag));
  if (mainMarkers.length !== 1) return output;
  const main = mainMarkers[0];
  const assetMarkers = input.content.assetSlots.flatMap(({ id }) =>
    findTagMatchesWithAttributes(output, {
      "data-asset-slot-id": id,
    }),
  );
  const isTrustedCandidate = (marker: OpeningTagMatch) =>
    isOpeningTagInsideElement(output, marker, main) &&
    !assetMarkers.some(
      (assetMarker) =>
        marker.index === assetMarker.index ||
        (assetMarker.index !== main.index &&
          isOpeningTagInsideElement(output, marker, assetMarker)),
    );

  const exact = findTagMatchesWithAttributes(output, {
    "data-visual-primitive": expected,
  }).filter(isTrustedCandidate);
  if (exact.length === 1) return output;

  const declared = allTags.filter(
    ({ tag }) => getAttributeValues(tag, "data-visual-primitive").length > 0,
  );
  if (declared.length === 1) {
    if (!isTrustedCandidate(declared[0]!)) {
      const cleaned = replaceOpeningTag(
        output,
        declared[0]!,
        removeAttribute(
          declared[0]!.tag,
          "data-visual-primitive",
        ),
      );
      return normalizeVisualPrimitiveMarker(cleaned, input);
    }
    const declaredValue = getAttributeValues(
      declared[0].tag,
      "data-visual-primitive",
    )[0];
    if (normalizeVisualPrimitiveValue(declaredValue) !== expected) {
      return output;
    }
    return replaceOpeningTag(
      output,
      declared[0],
      setAttributeValue(
        declared[0].tag,
        "data-visual-primitive",
        expected,
      ),
    );
  }
  if (declared.length > 1) return output;

  const semanticCandidates = allTags.filter(
    (marker) =>
      isTrustedCandidate(marker) &&
      isVisualPrimitiveSemanticCandidate(marker.tag, expected) &&
      hasCodeNativeVisualStructure(output, marker, input.content),
  );
  if (semanticCandidates.length === 1) {
    return replaceOpeningTag(
      output,
      semanticCandidates[0],
      setAttributeValue(
        semanticCandidates[0].tag,
        "data-visual-primitive",
        expected,
      ),
    );
  }

  const interactionContainer = findVisualInteractionContainer(
    output,
    allTags,
    input.content,
    isTrustedCandidate,
  );
  if (interactionContainer) {
    return replaceOpeningTag(
      output,
      interactionContainer,
      setAttributeValue(
        interactionContainer.tag,
        "data-visual-primitive",
        expected,
      ),
    );
  }

  const blockContainer = findVisualBlockContainer(
    output,
    allTags,
    input.content,
    isTrustedCandidate,
  );
  if (blockContainer) {
    return replaceOpeningTag(
      output,
      blockContainer,
      setAttributeValue(
        blockContainer.tag,
        "data-visual-primitive",
        expected,
      ),
    );
  }

  const fallback = buildVisualPrimitiveFallback(input.content, expected);
  return fallback
    ? insertBeforeElementClose(output, main, fallback)
    : output;
}

/**
 * timeline/comparison 等页面常把代码原生图示直接实现成一组可操作节点。只在
 * 全部稳定 interaction item 都唯一存在时，选择包含它们的最小非素材容器；
 * 外层互动区和单个 item 都不会被误标。
 */
function findVisualInteractionContainer(
  html: string,
  allTags: OpeningTagMatch[],
  content: PageContentDSL,
  isTrustedCandidate: (marker: OpeningTagMatch) => boolean,
) {
  const itemIds =
    content.interaction.type === "reveal" ||
    content.interaction.type === "explore" ||
    content.interaction.type === "sort"
      ? content.interaction.items.map(({ id }) => id)
      : [];
  if (itemIds.length < 2) return undefined;

  const itemMarkers = itemIds.map((id) =>
    findTagMatchesWithAttributes(html, {
      "data-interaction-item-id": id,
    }),
  );
  if (itemMarkers.some((markers) => markers.length !== 1)) return undefined;
  const items = itemMarkers.map(([marker]) => marker!);
  const candidates = allTags
    .filter(
      (marker) =>
        /^(?:<section|<div|<figure|<ol|<ul)\b/i.test(marker.tag) &&
        isTrustedCandidate(marker) &&
        items.every((item) =>
          isOpeningTagInsideElement(html, item, marker),
        ),
    )
    .map((marker) => ({
      marker,
      size: getElementHtml(html, marker)?.length ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.size - right.size);
  if (
    candidates.length === 0 ||
    (candidates[1] && candidates[0]!.size === candidates[1].size)
  ) {
    return undefined;
  }
  return candidates[0]!.marker;
}

/**
 * comparison、process 等页面常已用稳定内容块构成代码原生图示，只是模型把
 * primitive 错标在图片上或漏标。若至少两个 block 都唯一存在，则选择完整
 * 包含它们的最小非素材容器作为图示根，避免再追加一份重复的兜底摘要。
 */
function findVisualBlockContainer(
  html: string,
  allTags: OpeningTagMatch[],
  content: PageContentDSL,
  isTrustedCandidate: (marker: OpeningTagMatch) => boolean,
) {
  if (content.blocks.length < 2) return undefined;
  const blockMarkers = content.blocks.map(({ id }) =>
    findTagMatchesWithAttributes(html, {
      "data-block-id": id,
    }),
  );
  if (blockMarkers.some((markers) => markers.length !== 1)) return undefined;
  const blocks = blockMarkers.map(([marker]) => marker!);
  const candidates = allTags
    .filter(
      (marker) =>
        /^(?:<section|<div|<figure|<article|<ol|<ul)\b/i.test(
          marker.tag,
        ) &&
        isTrustedCandidate(marker) &&
        !blocks.some(({ index }) => index === marker.index) &&
        blocks.every((block) =>
          isOpeningTagInsideElement(html, block, marker),
        ),
    )
    .map((marker) => ({
      marker,
      size: getElementHtml(html, marker)?.length ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.size - right.size);
  if (
    candidates.length === 0 ||
    (candidates[1] && candidates[0]!.size === candidates[1].size)
  ) {
    return undefined;
  }
  return candidates[0]!.marker;
}

function buildVisualPrimitiveFallback(
  content: PageContentDSL,
  primitive: NonNullable<PageContentDSL["runtime"]>["visualPrimitive"],
) {
  if (
    !["concept-map", "process", "comparison", "timeline"].includes(primitive) ||
    content.blocks.length < 2
  ) {
    return undefined;
  }
  const listTag =
    primitive === "process" || primitive === "timeline" ? "ol" : "ul";
  const labels = content.blocks
    .slice(0, 6)
    .map(({ label, heading }) => label ?? heading);

  return `<section class="course-native-visual course-native-visual--${primitive}" data-visual-primitive="${primitive}" data-course-contract-restored="visual-primitive" aria-label="${escapeHtmlAttribute(content.title)}知识结构"><${listTag}>${labels
    .map((label) => `<li>${escapeHtmlText(label)}</li>`)
    .join("")}</${listTag}></section>`;
}

function normalizeVisualPrimitiveValue(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function isVisualPrimitiveSemanticCandidate(
  tag: string,
  primitive: NonNullable<PageContentDSL["runtime"]>["visualPrimitive"],
) {
  if (
    !/^<(?:section|div|figure|svg|ol|ul)\b/i.test(tag) ||
    getAttributeValues(tag, "data-asset-slot-id").length > 0
  ) {
    return false;
  }

  const identifier = [
    ...getAttributeValues(tag, "id"),
    ...getAttributeValues(tag, "class"),
  ]
    .join(" ")
    .toLowerCase();
  const patterns = {
    "concept-map": /(?:concept|mind|knowledge)[-_ ]?(?:map|graph)|card[-_ ]?map/,
    "function-graph": /(?:function|equation)[-_ ]?(?:graph|plot)|graph[-_ ]?canvas/,
    venn: /(?:^|[-_ ])venn(?:$|[-_ ])/,
    timeline: /(?:^|[-_ ])time[-_ ]?line(?:$|[-_ ])/,
    process: /(?:^|[-_ ])(?:process|flow|steps?)(?:$|[-_ ])/,
    comparison: /(?:^|[-_ ])(?:comparison|compare)(?:$|[-_ ])/,
    none: /$^/,
  } as const;

  return patterns[primitive].test(identifier);
}

function hasCodeNativeVisualStructure(
  html: string,
  marker: OpeningTagMatch,
  content: PageContentDSL,
) {
  const element = getElementHtml(html, marker);
  if (!element) return false;
  const visible = normalizeVisibleText(element);
  const matchedLabels = content.blocks.filter((block) =>
    [block.label, block.heading]
      .filter((value): value is string => Boolean(value))
      .some((value) => visible.includes(normalizeText(value))),
  ).length;
  const structuralChildren = findTagMatchesWithAttributes(element, {}).filter(
    ({ index, tag }) =>
      index > 0 &&
      !/^<(?:img|source|br|hr|input|meta|link)\b/i.test(tag),
  );

  return (
    matchedLabels >= Math.min(2, content.blocks.length) &&
    structuralChildren.length >= 2
  );
}

function replaceOpeningTag(
  html: string,
  marker: OpeningTagMatch,
  replacement: string,
) {
  return (
    html.slice(0, marker.index) +
    replacement +
    html.slice(marker.index + marker.tag.length)
  );
}

function insertAfterOpeningTag(
  html: string,
  marker: OpeningTagMatch,
  markup: string,
) {
  const index = marker.index + marker.tag.length;
  return `${html.slice(0, index)}${markup}${html.slice(index)}`;
}

export function removeAttribute(tag: string, attribute: string) {
  const escapedAttribute = attribute.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return tag.replace(
    new RegExp(
      `\\s+${escapedAttribute}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s'"=<>\\u0060]+))?`,
      "i",
    ),
    "",
  );
}

export function setAttributeValue(
  tag: string,
  attribute: string,
  value: string,
) {
  const escapedAttribute = attribute.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const attributePattern = new RegExp(
    `\\s+${escapedAttribute}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s'"=<>\\u0060]+)`,
    "i",
  );
  const withoutExisting = tag.replace(attributePattern, "");
  return withoutExisting.replace(
    /\s*(\/?>)$/,
    ` ${attribute}="${escapeHtmlAttribute(value)}"$1`,
  );
}

/**
 * 素材的可访问名称来自服务端已批准的 Asset.altText。模型常会做同义改写，
 * 导致相同输入在重试时重复失败；这里只规范化已经唯一绑定的 img 或 CSS
 * consumer，再交给原严格校验器复验。
 */
export function normalizeReadyCssBackgroundAccessibility(
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
    const altText = result.asset.altText ?? "";
    if (directImage) {
      html = replaceOpeningTagAt(
        html,
        marker.index,
        marker.tag,
        setAttributeValue(marker.tag, "alt", altText),
      );
      continue;
    }
    if (descendantImage) {
      const elementHtml = getElementHtml(html, marker);
      const localIndex = elementHtml?.indexOf(descendantImage) ?? -1;
      if (localIndex >= 0) {
        const index = marker.index + localIndex;
        html = replaceOpeningTagAt(
          html,
          index,
          descendantImage,
          setAttributeValue(descendantImage, "alt", altText),
        );
      }
      continue;
    }

    const cssConsumer = findReadyCssAssetConsumer(
      html,
      marker,
      result.asset.uri,
    );
    if (!cssConsumer) continue;

    if (hasAccessibleBackgroundContract(cssConsumer.tag, altText)) continue;

    const normalizedTag = setBackgroundAccessibility(cssConsumer.tag, altText);
    html =
      html.slice(0, cssConsumer.index) +
      normalizedTag +
      html.slice(cssConsumer.index + cssConsumer.tag.length);
  }

  return html;
}

function replaceOpeningTagAt(
  html: string,
  index: number,
  currentTag: string,
  nextTag: string,
) {
  return (
    html.slice(0, index) +
    nextTag +
    html.slice(index + currentTag.length)
  );
}
