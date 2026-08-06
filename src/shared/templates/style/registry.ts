import {
  rankStyleTemplates,
  type StyleCandidateRole,
  type StyleMatchFactor,
  type StyleTemplateSearchInput,
} from "./matching";
import type { StyleTemplate } from "./schema";
import { styleTemplates } from "./templates";

export type { StyleTemplateSearchInput } from "./matching";

export type StyleTemplateMatch = {
  template: StyleTemplate;
  score: number;
  reason: string;
  factors: readonly StyleMatchFactor[];
  candidateRole: StyleCandidateRole;
  confidence: number;
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

/** 根据 visualStyle、自由文本和受众返回候选风格。 */
export function searchStyleTemplates(
  input: StyleTemplateSearchInput,
): StyleTemplateMatch[] {
  return rankStyleTemplates(styleTemplates, input);
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
