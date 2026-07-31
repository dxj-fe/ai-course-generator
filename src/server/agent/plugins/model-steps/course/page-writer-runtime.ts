import type {
  LessonRuntime,
  PageContentBlock,
  PageContentInteraction,
  PagePlan,
} from "@/shared/course-schema";

import type { PageWriterInput } from "./page-writer-model-step";

/** 将页面语义收敛为平台运行时计划，避免模型生成可执行代码。 */
export function buildLessonRuntime(input: {
  page: PagePlan;
  blocks: PageContentBlock[];
  interaction: PageContentInteraction;
}): LessonRuntime {
  const searchable = [
    input.page.title,
    input.page.learningObjective,
    input.page.contentSummary,
    ...input.blocks.flatMap(({ heading, body, supportingPoints }) => [
      heading,
      body,
      ...supportingPoints,
    ]),
  ].join(" ");
  const interactionId = `interaction-${input.page.id}`;
  const targetIds = [
    ...input.blocks.map(({ id }) => id),
    ...interactionTargetIds(input.interaction),
  ].slice(0, 8);
  const cuePoints: LessonRuntime["motionPlan"]["cuePoints"] = targetIds.map(
    (targetId, index) => ({
      id: `cue-${String(index + 1).padStart(2, "0")}`,
      action: "reveal" as const,
      targetId,
      delayMs: index * 120,
      durationMs: 420,
    }),
  );

  if (!["none", "navigate"].includes(input.interaction.type)) {
    cuePoints.push({
      id: "cue-wait-interaction",
      action: "wait-for-interaction",
      targetId: interactionId,
      delayMs: 0,
      durationMs: 180,
    });
  }

  return {
    runtimeVersion: 1,
    sceneKind: sceneKindForPage(input.page),
    visualPrimitive: visualPrimitiveForPage(input.page, searchable),
    motionPlan: {
      intensity:
        cuePoints.length === 0
          ? "none"
          : input.interaction.type === "none"
            ? "subtle"
            : "guided",
      cuePoints,
    },
    completionRule:
      input.interaction.type === "choice"
        ? { type: "correct-answer", interactionId }
        : ["reveal", "sort", "input", "explore"].includes(
              input.interaction.type,
            )
          ? { type: "interaction-complete", interactionId }
          : { type: "view" },
  };
}

function sceneKindForPage(
  page: PagePlan,
): LessonRuntime["sceneKind"] {
  switch (page.pageType) {
    case "quiz":
      return "practice";
    case "summary":
      return "recap";
    case "achievement":
      return "reflect";
    case "knowledge_card":
    case "comparison":
    case "timeline":
      return "demo";
    default:
      return "explain";
  }
}

function visualPrimitiveForPage(
  page: PagePlan,
  searchable: string,
): LessonRuntime["visualPrimitive"] {
  const programmingContext =
    /python|javascript|typescript|java|编程|代码|程序|def\s|return\b|调用|参数|循环|变量|数据类型/i.test(
      searchable,
    );
  const mathematicalFunctionContext =
    /函数(?:图像|图象|曲线)|function\s+graph|equation\s+plot|定义域|值域|自变量|因变量|坐标(?:系|轴)|抛物线|斜率|(?:^|\s)y\s*=|f\s*\(/i.test(
      searchable,
    );
  if (mathematicalFunctionContext && !programmingContext) {
    return "function-graph";
  }
  if (/集合|子集|并集|交集|补集|venn/i.test(searchable)) return "venn";
  if (page.pageType === "timeline") return "timeline";
  if (page.pageType === "comparison") return "comparison";
  if (/步骤|流程|过程|阶段|控制|循环|遍历|条件/.test(searchable)) {
    return "process";
  }
  return "none";
}

function interactionTargetIds(interaction: PageContentInteraction) {
  switch (interaction.type) {
    case "reveal":
    case "explore":
    case "sort":
      return interaction.items.map(({ id }) => id);
    case "choice":
      return interaction.questions.map(({ id }) => id);
    default:
      return [];
  }
}

export function selectPageReferenceContext(input: PageWriterInput) {
  const packsById = new Map(
    (input.referencePacks ?? []).map((pack) => [pack.id, pack]),
  );

  return (input.page.usedReferences ?? []).flatMap((usage) => {
    const pack = packsById.get(usage.referencePackId);
    if (!pack) return [];
    const allowedChunkIds = new Set(usage.chunkIds);
    return [
      {
        id: pack.id,
        sourceName: pack.sourceName,
        summary: pack.summary,
        keyFacts: pack.keyFacts.filter((fact) =>
          fact.chunkIds.some((chunkId) => allowedChunkIds.has(chunkId)),
        ),
        chunks: pack.chunks.filter(({ id }) => allowedChunkIds.has(id)),
      },
    ];
  });
}
