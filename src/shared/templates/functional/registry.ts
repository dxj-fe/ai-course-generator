import { PageTypeSchema } from "@/shared/course-schema";

import type { FunctionalTemplate } from "./schema";
import { functionalTemplates } from "./templates";

export type FunctionalTemplateSearchInput = {
  query: string;
  audience?: string;
  limit?: number;
};

export type FunctionalTemplateMatch = {
  template: FunctionalTemplate;
  score: number;
  reason: string;
};

const templatesById = new Map(
  functionalTemplates.map((template) => [template.id, template]),
);

validateRegistry();

/** 返回全部功能模板，供服务端 Skill 和前端 Gallery 使用。 */
export function listFunctionalTemplates(): readonly FunctionalTemplate[] {
  return functionalTemplates;
}

/** 按稳定 ID 查询模板；未知 ID 返回 undefined，由调用方决定错误策略。 */
export function getFunctionalTemplate(
  id: string,
): FunctionalTemplate | undefined {
  return templatesById.get(id);
}

/**
 * 根据页面目标返回按分数排序的候选模板。
 * 没有明确关键词时仍返回通用候选，确保 Skill 始终能给 Agent 下一步选项。
 */
export function searchFunctionalTemplates(
  input: FunctionalTemplateSearchInput,
): FunctionalTemplateMatch[] {
  const limit = Math.min(3, Math.max(1, input.limit ?? 3));
  const searchText = normalize(`${input.query} ${input.audience ?? ""}`);
  const ranked = functionalTemplates
    .map((template, index) => scoreTemplate(template, searchText, index))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const hasMatch = ranked.some(({ score }) => score > 0);
  const candidates = hasMatch
    ? ranked.filter(({ score }) => score > 0)
    : ranked;

  return candidates.slice(0, limit).map(({ template, score, matchedTerms }) => ({
    template,
    score,
    reason:
      matchedTerms.length > 0
        ? `匹配教学关键词：${matchedTerms.join("、")}`
        : "未发现明确教学关键词，返回通用候选供 Agent 继续判断。",
  }));
}

/** 计算单个模板与页面目标的确定性匹配分数。 */
function scoreTemplate(
  template: FunctionalTemplate,
  searchText: string,
  index: number,
) {
  const terms = [template.name, template.pageType, ...template.keywords];
  const matchedTerms = terms.filter((term) => searchText.includes(normalize(term)));

  return {
    template,
    index,
    matchedTerms,
    score: matchedTerms.reduce(
      (total, term) => total + (term === template.name ? 3 : 1),
      0,
    ),
  };
}

/** 在模块加载时验证 ID 唯一且每种 pageType 都有一个模板。 */
function validateRegistry() {
  if (templatesById.size !== functionalTemplates.length) {
    throw new Error("Functional Template Registry 存在重复 ID。");
  }

  const registeredPageTypes = new Set(
    functionalTemplates.map((template) => template.pageType),
  );

  for (const pageType of PageTypeSchema.options) {
    if (!registeredPageTypes.has(pageType)) {
      throw new Error(`pageType ${pageType} 缺少功能模板。`);
    }
  }
}

/** 统一搜索文本，避免大小写和首尾空格影响匹配。 */
function normalize(value: string) {
  return value.trim().toLowerCase();
}
