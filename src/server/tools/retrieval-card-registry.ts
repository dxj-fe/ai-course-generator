import {
  SkillCardSchema,
  ToolCardSchema,
  type SkillCard,
  type ToolCard,
} from "@/shared/course-schema";

const toolCards = [
  {
    kind: "tool",
    id: "retrieve-skill-docs",
    name: "retrieveSkillDocsSkill",
    description: "按 Agent 名称和当前任务查询可用能力及其边界。",
    whenToUse: ["Supervisor 或 Specialist 需要确认当前可用能力时"],
    inputSchemaSummary: "agentName、task，以及不超过 3 的 limit。",
    outputSummary: "按相关度排序的 SkillCard 与匹配原因。",
    limitations: ["只查询已注册能力", "不能使非法工作流节点变为可执行"],
    keywords: ["skill", "能力", "agent", "边界", "supervisor"],
  },
  {
    kind: "tool",
    id: "retrieve-template-cards",
    name: "retrieveTemplateCardsSkill",
    description: "按页面目标查询功能模板和样式模板的短摘要。",
    whenToUse: ["Planner 需要为页面目标选择结构或视觉方向时"],
    inputSchemaSummary: "pageGoal，可选 audience、visualStyle 和 limit。",
    outputSummary: "最多 3 个功能模板和 3 个样式模板 Card。",
    limitations: ["不返回完整模板定义", "最终模板 ID 仍由业务校验确认"],
    keywords: ["template", "模板", "页面", "样式", "planner"],
  },
  {
    kind: "tool",
    id: "retrieve-reference",
    name: "retrieveReferenceSkill",
    description: "从当前任务的 Reference Packs 中查询可追踪资料片段。",
    whenToUse: ["Planner 需要为课程页面选择事实来源时"],
    inputSchemaSummary: "query，以及不超过 3 的 limit。",
    outputSummary: "匹配资料摘要、关键事实及稳定 pack/chunk ID。",
    limitations: ["不返回原始完整文件", "只查询当前任务已经校验的资料"],
    keywords: ["reference", "资料", "引用", "chunk", "planner"],
  },
  {
    kind: "tool",
    id: "generate-image-asset",
    name: "generateImageAsset",
    description: "根据 ImagePromptAgent 的请求生成单张页面视觉素材。",
    whenToUse: ["页面存在经过校验的图片素材槽时"],
    inputSchemaSummary: "pageId、altText 和 AssetRequest。",
    outputSummary: "真实图片 Asset 或确定性的 CSS/SVG/占位 fallback。",
    limitations: ["不生成整页 UI", "失败不能阻塞页面文字与 HTML"],
    keywords: ["image", "asset", "图片", "素材"],
  },
] satisfies ToolCard[];

const skillCards = [
  {
    kind: "skill",
    id: "interpret-course-intent",
    name: "课程意图解析",
    description: "把用户课程需求转换成严格的 CourseIntent。",
    agentNames: ["intent"],
    whenToUse: ["课程尚未生成类型化意图时"],
    inputSchemaSummary: "用户提示和可选运行取消信号。",
    outputSummary: "经过 CourseIntentSchema 校验的课程意图。",
    limitations: ["不规划页面", "不生成课程正文"],
    keywords: ["意图", "主题", "受众", "课程长度", "风格"],
  },
  {
    kind: "skill",
    id: "plan-course",
    name: "课程结构规划",
    description: "把 CourseIntent 转换为具备学习节奏的 CoursePlan。",
    agentNames: ["planner"],
    whenToUse: ["课程意图已校验但尚无页面规划时"],
    inputSchemaSummary: "CourseIntent、模板 Card 和可选 Reference Hit。",
    outputSummary: "3–12 页 CoursePlan 和页面级资料引用。",
    limitations: ["不生成页面正文", "不能编造模板或资料 ID"],
    keywords: ["规划", "页面", "课程", "模板", "资料"],
  },
  {
    kind: "skill",
    id: "design-course",
    name: "课程专业设计",
    description: "生成教学、故事、视觉 brief 和 Page Worker handoff。",
    agentNames: ["course-design"],
    whenToUse: ["CoursePlan 已完成且页面执行尚未开始时"],
    inputSchemaSummary: "CourseIntent 和 CoursePlan。",
    outputSummary: "CourseDesignBriefs 与逐页 PageWorkerBrief。",
    limitations: ["不生成最终 DSL、图片或 HTML"],
    keywords: ["教学", "故事", "视觉", "brief", "设计"],
  },
  {
    kind: "skill",
    id: "run-page-worker",
    name: "页面工作流执行",
    description: "按 Writer、Assets、HTML、QA 和有限 Repair 顺序生成页面。",
    agentNames: ["page-worker"],
    whenToUse: ["页面依赖满足且页面尚未完成时"],
    inputSchemaSummary: "页面计划、专业 brief、课程状态和引用授权。",
    outputSummary: "页面 DSL、素材、HTML、QA 报告及修订记录。",
    limitations: ["必须遵守页面级预算", "页面状态只能通过运行层合并"],
    keywords: ["页面", "worker", "dsl", "html", "qa"],
  },
  {
    kind: "skill",
    id: "write-page-content",
    name: "页面内容写作",
    description: "为单个 PagePlan 生成符合功能模板的 PageContentDSL。",
    agentNames: ["page-writer"],
    whenToUse: ["页面计划和 PageWorkerBrief 已就绪时"],
    inputSchemaSummary: "CourseIntent、PagePlan、PageWorkerBrief 和授权资料片段。",
    outputSummary: "经过 PageContentDSLSchema 校验的单页内容。",
    limitations: ["不生成 HTML", "只能使用 Planner 授权的资料 chunks"],
    keywords: ["正文", "dsl", "page", "内容", "引用"],
  },
  {
    kind: "skill",
    id: "resolve-page-assets",
    name: "页面素材解析",
    description: "为页面素材槽解析真实图片或安全 fallback。",
    agentNames: ["image-assets"],
    whenToUse: ["PageContentDSL 包含素材槽时"],
    inputSchemaSummary: "PageContentDSL、VisualBrief 和 StyleTemplate。",
    outputSummary: "按素材槽对应的 AssetGenerationResult。",
    limitations: ["不把文字烘焙进图片", "供应商失败必须可降级"],
    keywords: ["图片", "素材", "asset", "fallback"],
  },
  {
    kind: "skill",
    id: "engineer-page-html",
    name: "页面 HTML 工程",
    description: "把 DSL、模板、视觉 brief 和素材编译为安全 HTML。",
    agentNames: ["html-engineer"],
    whenToUse: ["页面 DSL 与素材阶段已经完成时"],
    inputSchemaSummary: "PageContentDSL、模板、视觉 brief、素材和校验反馈。",
    outputSummary: "通过合同与安全预检的完整静态 HTML。",
    limitations: ["不能改变 DSL 教学语义", "不得放宽 sandbox 边界"],
    keywords: ["html", "页面", "编译", "sandbox"],
  },
  {
    kind: "skill",
    id: "evaluate-page-quality",
    name: "页面质量评估",
    description: "结合确定性证据和语义评分生成六维 QualityReport。",
    agentNames: ["page-qa"],
    whenToUse: ["页面 HTML 已生成，需要决定是否修订时"],
    inputSchemaSummary: "页面计划、DSL、HTML、brief、素材和可选浏览器证据。",
    outputSummary: "六维评分、可定位问题和 shouldRepair 决策。",
    limitations: ["只报告问题", "不能直接修改页面产物"],
    keywords: ["qa", "质量", "评估", "问题", "评分"],
  },
  {
    kind: "skill",
    id: "repair-page",
    name: "页面定向修订",
    description: "根据可定位 QA 问题对 DSL 或 HTML 进行有限修订。",
    agentNames: ["repair"],
    whenToUse: ["QualityReport 要求修订且仍有 Repair 预算时"],
    inputSchemaSummary: "RepairRequest、当前页面产物和可定位问题。",
    outputSummary: "限定范围的修订候选或结构化拒绝。",
    limitations: ["最多两轮", "必须重新校验并执行 re-QA"],
    keywords: ["repair", "修订", "qa", "dsl", "html"],
  },
] satisfies SkillCard[];

const parsedToolCards = ToolCardSchema.array().parse(toolCards);
const parsedSkillCards = SkillCardSchema.array().parse(skillCards);

validateUniqueIds([...parsedToolCards, ...parsedSkillCards]);

export function listToolCards(): readonly ToolCard[] {
  return parsedToolCards;
}

export function listSkillCards(): readonly SkillCard[] {
  return parsedSkillCards;
}

export function getRetrievalRegistryDocument() {
  return {
    version: 1 as const,
    tools: parsedToolCards,
    skills: parsedSkillCards,
  };
}

export function renderRetrievalRegistryMarkdown() {
  const sections = [
    "# Agent Retrieval Registry",
    "",
    "该目录由 `src/server/tools/retrieval-card-registry.ts` 的类型化定义生成。运行时定义是事实来源。",
    "",
    "## Tools",
    "",
    ...parsedToolCards.flatMap(renderCard),
    "## Skills",
    "",
    ...parsedSkillCards.flatMap(renderCard),
  ];

  return `${sections.join("\n").trim()}\n`;
}

function renderCard(card: ToolCard | SkillCard) {
  return [
    `### ${card.name} (${card.id})`,
    "",
    card.description,
    "",
    `- When to use: ${card.whenToUse.join("；")}`,
    `- Input: ${card.inputSchemaSummary}`,
    `- Output: ${card.outputSummary}`,
    `- Limitations: ${card.limitations.join("；")}`,
    "",
  ];
}

function validateUniqueIds(cards: ReadonlyArray<{ id: string }>) {
  const ids = new Set(cards.map(({ id }) => id));
  if (ids.size !== cards.length) {
    throw new Error("Agent Retrieval Registry 存在重复 Card ID。");
  }
}
