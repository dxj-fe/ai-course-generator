import { z } from "zod";

import {
  RETRIEVAL_MAX_REFERENCE_HITS,
  RETRIEVAL_MAX_REFERENCE_EXCERPT_CHARS,
  RETRIEVAL_MAX_TEMPLATE_CARDS,
  PageTypeSchema,
  ReferenceSearchResultSchema,
  TemplateCardSearchResultSchema,
  VisualStyleSchema,
  type ReferencePack,
  type ReferenceSearchResult,
  type TemplateCard,
  type TemplateCardSearchResult,
} from "@/shared/course-schema";
import { searchFunctionalTemplates } from "@/shared/templates/functional";
import { searchStyleTemplates } from "@/shared/templates/style";
import {
  aiResultCache,
  createAiResultCacheKey,
} from "@/server/infra/ai/result-cache";

export const RetrieveTemplateCardsInputSchema = z
  .object({
    pageGoal: z.string().min(2).max(300).optional(),
    pageNeeds: z
      .array(
        z
          .object({
            goal: z.string().min(2).max(300),
            pageType: PageTypeSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12)
      .optional(),
    audience: z.string().min(1).max(100).optional(),
    visualStyle: VisualStyleSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(RETRIEVAL_MAX_TEMPLATE_CARDS)
      .default(RETRIEVAL_MAX_TEMPLATE_CARDS),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.pageGoal && !input.pageNeeds) {
      context.addIssue({
        code: "custom",
        message: "pageGoal 与 pageNeeds 至少提供一个",
        path: ["pageNeeds"],
      });
    }
  });

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

type RetrieveTemplateCardsInput = z.input<
  typeof RetrieveTemplateCardsInputSchema
>;
type RetrieveReferenceInput = z.input<typeof RetrieveReferenceInputSchema>;

export function retrieveTemplateCards(
  input: RetrieveTemplateCardsInput,
): TemplateCardSearchResult {
  const parsedInput = RetrieveTemplateCardsInputSchema.parse(input);
  const cacheKey = createAiResultCacheKey({
    namespace: "template-card-search",
    promptFingerprint: "template-registry",
    model: "deterministic-registry",
    schemaFingerprint: "template-card-search-result",
    input: parsedInput,
  });
  const cached = aiResultCache.lookup(cacheKey, TemplateCardSearchResultSchema);
  if (cached.status === "hit") return cached.value;

  const pageNeeds = parsedInput.pageNeeds ?? [
    { goal: parsedInput.pageGoal! },
  ];
  const functionalMatches = new Map<
    string,
    ReturnType<typeof searchFunctionalTemplates>[number] & {
      matchedNeeds: string[];
    }
  >();

  for (const need of pageNeeds) {
    const matches = searchFunctionalTemplates({
      query: `${need.pageType ?? ""} ${need.goal}`,
      audience: parsedInput.audience,
      limit: 3,
    }).filter(
      ({ template }) =>
        need.pageType === undefined || template.pageType === need.pageType,
    );
    for (const match of matches) {
      const label = need.pageType
        ? `${need.pageType}：${need.goal}`
        : need.goal;
      const existing = functionalMatches.get(match.template.id);
      if (!existing) {
        functionalMatches.set(match.template.id, {
          ...match,
          matchedNeeds: [label],
        });
        continue;
      }
      existing.score = Math.max(existing.score, match.score);
      if (!existing.matchedNeeds.includes(label)) {
        existing.matchedNeeds.push(label);
      }
    }
  }

  const functional = [...functionalMatches.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.template.id.localeCompare(right.template.id),
    )
    .slice(0, parsedInput.limit)
    .map(({ template, reason, matchedNeeds }) => ({
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
    reason: formatTemplateReason(matchedNeeds, reason),
  }));
  const style = searchStyleTemplates({
    query: pageNeeds.map(({ goal }) => goal).join("；"),
    visualStyle: parsedInput.visualStyle,
    audience: parsedInput.audience,
    limit: parsedInput.limit,
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

  const result = TemplateCardSearchResultSchema.parse({ functional, style });
  aiResultCache.store(cacheKey, result, TemplateCardSearchResultSchema);
  return result;
}

export function retrieveReferenceHits(
  input: RetrieveReferenceInput,
  referencePacks: readonly ReferencePack[],
): ReferenceSearchResult {
  const parsedInput = RetrieveReferenceInputSchema.parse(input);
  const terms = queryTerms(parsedInput.query);
  if (terms.length === 0 || referencePacks.length === 0) {
    return { hits: [] };
  }

  const ranked = referencePacks
    .map((pack, packIndex) => rankReferencePack(pack, packIndex, terms))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.packIndex - right.packIndex)
    .slice(0, parsedInput.limit)
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
      const excerpts = selectedChunks.map(({ chunk }) => ({
        chunkId: chunk.id,
        text: chunk.text.slice(0, RETRIEVAL_MAX_REFERENCE_EXCERPT_CHARS),
        truncated:
          chunk.text.length > RETRIEVAL_MAX_REFERENCE_EXCERPT_CHARS,
      }));

      return {
        referencePackId: pack.id,
        sourceName: pack.sourceName,
        summary: pack.summary,
        keyFacts,
        chunkIds,
        excerpts,
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

function formatTemplateReason(
  matchedNeeds: readonly string[],
  reason: string,
) {
  const needs = matchedNeeds.slice(0, 3).join("；");
  const value = `适用于页面需求：${needs}。${reason}`;
  return value.length <= 240 ? value : `${value.slice(0, 239)}…`;
}
