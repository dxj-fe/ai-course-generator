import type { CoreVisualStyle } from "./schema";
import type {
  StyleAudienceStage,
  StyleColorScheme,
  StyleContentAffordance,
  StyleDomain,
  StyleFormality,
  StyleLearningActivity,
  StyleNarrativeMode,
  StyleRiskContext,
  StyleTemplate,
} from "./schema";

export type StyleCandidateRole = "best-match" | "safe" | "explore";

export type StyleMatchFactor = Readonly<{
  key:
    | "explicit"
    | "keyword"
    | "domain"
    | "audience"
    | "activity"
    | "narrative"
    | "affordance"
    | "formality"
    | "scheme"
    | "tone";
  score: number;
  label: string;
}>;

export type StyleIntentProfile = Readonly<{
  domains: readonly StyleDomain[];
  audienceStages: readonly StyleAudienceStage[];
  learningActivities: readonly StyleLearningActivity[];
  narrativeModes: readonly StyleNarrativeMode[];
  contentAffordances: readonly StyleContentAffordance[];
  formality?: StyleFormality;
  scheme?: StyleColorScheme;
  riskContext: StyleRiskContext;
}>;

export type StyleTemplateSearchInput = Readonly<{
  query?: string;
  visualStyle?: CoreVisualStyle;
  audience?: string;
  domains?: readonly StyleDomain[];
  audienceStages?: readonly StyleAudienceStage[];
  learningActivities?: readonly StyleLearningActivity[];
  narrativeModes?: readonly StyleNarrativeMode[];
  contentAffordances?: readonly StyleContentAffordance[];
  formality?: StyleFormality;
  scheme?: StyleColorScheme;
  riskContext?: StyleRiskContext;
  limit?: number;
}>;

export type RankedStyleTemplate = Readonly<{
  template: StyleTemplate;
  score: number;
  factors: readonly StyleMatchFactor[];
  candidateRole: StyleCandidateRole;
  confidence: number;
  reason: string;
}>;

type ScoredStyleTemplate = Omit<
  RankedStyleTemplate,
  "candidateRole" | "confidence" | "reason"
> & { index: number };

const domainTerms: Record<StyleDomain, readonly string[]> = {
  stem: [
    "数学",
    "物理",
    "化学",
    "生物",
    "科学",
    "工程",
    "编程",
    "代码",
    "算法",
    "数据",
    "人工智能",
    "ai",
    "宇宙",
    "太阳",
    "行星",
    "生态",
  ],
  humanities: [
    "文学",
    "历史",
    "哲学",
    "文化",
    "社会",
    "诗",
    "古典",
    "艺术史",
    "思想",
  ],
  business: [
    "商业",
    "企业",
    "管理",
    "财务",
    "金融",
    "市场",
    "战略",
    "投资",
    "产品",
    "运营",
  ],
  creative: [
    "设计",
    "艺术",
    "品牌",
    "摄影",
    "电影",
    "音乐",
    "创意",
    "建筑",
    "时尚",
  ],
  life: [
    "健康",
    "医疗",
    "护理",
    "心理",
    "生活",
    "营养",
    "运动",
    "安全",
    "环境",
  ],
  language: [
    "语言",
    "英语",
    "英文",
    "中文",
    "词汇",
    "语法",
    "口语",
    "阅读",
    "写作",
  ],
  general: [],
};

const activityTerms: Record<StyleLearningActivity, readonly string[]> = {
  explain: ["理解", "解释", "讲解", "入门", "认识", "原理", "概念"],
  derive: ["推导", "证明", "公式", "计算", "解题", "步骤"],
  compare: ["比较", "对比", "异同", "优缺点", "取舍", "区别"],
  remember: ["记忆", "背诵", "词汇", "术语", "复习", "巩固"],
  practice: ["练习", "实操", "应用", "训练", "动手", "演练"],
  explore: ["探索", "观察", "实验", "发现", "调查", "研究"],
  assess: [
    "测验",
    "考试",
    "选择题",
    "判断",
    "答题",
    "挑战",
    "评估",
    "反馈",
  ],
};

const narrativeTerms: Record<StyleNarrativeMode, readonly string[]> = {
  tutorial: ["教程", "入门", "讲解", "步骤", "学习"],
  story: ["故事", "历史", "人物", "文学", "叙事", "旅程"],
  argument: ["观点", "论证", "辩论", "政策", "主张"],
  "case-study": ["案例", "场景", "复盘", "项目", "实践"],
  lab: ["实验", "研究", "假设", "验证"],
  quest: ["闯关", "任务", "挑战", "冒险", "成就"],
  reference: ["手册", "参考", "报告", "白皮书", "规范", "指南"],
};

const affordanceTerms: Record<StyleContentAffordance, readonly string[]> = {
  formula: ["公式", "方程", "推导", "证明", "数学", "物理", "计算"],
  code: ["代码", "编程", "程序", "算法", "开发", "api"],
  chart: ["数据", "图表", "统计", "趋势", "指标", "分析"],
  table: ["表格", "清单", "对比", "财务", "矩阵", "参数"],
  timeline: ["时间线", "历史", "过程", "阶段", "演变", "步骤"],
  "long-text": ["文学", "阅读", "政策", "文章", "引文", "报告"],
  photography: ["摄影", "自然", "动物", "植物", "艺术", "建筑"],
  illustration: ["儿童", "孩子", "故事", "角色", "插画", "启蒙"],
  diagram: [
    "原理",
    "系统",
    "结构",
    "机制",
    "流程",
    "关系",
    "架构",
    "光路",
    "散射",
    "波长",
    "几何",
    "svg",
  ],
  bilingual: ["双语", "中英", "英语", "英文", "翻译"],
  "high-interaction": [
    "高互动",
    "强互动",
    "练习",
    "闯关",
    "测验",
    "挑战",
    "探索",
  ],
};

const formalityOrder: Record<StyleFormality, number> = {
  low: 0,
  "medium-low": 1,
  medium: 2,
  "medium-high": 3,
  high: 4,
};

/** 把自然语言变成有限、可测试的视觉选择画像。 */
export function inferStyleIntent(
  input: StyleTemplateSearchInput,
): StyleIntentProfile {
  const text = normalize(`${input.query ?? ""} ${input.audience ?? ""}`);
  const inferredRisk = inferRiskContext(text);

  return {
    domains: unique([
      ...(input.domains ?? []),
      ...matchingKeys(domainTerms, text),
    ]),
    audienceStages: unique([
      ...(input.audienceStages ?? []),
      ...inferAudienceStages(text),
    ]),
    learningActivities: unique([
      ...(input.learningActivities ?? []),
      ...matchingKeys(activityTerms, text),
    ]),
    narrativeModes: unique([
      ...(input.narrativeModes ?? []),
      ...matchingKeys(narrativeTerms, text),
    ]),
    contentAffordances: unique([
      ...(input.contentAffordances ?? []),
      ...matchingKeys(affordanceTerms, text),
    ]),
    formality: input.formality ?? inferFormality(text, inferredRisk),
    scheme: input.scheme ?? inferScheme(text),
    riskContext: input.riskContext ?? inferredRisk,
  };
}

/** 先应用风险硬约束，再按语义评分并形成稳健/最佳/探索候选。 */
export function rankStyleTemplates(
  templates: readonly StyleTemplate[],
  input: StyleTemplateSearchInput,
): RankedStyleTemplate[] {
  const profile = inferStyleIntent(input);
  const searchText = normalize(`${input.query ?? ""} ${input.audience ?? ""}`);
  const limit = Math.min(templates.length, Math.max(1, input.limit ?? 3));
  const riskCompatible = templates.filter(({ profile: templateProfile }) =>
    templateProfile.riskContexts.includes(profile.riskContext),
  );
  const scored = riskCompatible
    .map((template) => scoreTemplate(template, input, profile, searchText, templates))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const hasSignal = scored.some(({ score }) => score !== 0);

  if (!hasSignal) {
    return scored.slice(0, limit).map((entry, index) =>
      finalize(entry, index === 0 ? "best-match" : index === 1 ? "safe" : "explore", 0),
    );
  }

  const selected: Array<ScoredStyleTemplate & { candidateRole: StyleCandidateRole }> = [];
  const best = scored[0];
  if (best) selected.push({ ...best, candidateRole: "best-match" });

  const safe = scored
    .filter(({ template }) => template.id !== best?.template.id)
    .sort(
      (left, right) =>
        safeCandidateScore(right) - safeCandidateScore(left) ||
        right.score - left.score ||
        left.index - right.index,
    )[0];
  if (safe) selected.push({ ...safe, candidateRole: "safe" });

  const explore = scored
    .filter(
      ({ template }) =>
        !selected.some((candidate) => candidate.template.id === template.id),
    )
    .sort(
      (left, right) =>
        explorationScore(right, best) - explorationScore(left, best) ||
        right.score - left.score ||
        left.index - right.index,
    )[0];
  if (explore) selected.push({ ...explore, candidateRole: "explore" });

  for (const entry of scored) {
    if (selected.length >= limit) break;
    if (selected.some(({ template }) => template.id === entry.template.id)) {
      continue;
    }
    selected.push({ ...entry, candidateRole: "explore" });
  }

  const topScore = best?.score ?? 0;
  const secondScore = scored[1]?.score ?? 0;
  const scoreGap = Math.max(0, topScore - secondScore);
  const hasExplicitBestMatch = Boolean(
    best?.factors.some(
      ({ key, score }) => key === "explicit" && score >= 24,
    ),
  );
  const confidence = hasExplicitBestMatch
    ? 1
    : Math.min(1, topScore / 80) *
      (0.35 + Math.min(1, scoreGap / 20) * 0.65);

  return selected
    .slice(0, limit)
    .map(({ candidateRole, ...entry }) =>
      finalize(entry, candidateRole, confidence),
    );
}

function scoreTemplate(
  template: StyleTemplate,
  input: StyleTemplateSearchInput,
  intent: StyleIntentProfile,
  searchText: string,
  templates: readonly StyleTemplate[],
): ScoredStyleTemplate {
  const factors: StyleMatchFactor[] = [];
  const add = (factor: StyleMatchFactor) => factors.push(factor);

  if (input.visualStyle === template.visualStyle) {
    add({ key: "explicit", score: 28, label: `明确方向：${template.name}` });
  }

  const explicitTerms = [template.id, template.name, template.visualStyle];
  const explicitTerm = explicitTerms.find(
    (term) => searchText && searchText.includes(normalize(term)),
  );
  if (explicitTerm) {
    add({ key: "explicit", score: 24, label: `点名：${explicitTerm}` });
  }

  const matchedKeywords = template.keywords.filter(
    (term) => searchText && searchText.includes(normalize(term)),
  );
  if (matchedKeywords.length > 0) {
    add({
      key: "keyword",
      score: Math.min(15, matchedKeywords.length * 3),
      label: `视觉词：${matchedKeywords.slice(0, 3).join("、")}`,
    });
  }

  addOverlapFactor(
    factors,
    "domain",
    "主题领域",
    intent.domains,
    template.profile.domains,
    8,
    16,
  );
  addOverlapFactor(
    factors,
    "activity",
    "学习动作",
    intent.learningActivities,
    template.profile.learningActivities,
    7,
    18,
  );
  addOverlapFactor(
    factors,
    "narrative",
    "叙事模式",
    intent.narrativeModes,
    template.profile.narrativeModes,
    6,
    12,
  );
  addOverlapFactor(
    factors,
    "affordance",
    "内容承载",
    intent.contentAffordances,
    template.profile.contentAffordances,
    5,
    20,
  );

  if (intent.audienceStages.length > 0) {
    const audienceMatches = overlap(
      intent.audienceStages,
      template.profile.audienceStages,
    );
    add({
      key: "audience",
      score: audienceMatches.length > 0 ? 15 : -18,
      label:
        audienceMatches.length > 0
          ? `受众：${audienceMatches.map(stageLabel).join("、")}`
          : "受众阶段不匹配",
    });
  }

  if (intent.formality) {
    const distance = Math.abs(
      formalityOrder[intent.formality] -
        formalityOrder[template.profile.formality],
    );
    const score = distance === 0 ? 10 : distance === 1 ? 6 : distance === 2 ? 0 : -8;
    add({
      key: "formality",
      score,
      label: `正式度：${template.profile.formality}`,
    });
  }

  if (intent.scheme) {
    add({
      key: "scheme",
      score: intent.scheme === template.profile.scheme ? 5 : -3,
      label: `明暗：${template.profile.scheme}`,
    });
  }

  const matchedTones = template.profile.tones.filter(
    (tone) => searchText && searchText.includes(normalize(tone)),
  );
  if (matchedTones.length > 0) {
    add({
      key: "tone",
      score: Math.min(9, matchedTones.length * 3),
      label: `气质：${matchedTones.join("、")}`,
    });
  }

  return {
    template,
    factors,
    score: factors.reduce((sum, factor) => sum + factor.score, 0),
    index: templates.indexOf(template),
  };
}

function addOverlapFactor<T extends string>(
  factors: StyleMatchFactor[],
  key: StyleMatchFactor["key"],
  label: string,
  requested: readonly T[],
  supported: readonly T[],
  pointsPerMatch: number,
  cap: number,
) {
  const matches = overlap(requested, supported);
  if (matches.length === 0) return;
  factors.push({
    key,
    score: Math.min(cap, matches.length * pointsPerMatch),
    label: `${label}：${matches.join("、")}`,
  });
}

function finalize(
  entry: ScoredStyleTemplate,
  candidateRole: StyleCandidateRole,
  confidence: number,
): RankedStyleTemplate {
  const positiveFactors = entry.factors
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
  const warning = entry.factors.find(({ score }) => score < 0);
  const reason = [
    ...positiveFactors.map(({ label }) => label),
    ...(warning ? [warning.label] : []),
  ].join("；");

  return {
    template: entry.template,
    score: entry.score,
    factors: entry.factors,
    candidateRole,
    confidence,
    reason: reason || "没有强信号，作为可继续比较的通用视觉方向。",
  };
}

function safeCandidateScore(entry: ScoredStyleTemplate) {
  return (
    entry.score +
    (entry.template.profile.safeDefault ? 12 : 0) +
    formalityOrder[entry.template.profile.formality] * 2 +
    (entry.template.profile.scheme === "light" ? 2 : 0)
  );
}

function explorationScore(
  entry: ScoredStyleTemplate,
  best: ScoredStyleTemplate | undefined,
) {
  if (!best) return entry.score;
  const familyBonus =
    entry.template.profile.family !== best.template.profile.family ? 8 : 0;
  const schemeBonus =
    entry.template.profile.scheme !== best.template.profile.scheme ? 5 : 0;
  const motionBonus =
    entry.template.motion.intensity !== best.template.motion.intensity ? 3 : 0;
  return entry.score + familyBonus + schemeBonus + motionBonus;
}

function matchingKeys<T extends string>(
  dictionary: Record<T, readonly string[]>,
  text: string,
): T[] {
  return (Object.keys(dictionary) as T[]).filter((key) =>
    containsAny(text, dictionary[key]),
  );
}

function inferAudienceStages(text: string): StyleAudienceStage[] {
  const age = Number(text.match(/(\d{1,2})\s*岁/u)?.[1]);
  if (Number.isFinite(age)) {
    if (age <= 7) return ["early-childhood"];
    if (age <= 12) return ["young-learners"];
    if (age <= 18) return ["secondary"];
  }
  if (containsAny(text, ["幼儿", "学龄前", "幼稚园", "幼儿园"])) {
    return ["early-childhood"];
  }
  if (containsAny(text, ["儿童", "孩子", "小学生", "小学"])) {
    return ["young-learners"];
  }
  if (containsAny(text, ["中学生", "初中", "高中", "青少年"])) {
    return ["secondary"];
  }
  if (containsAny(text, ["大学", "本科", "研究生", "高校", "学术"])) {
    return ["higher-education"];
  }
  if (
    containsAny(text, [
      "职场",
      "员工",
      "企业",
      "管理层",
      "高管",
      "专业人士",
      "医生",
      "教师",
    ])
  ) {
    return ["professional"];
  }
  return [];
}

function inferRiskContext(text: string): StyleRiskContext {
  if (
    containsAny(text, [
      "合规",
      "法律",
      "监管",
      "法规",
      "审计",
      "患者安全",
      "临床规范",
    ])
  ) {
    return "regulated";
  }
  if (containsAny(text, ["医疗", "护理", "患者", "健康", "心理", "营养"])) {
    return "care";
  }
  return "standard";
}

function inferFormality(
  text: string,
  riskContext: StyleRiskContext,
): StyleFormality | undefined {
  if (riskContext === "regulated") return "high";
  if (
    containsAny(text, [
      "管理层",
      "董事会",
      "企业",
      "专业",
      "学术",
      "研究",
      "报告",
      "政策",
      "财务",
    ])
  ) {
    return "high";
  }
  if (containsAny(text, ["儿童", "孩子", "活泼", "可爱", "游戏", "闯关"])) {
    return "low";
  }
  return undefined;
}

function inferScheme(text: string): StyleColorScheme | undefined {
  if (containsAny(text, ["暗色", "深色", "夜间", "黑色", "霓虹"])) {
    return "dark";
  }
  if (containsAny(text, ["浅色", "明亮", "打印", "白色", "清爽"])) {
    return "light";
  }
  return undefined;
}

function stageLabel(stage: StyleAudienceStage) {
  const labels: Record<StyleAudienceStage, string> = {
    "early-childhood": "幼儿",
    "young-learners": "儿童",
    secondary: "中学生",
    "higher-education": "高校",
    professional: "专业人士",
    general: "大众",
  };
  return labels[stage];
}

function overlap<T extends string>(left: readonly T[], right: readonly T[]) {
  return left.filter((value) => right.includes(value));
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function containsAny(text: string, terms: readonly string[]) {
  return Boolean(text) && terms.some((term) => text.includes(normalize(term)));
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}
