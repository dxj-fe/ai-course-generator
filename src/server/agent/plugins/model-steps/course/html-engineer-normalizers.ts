import type { PageContentDSL } from "@/shared/course-schema";

import type { HtmlEngineerInput } from "./html-engineer-model-step";
import { collectRequiredStaticContentText } from "./html-engineer-content-text";
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

/**
 * DSL 正文是服务端事实，但缺失正文不能在布局完成后机械追加，否则会把
 * 本应重试的生成错误变成超长、重复页面。这里只清理旧恢复节点并转义模型
 * 原样输出的数学比较符；缺失内容交给严格校验反馈后重新生成整页。
 */
export function normalizeTrustedDslMarkup(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;

  const cleaned = removeRedundantRestoredDslMarkup(output, input);
  let html = typeof cleaned === "string" ? cleaned : output;
  const requiredText = collectRequiredStaticContentText(input.content);
  for (const text of requiredText) {
    if (/[&<>]/.test(text) && html.includes(text)) {
      html = html.replaceAll(text, escapeHtmlText(text));
    }
  }
  return html;
}

/**
 * 旧版正文恢复把 Markdown 反引号与等价的 <code> 文本误判为缺失，可能在
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
        !containsTrustedText(visibleText, block.heading) ||
        !containsTrustedText(visibleText, block.body)
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
    input.content.version !== 2 ||
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
        findTagMatchesWithAttributes(element, {}).some(
          ({ tag }) =>
            /^<button\b/i.test(tag) &&
            !/\sdisabled(?:\s|=|\/?>)/i.test(tag),
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
    input.content.version !== 2 ||
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
          /^(?:<fieldset|<section|<article|<div|<li)\b/i.test(
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
          !/\sdisabled(?:\s|=|\/?>)/i.test(marker.tag) &&
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
    input.content.version !== 2 ||
    !input.content.runtime ||
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
        isOpeningTagInsideElement(output, marker, assetMarker),
    );

  const exact = findTagMatchesWithAttributes(output, {
    "data-visual-primitive": expected,
  }).filter(isTrustedCandidate);
  if (exact.length === 1) return output;

  const declared = allTags.filter(
    ({ tag }) => getAttributeValues(tag, "data-visual-primitive").length > 0,
  );
  if (declared.length === 1) {
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

  const fallback = buildVisualPrimitiveFallback(input.content, expected);
  return fallback
    ? insertBeforeElementClose(output, main, fallback)
    : output;
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
 * CSS 背景的可访问名称来自服务端已批准的 Asset.altText。模型常会对
 * aria-label 做同义改写，导致相同输入在重试时重复失败；这里仅把已经
 * 唯一绑定到真实素材槽的 CSS consumer 规范化，再交给原严格校验器复验。
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
