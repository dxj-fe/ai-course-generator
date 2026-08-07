import { AiSchemaValidationError } from "@/server/infra/ai/error";
import type { PageContentDSL } from "@/shared/course-schema";
import { sanitizeHtmlLite, validateGeneratedHtmlContract } from "@/shared/html-preview";

import {
  findTagMatchesWithAttributes,
  getElementHtml,
  hasDataAttribute,
  isOpeningTagInsideElement,
  validateAssetReferences,
  type OpeningTagMatch,
} from "./html-engineer-dom-assets";
import type { HtmlEngineerInput } from "./html-engineer-model-step";
import { findUniqueInteractionRoot } from "./html-engineer-normalizers";
import { collectRequiredStaticContentText } from "./html-engineer-content-text";
import {
  containsTrustedText,
  normalizeText,
  normalizeVisibleText,
} from "./html-engineer-text";

const MAX_GENERATED_HTML_LENGTH = 200_000;

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
  validateSingleCoursePageCanvas(html, issues);
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
  validateStableMarkupStructure(html, input.content, issues);
  validateTrustedRuntimeMarkup(html, input, issues);

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

/** frontend-slides 的设计语言和 16:9 比例可以复用，但多页 deck 控制器与单页播放器冲突。 */
function validateSingleCoursePageCanvas(html: string, issues: string[]) {
  const hasDeckScaffold =
    /(?:class\s*=\s*["'][^"']*\bdeck-(?:viewport|stage|controls)\b|<deck-stage\b)/i.test(
      html,
    );
  const hasFixedSlideCanvas =
    /(?:width\s*:\s*1920px|height\s*:\s*1080px)/i.test(html);

  if (hasDeckScaffold || hasFixedSlideCanvas) {
    issues.push(
      "当前交付物是单个 16:9 课程页面，不得复制 frontend-slides 的多页 deck 脚手架、导航控制器或作者脚本；舞台缩放由平台运行时负责。",
    );
  }
}

function validateTrustedRuntimeMarkup(
  html: string,
  input: HtmlEngineerInput,
  issues: string[],
) {
  const { content } = input;
  for (const block of content.blocks) {
    const markers = findTagMatchesWithAttributes(html, {
      "data-block-id": block.id,
      "data-runtime-target-id": block.id,
    });
    if (markers.length !== 1) {
      issues.push(
        `PageContentDSL 内容块 ${block.id} 必须声明同值 data-runtime-target-id。`,
      );
    }
  }

  const interaction = content.interaction;
  if (interaction.type === "none") return;
  const interactionId = `interaction-${content.pageId}`;
  const roots = findTagMatchesWithAttributes(html, {
    "data-interaction-type": interaction.type,
    "data-interaction-id": interactionId,
  });
  if (roots.length !== 1) {
    issues.push(
      `真实互动区必须声明 data-interaction-id="${interactionId}"。`,
    );
    return;
  }
  const interactionHtml = getElementHtml(html, roots[0]);
  if (!interactionHtml) {
    issues.push("真实互动区必须是结构完整的 HTML 元素。");
    return;
  }

  if (
    interaction.type === "reveal" ||
    interaction.type === "explore" ||
    interaction.type === "sort"
  ) {
    for (const item of interaction.items) {
      if (
        findTagMatchesWithAttributes(interactionHtml, {
          "data-interaction-item-id": item.id,
        }).length !== 1
      ) {
        issues.push(`互动项 ${item.id} 缺少唯一 data-interaction-item-id。`);
      }
    }
  }

  if (
    ["choice", "sort", "input"].includes(interaction.type) &&
    findTagMatchesWithAttributes(interactionHtml, {
      "data-runtime-submit": "true",
    }).length !== 1
  ) {
    issues.push(
      `${interaction.type} 必须包含唯一 data-runtime-submit="true" 提交按钮。`,
    );
  }

  if (
    interaction.type === "input" &&
    findTagMatchesWithAttributes(interactionHtml, {
      "data-runtime-input": "true",
    }).filter(({ tag }) => /^<(?:input|textarea)\b/i.test(tag)).length !== 1
  ) {
    issues.push(
      'input 必须包含唯一带 data-runtime-input="true" 的 input 或 textarea。',
    );
  }

  if (interaction.type !== "choice") return;
  for (const question of interaction.questions) {
    const questionRoots = findTagMatchesWithAttributes(html, {
      "data-question-id": question.id,
    }).filter(
      (marker) =>
        isOpeningTagInsideElement(html, marker, roots[0]) ||
        (interaction.questions.length === 1 &&
          marker.index === roots[0].index),
    );
    if (questionRoots.length !== 1) {
      issues.push(`选择题 ${question.id} 缺少唯一 data-question-id。`);
      continue;
    }
    const questionHtml = getElementHtml(html, questionRoots[0]);
    if (!questionHtml) {
      issues.push(`选择题 ${question.id} 的题目根节点结构不完整。`);
      continue;
    }
    if (
      findTagMatchesWithAttributes(questionHtml, {
        "data-question-id": question.id,
      }).length !== 1
    ) {
      issues.push(`选择题 ${question.id} 缺少唯一 data-question-id。`);
      continue;
    }
    for (const option of question.options) {
      const controls = findTagMatchesWithAttributes(questionHtml, {
        value: option.id,
      }).filter(({ tag }) => /^<input\b/i.test(tag));
      if (controls.length !== 1) {
        issues.push(`选项 ${option.id} 必须绑定唯一 input value。`);
      }
    }
  }

  for (const kind of ["success", "retry"] as const) {
    const feedback = findTagMatchesWithAttributes(interactionHtml, {
      "data-feedback-kind": kind,
    });
    if (
      feedback.length === 0 ||
      feedback.some(({ tag }) => !/\shidden(?:\s|=|\/?>)/i.test(tag))
    ) {
      issues.push(
        `choice 的 data-feedback-kind="${kind}" 反馈必须存在并初始 hidden。`,
      );
    }
  }
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
 * 稳定标记只承担运行时定位：唯一且位于 main 内。它们不再规定内容必须按
 * DSL 顺序落进等价 DOM 分组，避免技术合同反向锁死视觉构图。
 */
function validateStableMarkupStructure(
  html: string,
  content: PageContentDSL,
  issues: string[],
) {
  const mainMatches = [...html.matchAll(/<main\b[^>]*>/gi)].map((match) => ({
    index: match.index,
    tag: match[0],
  }));
  const main = mainMatches.length === 1 ? mainMatches[0] : undefined;
  const mainHtml = main ? getElementHtml(html, main) : undefined;
  const mainEnd = main && mainHtml ? main.index + mainHtml.length : undefined;
  const isInsideMain = (marker: OpeningTagMatch) =>
    main !== undefined &&
    mainEnd !== undefined &&
    marker.index >= main.index &&
    marker.index + marker.tag.length <= mainEnd;

  const pageMarkers = findTagMatchesWithAttributes(html, {
    "data-page-id": content.pageId,
  });
  if (
    pageMarkers.length !== 1 ||
    !main ||
    pageMarkers[0]!.index !== main.index
  ) {
    issues.push("data-page-id 必须且只能标记唯一 main 主内容区域。");
  }

  for (const block of content.blocks) {
    const markers = findTagMatchesWithAttributes(html, {
      "data-block-id": block.id,
    });
    if (markers.length !== 1 || !isInsideMain(markers[0]!)) {
      issues.push(
        `内容块 ${block.id} 必须且只能在 main 内有一个 data-block-id 根节点。`,
      );
    }
  }

  for (const slot of content.assetSlots) {
    const markers = findTagMatchesWithAttributes(html, {
      "data-asset-slot-id": slot.id,
    });
    if (markers.length !== 1 || !isInsideMain(markers[0]!)) {
      issues.push(
        `素材槽 ${slot.id} 必须且只能在 main 内有一个 data-asset-slot-id 根节点。`,
      );
    }
  }

  if (content.interaction.type === "none") return;
  const interactionMarkers = findTagMatchesWithAttributes(html, {
    "data-interaction-type": content.interaction.type,
  });
  if (interactionMarkers.length !== 1 || !isInsideMain(interactionMarkers[0]!)) {
    issues.push("真实互动区必须且只能在 main 内有一个稳定标记。");
    return;
  }

  const interactionHtml = getElementHtml(html, interactionMarkers[0]!);
  const interactionVisible = interactionHtml
    ? normalizeVisibleText(interactionHtml)
    : "";
  if (!interactionVisible) {
    issues.push("真实互动区标记不能是与教学内容分离的空容器。");
  }
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
  if (containsTrustedText(visibleText, requiredText)) return true;

  const interaction = content.interaction;
  if (
    (interaction.type === "reveal" ||
      interaction.type === "explore" ||
      interaction.type === "sort") &&
    requiredText === interaction.prompt &&
    content.narration.some((line) =>
      containsTrustedText(visibleText, line),
    )
  ) {
    return true;
  }

  if (
    interaction.type === "input" &&
    requiredText === interaction.placeholder
  ) {
    const roots = [findUniqueInteractionRoot(html, content)].filter(
      (marker): marker is OpeningTagMatch => Boolean(marker),
    );
    if (roots.length !== 1) return false;
    const interactionHtml = getElementHtml(html, roots[0]!);
    if (!interactionHtml) return false;

    return (
      findTagMatchesWithAttributes(interactionHtml, {
        placeholder: requiredText,
      }).filter(({ tag }) => /^<(?:input|textarea)\b/i.test(tag)).length === 1
    );
  }

  if (interaction.type !== "choice") return false;
  const questionIndex = interaction.questions.findIndex(
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
    blockHtml &&
      containsTrustedText(normalizeVisibleText(blockHtml), promptBody),
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
