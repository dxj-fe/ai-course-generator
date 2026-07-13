import type { VisualStyle } from "@/shared/course-schema";

import type { CoreVisualStyle, StyleTemplate } from "./schema";
import { styleTemplates } from "./templates";

export type StyleTemplateSearchInput = {
  query?: string;
  visualStyle?: VisualStyle;
  audience?: string;
  limit?: number;
};

export type StyleTemplateMatch = {
  template: StyleTemplate;
  score: number;
  reason: string;
};

const templatesById = new Map(
  styleTemplates.map((template) => [template.id, template]),
);

validateRegistry();

/** 返回全部样式模板，供搜索 Skill、Theme 适配器和 Gallery 使用。 */
export function listStyleTemplates(): readonly StyleTemplate[] {
  return styleTemplates;
}

/** 按稳定 ID 查询样式模板。 */
export function getStyleTemplate(id: string): StyleTemplate | undefined {
  return templatesById.get(id);
}

/**
 * 根据 visualStyle、自由文本和受众返回候选风格。
 * CourseIntent 的 professional 会映射到 minimal，保持六套核心 Registry 不重复。
 */
export function searchStyleTemplates(
  input: StyleTemplateSearchInput,
): StyleTemplateMatch[] {
  const limit = Math.min(3, Math.max(1, input.limit ?? 3));
  const requestedStyle = normalizeVisualStyle(input.visualStyle);
  const searchText = normalize(`${input.query ?? ""} ${input.audience ?? ""}`);
  const ranked = styleTemplates
    .map((template, index) =>
      scoreTemplate(template, requestedStyle, searchText, index),
    )
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const hasMatch = ranked.some(({ score }) => score > 0);
  const candidates = hasMatch
    ? ranked.filter(({ score }) => score > 0)
    : ranked;

  return candidates.slice(0, limit).map(({ template, score, reasons }) => ({
    template,
    score,
    reason:
      reasons.length > 0
        ? reasons.join("；")
        : "未发现明确视觉关键词，返回通用候选供 Agent 继续判断。",
  }));
}

/** 将 CourseIntent 的兼容值收敛到六个核心视觉方向。 */
function normalizeVisualStyle(
  visualStyle?: VisualStyle,
): CoreVisualStyle | undefined {
  return visualStyle === "professional" ? "minimal" : visualStyle;
}

/** 对 visualStyle 精确匹配和文本关键词命中进行确定性计分。 */
function scoreTemplate(
  template: StyleTemplate,
  requestedStyle: CoreVisualStyle | undefined,
  searchText: string,
  index: number,
) {
  const reasons: string[] = [];
  let score = 0;

  if (requestedStyle === template.visualStyle) {
    score += 10;
    reasons.push(`匹配 visualStyle：${template.visualStyle}`);
  }

  const terms = [template.name, template.visualStyle, ...template.keywords];
  const matchedTerms = searchText
    ? terms.filter((term) => searchText.includes(normalize(term)))
    : [];

  if (matchedTerms.length > 0) {
    score += matchedTerms.length;
    reasons.push(`匹配视觉关键词：${matchedTerms.join("、")}`);
  }

  return { template, index, score, reasons };
}

/** 在模块加载时校验样式 ID 与 visualStyle 均唯一。 */
function validateRegistry() {
  const visualStyles = new Set(
    styleTemplates.map((template) => template.visualStyle),
  );

  if (templatesById.size !== styleTemplates.length) {
    throw new Error("Style Template Registry 存在重复 ID。");
  }

  if (visualStyles.size !== styleTemplates.length) {
    throw new Error("Style Template Registry 存在重复 visualStyle。");
  }
}

/** 统一搜索文本，避免大小写和首尾空格影响匹配。 */
function normalize(value: string) {
  return value.trim().toLowerCase();
}
