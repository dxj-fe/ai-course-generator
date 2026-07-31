import type { PageContentDSL } from "@/shared/course-schema";

import {
  findTagMatchesWithAttributes,
  getElementHtml,
  isOpeningTagInsideElement,
  type OpeningTagMatch,
} from "./html-engineer-dom-assets";
import {
  containsTrustedText,
  normalizeVisibleText,
} from "./html-engineer-text";

/**
 * sort/input 的提交按钮属于平台运行时技术标记。模型已生成唯一、可操作且
 * 文案明确的原生按钮时，补齐 data-runtime-submit；多按钮或语义不明确时
 * 保持原样并交给严格合同拒绝，避免猜测哪个控件会提交学习结果。
 */
export function normalizeSubmissionRuntimeMarker(
  output: unknown,
  content: PageContentDSL,
) {
  if (
    typeof output !== "string" ||
    content.version !== 2 ||
    (content.interaction.type !== "sort" &&
      content.interaction.type !== "input")
  ) {
    return output;
  }

  const roots = findTagMatchesWithAttributes(output, {
    "data-interaction-id": `interaction-${content.pageId}`,
    "data-interaction-type": content.interaction.type,
  });
  if (roots.length !== 1) return output;
  const root = roots[0]!;
  const existing = findTagMatchesWithAttributes(output, {
    "data-runtime-submit": "true",
  }).filter((marker) =>
    isOpeningTagInsideElement(output, marker, root),
  );
  if (existing.length > 0) return output;

  const candidates = findTagMatchesWithAttributes(output, {})
    .filter(
      (marker) =>
        /^<button\b/i.test(marker.tag) &&
        !/\sdisabled(?:\s|=|\/?>)/i.test(marker.tag) &&
        isOpeningTagInsideElement(output, marker, root),
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
    .filter(({ element, marker }) =>
      /(?:提交|确认|检查|验证|完成|排序|submit|check|confirm|finish)/i.test(
        `${normalizeVisibleText(element)} ${marker.tag}`,
      ),
    );
  if (candidates.length !== 1) return output;

  const { marker } = candidates[0]!;
  const nextTag = setAttribute(
    marker.tag,
    "data-runtime-submit",
    "true",
  );
  return (
    output.slice(0, marker.index) +
    nextTag +
    output.slice(marker.index + marker.tag.length)
  );
}

/**
 * sort 的条件反馈在提交前不属于首屏内容。模型若已输出语义反馈容器，
 * 统一补齐 hidden；不创建缺失容器，运行时仍以 PageContentDSL 的反馈为准。
 */
export function normalizeConditionalFeedbackVisibility(
  output: unknown,
  content: PageContentDSL,
) {
  if (
    typeof output !== "string" ||
    (content.interaction.type !== "sort" &&
      content.interaction.type !== "input")
  ) {
    return output;
  }

  let html = output;
  for (const kind of ["success", "retry"] as const) {
    const roots = findTagMatchesWithAttributes(html, {
      "data-interaction-id": `interaction-${content.pageId}`,
      "data-interaction-type": content.interaction.type,
    });
    if (roots.length !== 1) return html;
    const feedback = findTagMatchesWithAttributes(html, {
      "data-feedback-kind": kind,
    }).filter((marker) =>
      isOpeningTagInsideElement(html, marker, roots[0]!),
    );
    if (
      feedback.length !== 1 ||
      /\shidden(?:\s|=|\/?>)/i.test(feedback[0]!.tag)
    ) {
      continue;
    }
    const marker = feedback[0]!;
    const nextTag = setAttribute(marker.tag, "hidden", "hidden");
    html =
      html.slice(0, marker.index) +
      nextTag +
      html.slice(marker.index + marker.tag.length);
  }
  return html;
}

/**
 * 密集 sort 项的说明需要可读、可拖动，也不能把固定画布撑成长列表。模型已
 * 生成完整普通卡片时，将每项收敛为可拖动的 details/summary：首屏展示排序
 * 标签，学习者仍可按需展开精确说明。已有原生 details 或多解结构保持不变。
 */
export function normalizeSortCardInteraction(
  output: unknown,
  content: PageContentDSL,
) {
  if (
    typeof output !== "string" ||
    content.version !== 2 ||
    content.interaction.type !== "sort"
  ) {
    return output;
  }

  const roots = findTagMatchesWithAttributes(output, {
    "data-interaction-id": `interaction-${content.pageId}`,
    "data-interaction-type": "sort",
  });
  if (roots.length !== 1) return output;
  const root = roots[0]!;
  const resolved = content.interaction.items.map((item) => {
    const markers = findTagMatchesWithAttributes(output, {
      "data-interaction-item-id": item.id,
    }).filter((marker) =>
      isOpeningTagInsideElement(output, marker, root),
    );
    if (markers.length !== 1) return undefined;
    const marker = markers[0]!;
    const element = getElementHtml(output, marker);
    if (!element) return undefined;
    const visible = normalizeVisibleText(element);
    if (
      !containsTrustedText(visible, item.label) ||
      !containsTrustedText(visible, item.content)
    ) {
      return undefined;
    }
    return {
      element,
      end: marker.index + element.length,
      item,
      marker,
      start: marker.index,
    };
  });
  if (resolved.some((item) => !item)) return output;

  const ranges = resolved
    .filter(
      (
        item,
      ): item is {
        element: string;
        end: number;
        item: (typeof content.interaction.items)[number];
        marker: OpeningTagMatch;
        start: number;
      } => Boolean(item),
    )
    .sort((left, right) => left.start - right.start);
  if (
    ranges.some(
      (item, index) =>
        index > 0 && ranges[index - 1]!.end > item.start,
    )
  ) {
    return output;
  }

  return [...ranges].reverse().reduce((html, current) => {
    if (/^<details\b/i.test(current.marker.tag)) return html;
    const details =
      `<details class="keya-trusted-sort-card" ` +
      `data-interaction-item-id="${escapeHtmlAttribute(current.item.id)}" ` +
      `data-course-contract-restored="sort-control">` +
      `<summary>${escapeHtmlText(current.item.label)}</summary>` +
      `<p>${escapeHtmlText(current.item.content)}</p>` +
      `</details>`;
    return (
      html.slice(0, current.start) +
      details +
      html.slice(current.end)
    );
  }, output);
}

/**
 * explore 必须是可逐项展开的真实原生控件。模型若已生成完整的普通卡片，
 * 将卡片无损包进 details/summary，并把稳定 item id 移到控件根；不完整、
 * 重叠或多解结构继续交给严格合同拒绝。
 */
export function normalizeExploreCardInteraction(
  output: unknown,
  content: PageContentDSL,
) {
  if (
    typeof output !== "string" ||
    content.interaction.type !== "explore" ||
    content.version !== 2
  ) {
    return output;
  }

  const interactionId = `interaction-${content.pageId}`;
  const roots = findTagMatchesWithAttributes(output, {
    "data-interaction-id": interactionId,
    "data-interaction-type": "explore",
  });
  if (roots.length !== 1) return output;
  const root = roots[0]!;

  const resolved = content.interaction.items.map((item) => {
    const markers = findTagMatchesWithAttributes(output, {
      "data-interaction-item-id": item.id,
    }).filter((marker) =>
      isOpeningTagInsideElement(output, marker, root),
    );
    if (markers.length !== 1) return undefined;
    const marker = markers[0]!;
    const element = getElementHtml(output, marker);
    if (!element) return undefined;
    const visible = normalizeVisibleText(element);
    if (
      !containsTrustedText(visible, item.label) ||
      !containsTrustedText(visible, item.content)
    ) {
      return undefined;
    }
    return {
      element,
      end: marker.index + element.length,
      item,
      marker,
      start: marker.index,
    };
  });
  if (resolved.some((item) => !item)) return output;

  const ranges = resolved
    .filter(
      (
        item,
      ): item is {
        element: string;
        end: number;
        item: (typeof content.interaction.items)[number];
        marker: OpeningTagMatch;
        start: number;
      } => Boolean(item),
    )
    .sort((left, right) => left.start - right.start);
  if (
    ranges.some(
      (item, index) =>
        index > 0 && ranges[index - 1]!.end > item.start,
    )
  ) {
    return output;
  }

  return [...ranges].reverse().reduce((html, current) => {
    if (/^<details\b/i.test(current.marker.tag)) return html;

    const innerOpening = removeAttribute(
      current.marker.tag,
      "data-interaction-item-id",
    );
    const inner = current.element.replace(
      current.marker.tag,
      innerOpening,
    );
    const details =
      `<details class="keya-trusted-explore-card" ` +
      `data-interaction-item-id="${escapeHtmlAttribute(current.item.id)}" ` +
      `data-course-contract-restored="explore-control">` +
      `<summary>${escapeHtmlText(current.item.label)}</summary>` +
      `<div class="keya-trusted-explore-body">${inner}</div>` +
      `</details>`;
    return (
      html.slice(0, current.start) +
      details +
      html.slice(current.end)
    );
  }, output);
}

function removeAttribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.replace(
    new RegExp(
      `\\s+${escaped}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`,
      "gi",
    ),
    "",
  );
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setAttribute(tag: string, name: string, value: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const withoutExisting = tag.replace(
    new RegExp(
      `\\s+${escapedName}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`,
      "i",
    ),
    "",
  );
  return withoutExisting.replace(
    /\s*(\/?>)$/,
    ` ${name}="${escapeHtmlAttribute(value)}"$1`,
  );
}
