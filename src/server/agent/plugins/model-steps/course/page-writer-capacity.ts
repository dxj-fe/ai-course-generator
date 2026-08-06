import type {
  PageContentDSL,
  PageContentInteraction,
} from "@/shared/course-schema";

type SemanticCapacityBudget = {
  narration: number;
  blocks: number;
  supportingPoints: number;
  interactionEntries: number;
};

/**
 * 这是一轮写作压缩提示的预算，不是产物门禁。不同互动本身能承载的证据量不同，
 * 因此不再用模板或统一的 “dense” 分数代替页面语义判断。
 */
export const PAGE_WRITER_SEMANTIC_CAPACITY_BUDGETS = {
  none: {
    narration: 1,
    blocks: 3,
    supportingPoints: 3,
    interactionEntries: 0,
  },
  navigate: {
    narration: 1,
    blocks: 3,
    supportingPoints: 3,
    interactionEntries: 1,
  },
  reveal: {
    narration: 1,
    blocks: 1,
    supportingPoints: 2,
    interactionEntries: 4,
  },
  explore: {
    narration: 1,
    blocks: 1,
    supportingPoints: 2,
    interactionEntries: 4,
  },
  choice: {
    narration: 0,
    blocks: 1,
    supportingPoints: 1,
    interactionEntries: 4,
  },
  sort: {
    narration: 0,
    blocks: 1,
    supportingPoints: 1,
    interactionEntries: 5,
  },
  input: {
    narration: 1,
    blocks: 2,
    supportingPoints: 2,
    interactionEntries: 2,
  },
} as const satisfies Record<
  PageContentInteraction["type"],
  SemanticCapacityBudget
>;

/**
 * 返回可直接交给 Page Writer 的具体重写反馈。这里只描述超量位置和压缩方向；
 * 不删除事实、不改写 DSL，也不因第二稿仍超量而拒绝页面。
 */
export function findPageWriterSemanticCapacityIssues(
  dsl: PageContentDSL,
) {
  const interactionType = dsl.interaction.type;
  const budget = PAGE_WRITER_SEMANTIC_CAPACITY_BUDGETS[interactionType];
  const supportingPoints = dsl.blocks.reduce(
    (total, block) => total + block.supportingPoints.length,
    0,
  );
  const interactionEntries = countInteractionEntries(dsl.interaction);
  const issues: string[] = [];

  if (dsl.narration.length > budget.narration) {
    issues.push(
      `narration 有 ${dsl.narration.length} 句，${interactionType} 页预算为 ${budget.narration} 句；删除与标题、正文或互动 prompt 重复的引导。`,
    );
  }
  if (dsl.blocks.length > budget.blocks) {
    issues.push(
      `blocks 有 ${dsl.blocks.length} 个，${interactionType} 页预算为 ${budget.blocks} 个；合并讲同一关系的 blocks，只保留跨互动项都需要的共同依据。`,
    );
  }
  if (supportingPoints > budget.supportingPoints) {
    issues.push(
      `supportingPoints 共 ${supportingPoints} 条，${interactionType} 页预算为 ${budget.supportingPoints} 条；把可由正文或互动直接表达的证据合并回对应位置。`,
    );
  }
  if (interactionEntries > budget.interactionEntries) {
    issues.push(
      `互动项有 ${interactionEntries} 个，${interactionType} 页预算为 ${budget.interactionEntries} 个；合并语义重复项，但保留完成学习目标所需的全部区别。`,
    );
  }

  if (issues.length === 0) return [];

  return [
    `当前 ${interactionType} 初稿超出单页语义容量；请围绕唯一认知动作整页重写，而不是删去事实、截断句子或把内容交给 HTML 缩字。`,
    ...issues,
    interactionRewriteDirection(interactionType),
  ];
}

function countInteractionEntries(interaction: PageContentInteraction) {
  switch (interaction.type) {
    case "choice":
      return interaction.questions[0]?.options.length ?? 0;
    case "reveal":
    case "explore":
    case "sort":
      return interaction.items.length;
    case "input":
      return interaction.evaluationCriteria.length;
    case "navigate":
      return 1;
    case "none":
      return 0;
  }
}

function interactionRewriteDirection(
  interactionType: PageContentInteraction["type"],
) {
  switch (interactionType) {
    case "reveal":
    case "explore":
      return "让每个 interaction item 承担对应观察证据，blocks 只保留所有 items 共用且不可省略的规律。";
    case "choice":
      return "让 prompt 交代判断情境、options 承担可比较判断、feedback 保留完整依据；移除复述题干的 narration 或 question block。";
    case "sort":
      return "让 items 承担待排序的观察证据，blocks 只保留唯一排序规则，不另写操作说明。";
    case "input":
      return "让 prompt 说明任务、evaluationCriteria 承担可观察证据，blocks 只保留完成表达所需的方法。";
    case "none":
    case "navigate":
      return "合并同义 blocks，把每条必要事实放在唯一位置，保留一条清楚的阅读路径。";
  }
}
