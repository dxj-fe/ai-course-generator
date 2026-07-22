import { z } from "zod";

import {
  RETRIEVAL_MAX_REFERENCE_HITS,
  RETRIEVAL_MAX_SKILL_CARDS,
  RETRIEVAL_MAX_TEMPLATE_CARDS,
  ReferenceSearchResultSchema,
  SkillCardSearchResultSchema,
  TemplateCardSearchResultSchema,
  VisualStyleSchema,
  type ReferencePack,
  type ReferenceSearchResult,
  type SkillCardSearchResult,
  type TemplateCard,
  type TemplateCardSearchResult,
} from "@/shared/course-schema";
import { searchFunctionalTemplates } from "@/shared/templates/functional";
import { searchStyleTemplates } from "@/shared/templates/style";

import { listSkillCards } from "./retrieval-card-registry";
import type { Skill } from "./types";

export const RetrieveSkillDocsInputSchema = z
  .object({
    agentName: z.string().min(2).max(80),
    task: z.string().min(2).max(300),
    limit: z
      .number()
      .int()
      .min(1)
      .max(RETRIEVAL_MAX_SKILL_CARDS)
      .default(RETRIEVAL_MAX_SKILL_CARDS),
  })
  .strict();

export const RetrieveTemplateCardsInputSchema = z
  .object({
    pageGoal: z.string().min(2).max(300),
    audience: z.string().min(1).max(100).optional(),
    visualStyle: VisualStyleSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(RETRIEVAL_MAX_TEMPLATE_CARDS)
      .default(RETRIEVAL_MAX_TEMPLATE_CARDS),
  })
  .strict();

export const RetrieveReferenceInputSchema = z
  .object({
    query: z.string().min(2).max(500),
    limit: z
      .number()
      .int()
      .min(1)
      .max(RETRIEVAL_MAX_REFERENCE_HITS)
      .default(RETRIEVAL_MAX_REFERENCE_HITS),
  })
  .strict();

type RetrieveSkillDocsInput = z.infer<typeof RetrieveSkillDocsInputSchema>;
type RetrieveTemplateCardsInput = z.infer<
  typeof RetrieveTemplateCardsInputSchema
>;
type RetrieveReferenceInput = z.infer<typeof RetrieveReferenceInputSchema>;

export const retrieveSkillDocsSkill: Skill<
  RetrieveSkillDocsInput,
  SkillCardSearchResult
> = {
  name: "retrieveSkillDocsSkill",
  description:
    "按 agentName 和当前 task 查询已注册能力的适用场景、输入输出摘要和限制。结果只提供能力说明，不能绕过工作流节点校验。",
  inputSchema: RetrieveSkillDocsInputSchema,
  outputSchema: SkillCardSearchResultSchema,
  execute: retrieveSkillCards,
};

export const retrieveTemplateCardsSkill: Skill<
  RetrieveTemplateCardsInput,
  TemplateCardSearchResult
> = {
  name: "retrieveTemplateCardsSkill",
  description:
    "按 pageGoal 查询功能模板和样式模板的短 Card；不返回完整模板定义，最终 ID 仍须通过 Registry 校验。",
  inputSchema: RetrieveTemplateCardsInputSchema,
  outputSchema: TemplateCardSearchResultSchema,
  execute: retrieveTemplateCards,
};

export function createRetrieveReferenceSkill(
  referencePacks: readonly ReferencePack[],
): Skill<RetrieveReferenceInput, ReferenceSearchResult> {
  return {
    name: "retrieveReferenceSkill",
    description:
      "查询当前任务已经校验的 Reference Packs，只返回相关摘要、关键事实和稳定 pack/chunk ID，不返回完整文件。",
    inputSchema: RetrieveReferenceInputSchema,
    outputSchema: ReferenceSearchResultSchema,
    execute: (input) => retrieveReferenceHits(input, referencePacks),
  };
}

export function retrieveSkillCards(
  input: RetrieveSkillDocsInput,
): SkillCardSearchResult {
  const normalizedAgent = normalize(input.agentName);
  const terms = queryTerms(input.task);
  const ranked = listSkillCards()
    .map((card, index) => {
      const exactAgent = card.agentNames.some(
        (agentName) => normalize(agentName) === normalizedAgent,
      );
      const matchedTerms = terms.filter((term) =>
        normalize(
          [
            card.name,
            card.description,
            ...card.whenToUse,
            ...card.keywords,
          ].join(" "),
        ).includes(term),
      );
      return {
        card,
        exactAgent,
        index,
        matchedTerms,
        score: (exactAgent ? 100 : 0) + matchedTerms.length,
      };
    })
    .filter(({ exactAgent }) => exactAgent)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, input.limit)
    .map(({ card, matchedTerms }) => ({
      card,
      reason:
        matchedTerms.length > 0
          ? `匹配 Agent 与任务关键词：${matchedTerms.slice(0, 4).join("、")}`
          : `匹配 Agent：${input.agentName}`,
    }));

  return SkillCardSearchResultSchema.parse({ matches: ranked });
}

export function retrieveTemplateCards(
  input: RetrieveTemplateCardsInput,
): TemplateCardSearchResult {
  const functional = searchFunctionalTemplates({
    query: input.pageGoal,
    audience: input.audience,
    limit: input.limit,
  }).map(({ template, reason }) => ({
    card: {
      kind: "functional-template" as const,
      id: template.id,
      name: template.name,
      description: template.goal,
      whenToUse: template.bestFor.slice(0, 4),
      inputSchemaSummary: "页面目标、学习者受众和期望互动方式。",
      outputSummary: `pageType=${template.pageType} 的教学结构槽位与约束。`,
      limitations: [
        ...template.constraints.slice(0, 2),
        ...template.avoidFor.slice(0, 2),
      ].slice(0, 4),
      tags: [template.pageType, ...template.keywords.slice(0, 8)],
      pageType: template.pageType,
    } satisfies TemplateCard,
    reason,
  }));
  const style = searchStyleTemplates({
    query: input.pageGoal,
    visualStyle: input.visualStyle,
    audience: input.audience,
    limit: input.limit,
  }).map(({ template, reason }) => ({
    card: {
      kind: "style-template" as const,
      id: template.id,
      name: template.name,
      description: template.goal,
      whenToUse: template.bestFor.slice(0, 4),
      inputSchemaSummary: "视觉目标、学习者受众和 CourseIntent.visualStyle。",
      outputSummary: `visualStyle=${template.visualStyle} 的 Design Tokens 与素材指导。`,
      limitations: template.avoidFor.slice(0, 4),
      tags: [
        template.visualStyle,
        template.layoutDensity,
        ...template.keywords.slice(0, 8),
      ],
      visualStyle: template.visualStyle,
    } satisfies TemplateCard,
    reason,
  }));

  return TemplateCardSearchResultSchema.parse({ functional, style });
}

export function retrieveReferenceHits(
  input: RetrieveReferenceInput,
  referencePacks: readonly ReferencePack[],
): ReferenceSearchResult {
  const terms = queryTerms(input.query);
  if (terms.length === 0 || referencePacks.length === 0) {
    return { hits: [] };
  }

  const ranked = referencePacks
    .map((pack, packIndex) => rankReferencePack(pack, packIndex, terms))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.packIndex - right.packIndex)
    .slice(0, input.limit)
    .map(({ pack, chunkScores, matchedTerms }) => {
      const selectedChunks = chunkScores
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score || left.chunk.index - right.chunk.index,
        )
        .slice(0, 4);
      const chunkIds =
        selectedChunks.length > 0
          ? selectedChunks.map(({ chunk }) => chunk.id)
          : [pack.chunks[0]!.id];
      const selectedIds = new Set(chunkIds);
      const keyFacts = pack.keyFacts
        .filter((fact) => fact.chunkIds.some((id) => selectedIds.has(id)))
        .slice(0, 6)
        .map(({ text }) => text);

      return {
        referencePackId: pack.id,
        sourceName: pack.sourceName,
        summary: pack.summary,
        keyFacts,
        chunkIds,
        reason: `匹配资料关键词：${matchedTerms.slice(0, 5).join("、")}`,
      };
    });

  return ReferenceSearchResultSchema.parse({ hits: ranked });
}

function rankReferencePack(
  pack: ReferencePack,
  packIndex: number,
  terms: readonly string[],
) {
  const summaryMatches = matchingTerms(pack.summary, terms);
  const chunkScores = pack.chunks.map((chunk) => ({
    chunk,
    score: matchingTerms(chunk.text, terms).length * 2,
  }));
  const factMatches = pack.keyFacts.flatMap((fact) => {
    const matches = matchingTerms(fact.text, terms);
    if (matches.length === 0) return [];
    for (const chunkId of fact.chunkIds) {
      const chunkScore = chunkScores.find(({ chunk }) => chunk.id === chunkId);
      if (chunkScore) chunkScore.score += matches.length * 3;
    }
    return matches;
  });
  const chunkMatches = pack.chunks.flatMap((chunk) =>
    matchingTerms(chunk.text, terms),
  );
  const matchedTerms = [...new Set([
    ...summaryMatches,
    ...factMatches,
    ...chunkMatches,
  ])];

  return {
    pack,
    packIndex,
    chunkScores,
    matchedTerms,
    score:
      summaryMatches.length * 2 +
      factMatches.length * 3 +
      chunkScores.reduce((total, chunk) => total + chunk.score, 0),
  };
}

function matchingTerms(value: string, terms: readonly string[]) {
  const text = normalize(value);
  return terms.filter((term) => text.includes(term));
}

function queryTerms(value: string) {
  return [
    ...new Set(
      normalize(value)
        .split(/[^\p{L}\p{N}_-]+/u)
        .map((term) => term.trim())
        .filter((term) => term.length >= 2),
    ),
  ];
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
