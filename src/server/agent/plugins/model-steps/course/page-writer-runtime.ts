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
    sceneKind: sceneKindForPage(input.page),
    // 视觉形式属于 Page Designer，不再由关键词正则替模型选择通用图形。
    visualPrimitive: "none",
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
