"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  Compass,
  Palette,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";

import {
  listStyleTemplates,
  searchStyleTemplates,
  styleTemplateToCssText,
  styleTemplateToCssVariables,
  type CourseCssVariables,
  type StyleCandidateRole,
  type StyleTemplate,
} from "@/shared/templates/style";

type PreviewStyle = CSSProperties & CourseCssVariables;

const matcherExamples = [
  "给 10 岁孩子讲太阳系，通过探索任务认识行星",
  "面向大学生推导轨道力学公式，并安排计算练习",
  "为管理层制作生成式 AI 风险、法规与合规培训",
  "用故事和作品赏析讲中国古典文学",
] as const;

const rolePresentation: Record<
  StyleCandidateRole,
  { label: string; description: string; icon: typeof Target }
> = {
  "best-match": {
    label: "最佳匹配",
    description: "语义信号最完整",
    icon: Target,
  },
  safe: {
    label: "稳健方案",
    description: "更克制、容错更高",
    icon: ShieldCheck,
  },
  explore: {
    label: "探索方向",
    description: "保留有价值的视觉反差",
    icon: Compass,
  },
};

const familyLabels: Record<StyleTemplate["profile"]["family"], string> = {
  technology: "科技系统",
  editorial: "编辑叙事",
  authority: "专业权威",
  playful: "趣味启蒙",
  organic: "自然观察",
  academic: "课堂推导",
  immersive: "沉浸任务",
};

const previewContent: Record<
  string,
  { eyebrow: string; title: string; summary: string; motif: string; steps: string[] }
> = {
  "sci-fi": {
    eyebrow: "ORBIT LAB · 03",
    title: "星轨实验室",
    summary: "读取轨道数据，理解一颗行星如何完成它的一年。",
    motif: "04:21",
    steps: ["扫描", "建模", "解码"],
  },
  "editorial-night": {
    eyebrow: "VOLUME 07 · NIGHT READING",
    title: "文明的夜读",
    summary: "从作品、时代与思想的交汇处，读懂一段文化脉络。",
    motif: "文",
    steps: ["细读", "溯源", "辨析"],
  },
  broadside: {
    eyebrow: "ISSUE 01 / MAKE A STANCE",
    title: "城市不是背景",
    summary: "用强观点、关键证据与视觉节奏组织一场公共讨论。",
    motif: "燃",
    steps: ["提问", "证据", "立场"],
  },
  "kids-playful": {
    eyebrow: "SPROUT MISSION 01",
    title: "太阳系寻宝队",
    summary: "跟着轨道线索拜访行星，每发现一次就点亮一颗星。",
    motif: "✦",
    steps: ["出发", "发现", "收集"],
  },
  minimal: {
    eyebrow: "DECISION BRIEF / 01",
    title: "AI 风险决策框架",
    summary: "把机会、风险、控制措施和决策门槛放进同一张地图。",
    motif: "01",
    steps: ["识别", "评估", "决策"],
  },
  nature: {
    eyebrow: "FIELD NOTE · LEAF 12",
    title: "一片叶的能量",
    summary: "沿着光、水与二氧化碳，观察能量如何进入生命系统。",
    motif: "◒",
    steps: ["采样", "观察", "归纳"],
  },
  blackboard: {
    eyebrow: "LESSON 04 · DERIVATION",
    title: "从圆到轨道",
    summary: "一步步拆开公式，让每个符号都对应一个可解释的动作。",
    motif: "v²/r",
    steps: ["已知", "推导", "验算"],
  },
  "game-quest": {
    eyebrow: "QUEST 02 · 120 XP",
    title: "Tense Quest",
    summary: "选择正确时态、击破干扰项，在即时反馈中巩固表达。",
    motif: "+XP",
    steps: ["装备", "闯关", "升级"],
  },
};

/** 展示可解释的按需匹配，以及八套真实可生成的样式模板。 */
export function StyleTemplateGallery() {
  const templates = listStyleTemplates();
  const [query, setQuery] = useState<string>(matcherExamples[0]);
  const matches = useMemo(
    () => searchStyleTemplates({ query, limit: 3 }),
    [query],
  );

  return (
    <section className="flex flex-col gap-8" aria-labelledby="style-templates">
      <header className="flex flex-wrap items-end justify-between gap-4 border-t border-[#cfe1ca] pt-10">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-[#4f7f59]">
            <Palette aria-hidden="true" className="size-4" />
            Visual Direction System
          </p>
          <h2
            className="mt-2 text-2xl font-semibold text-[#203c2a]"
            id="style-templates"
          >
            样式主题按需匹配
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-7 text-[#667568]">
            主题、受众、学习动作、叙事方式与内容承载能力共同决定视觉方向。系统给出最佳、稳健与探索三种候选，并说明为什么。
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d7dfac] bg-[#fff1c9] px-3 py-1.5 text-xs font-semibold text-[#75601f]">
          <Sparkles aria-hidden="true" className="size-3.5" />
          {templates.length} 套风格 · 64 种组合已校验
        </span>
      </header>

      <section
        aria-labelledby="visual-matcher-title"
        className="overflow-hidden rounded-[30px] border border-[#c9dfc4] bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(237,247,233,0.9))] shadow-[0_28px_80px_-54px_rgba(47,104,69,0.75)]"
      >
        <div className="grid gap-6 border-b border-[#d8e8d4] p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4f7f59]">
              Matching Lab
            </p>
            <h3
              className="mt-2 text-xl font-semibold text-[#203c2a]"
              id="visual-matcher-title"
            >
              输入你真正想学的内容
            </h3>
            <label className="relative mt-4 block" htmlFor="style-match-query">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-4 size-4 text-[#729078]"
              />
              <textarea
                className="min-h-28 w-full resize-y rounded-2xl border border-[#bfd6ba] bg-white/90 py-3.5 pl-11 pr-4 text-sm leading-6 text-[#294231] shadow-inner outline-none transition placeholder:text-[#8a9b8c] focus:border-[#5d966b] focus:ring-4 focus:ring-[#cfe7ca]/60"
                id="style-match-query"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="例如：面向大学生讲轨道力学，需要公式推导和练习……"
                value={query}
              />
            </label>
          </div>

          <div>
            <p className="text-sm font-semibold text-[#3f5a45]">试试典型课题</p>
            <div className="mt-3 flex flex-col gap-2">
              {matcherExamples.map((example, index) => (
                <button
                  className="rounded-xl border border-[#d3e4cf] bg-white/75 px-3 py-2.5 text-left text-xs leading-5 text-[#5f7162] transition hover:-translate-y-0.5 hover:border-[#9fc59a] hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none"
                  key={example}
                  onClick={() => setQuery(example)}
                  type="button"
                >
                  <span className="mr-2 font-mono font-semibold text-[#5d966b]">
                    0{index + 1}
                  </span>
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          aria-live="polite"
          className="grid items-start gap-4 p-5 sm:p-7 xl:grid-cols-3"
        >
          {matches.length < 3 ? (
            <p className="rounded-2xl border border-[#e5d59d] bg-[#fff7d9] px-4 py-3 text-xs leading-5 text-[#6d5b24] xl:col-span-3">
              当前主题触发了医疗、法律或合规风险硬约束；为避免用不合适的娱乐化视觉弱化严肃内容，只显示明确满足要求的方向。
            </p>
          ) : null}
          {matches.map((match) => {
            const role = rolePresentation[match.candidateRole];
            const RoleIcon = role.icon;
            return (
              <article
                className="overflow-hidden rounded-[24px] border border-[#d3e4cf] bg-[#fffcf5] shadow-[0_18px_46px_-38px_rgba(33,77,49,0.8)]"
                key={match.template.id}
              >
                <div className="flex items-center justify-between gap-3 border-b border-[#dbe8d7] px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#326a47]">
                    <RoleIcon aria-hidden="true" className="size-3.5" />
                    {role.label}
                  </span>
                  <span className="font-mono text-[11px] text-[#758778]">
                    {match.score > 0 ? `${match.score} pts` : "open choice"}
                  </span>
                </div>
                <StylePreview compact template={match.template} />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-[#718174]">{role.description}</p>
                      <h4 className="mt-1 text-lg font-semibold text-[#203c2a]">
                        {match.template.name}
                      </h4>
                    </div>
                    <span className="rounded-full bg-[#edf6e9] px-2.5 py-1 text-[11px] font-semibold text-[#4f7f59]">
                      {familyLabels[match.template.profile.family]}
                    </span>
                  </div>
                  <p className="mt-3 min-h-10 text-xs leading-5 text-[#667568]">
                    {match.reason}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {match.factors
                      .filter(({ score }) => score > 0)
                      .slice(0, 4)
                      .map((factor) => (
                        <span
                          className="rounded-full border border-[#d8e6d4] bg-white px-2 py-1 text-[10px] text-[#5c715f]"
                          key={`${factor.key}-${factor.label}`}
                        >
                          +{factor.score} {factor.label}
                        </span>
                      ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#4f7f59]">
          Production-ready directions
        </p>
        <h3 className="mt-2 text-xl font-semibold text-[#203c2a]">
          八套视觉能力谱系
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-[#667568]">
          每套模板绑定真实设计配方、语义能力画像与共享 CSS Variables；下方预览使用不同课题验证它们不是同一张卡片换颜色。
        </p>
      </div>

      <div
        className="grid items-start gap-6 lg:grid-cols-2"
        aria-label="样式模板列表"
      >
        {templates.map((template) => (
          <StyleTemplateCard key={template.id} template={template} />
        ))}
      </div>
    </section>
  );
}

function StylePreview({
  template,
  compact = false,
}: {
  template: StyleTemplate;
  compact?: boolean;
}) {
  const content = previewContent[template.id] ?? previewContent.minimal;
  const variables = styleTemplateToCssVariables(template);
  const previewStyle: PreviewStyle = {
    ...variables,
    backgroundColor: "var(--course-color-background)",
    backgroundImage: "var(--course-decoration-background)",
    color: "var(--course-color-text)",
    fontFamily: "var(--course-font-body)",
  };

  return (
    <div className={compact ? "p-3" : "p-4 sm:p-5"} style={previewStyle}>
      <div
        className="relative overflow-hidden rounded-[var(--course-radius-card)] border-[length:var(--course-border-width-card)] border-[var(--course-color-border)] bg-[var(--course-color-surface)] p-4 shadow-[var(--course-shadow-card)]"
        style={{ color: "var(--course-color-text)" }}
      >
        <div
          aria-hidden="true"
          className="absolute -right-10 -top-10 size-32 rounded-full border border-[var(--course-color-primary)] opacity-20"
        />
        <div
          aria-hidden="true"
          className="absolute -right-4 top-5 size-20 rounded-full border border-[var(--course-color-accent)] opacity-25"
        />
        <p
          className="relative text-[9px] font-bold uppercase tracking-[0.16em]"
          style={{ color: "var(--course-color-primary)" }}
        >
          {content.eyebrow}
        </p>
        <div className="relative mt-3 grid grid-cols-[minmax(0,1fr)_74px] items-center gap-3">
          <div>
            <h4
              className={compact ? "text-xl leading-tight" : "text-2xl leading-tight"}
              style={{
                fontFamily: "var(--course-font-heading)",
                fontWeight: "var(--course-font-weight-heading)",
              }}
            >
              {content.title}
            </h4>
            <p
              className="mt-2 text-[11px] leading-5"
              style={{ color: "var(--course-color-muted)" }}
            >
              {content.summary}
            </p>
          </div>
          <div
            className="relative flex aspect-square items-center justify-center overflow-hidden rounded-[var(--course-radius-control)] border border-[var(--course-color-border)] bg-[var(--course-color-surface-alt)]"
            style={{ color: "var(--course-color-accent)" }}
          >
            <span className="relative z-10 font-mono text-xl font-bold tracking-[-0.08em]">
              {content.motif}
            </span>
            <span className="absolute size-12 rounded-full border border-[var(--course-color-primary)] opacity-50" />
            <span className="absolute size-8 rotate-45 border border-[var(--course-color-accent)] opacity-35" />
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-[var(--course-spacing-card)]">
          {content.steps.map((label, index) => (
            <div
              className="rounded-[var(--course-radius-control)] border border-[var(--course-color-border)] bg-[var(--course-color-surface-alt)] px-2 py-2"
              key={label}
            >
              <span
                className="font-mono text-[8px] font-bold"
                style={{ color: "var(--course-color-primary)" }}
              >
                0{index + 1}
              </span>
              <p className="mt-0.5 text-[10px] font-semibold">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 使用模板生成的 CSS Variables 渲染单个风格预览和能力摘要。 */
function StyleTemplateCard({ template }: { template: StyleTemplate }) {
  const cssText = styleTemplateToCssText(template, `.${template.id}-theme`);

  return (
    <article className="keya-card-lift keya-page-reveal group overflow-hidden rounded-[26px] border border-[#d3e5cf] bg-[#fffcf5]/95 shadow-[0_18px_44px_-36px_rgba(47,104,69,0.52)]">
      <div className="border-b border-[#dce9d8]">
        <StylePreview template={template} />
      </div>

      <div className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-[#607562]">{template.id}</p>
            <h3 className="mt-1 text-xl font-semibold text-[#203c2a] transition-colors group-hover:text-[#2f6845]">
              {template.name}
            </h3>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <span className="rounded-full border border-[#c9dfc4] bg-[#edf7e9] px-3 py-1 text-xs font-semibold text-[#397a52]">
              {familyLabels[template.profile.family]}
            </span>
            <span className="rounded-full border border-[#d8dfbd] bg-[#f7f4df] px-3 py-1 text-xs font-semibold text-[#6e692e]">
              {template.profile.formality}
            </span>
          </div>
        </div>
        <p className="text-sm leading-6 text-[#617064]">{template.goal}</p>

        <section aria-label={`${template.name} 能力画像`}>
          <h4 className="text-sm font-semibold text-[#3f5a45]">适配能力</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ...template.profile.learningActivities,
              ...template.profile.contentAffordances.slice(0, 4),
            ].map((capability) => (
              <span
                className="rounded-full border border-[#d6e5d2] bg-[#f5faf1] px-2.5 py-1 text-xs text-[#667568]"
                key={capability}
              >
                {capability}
              </span>
            ))}
          </div>
        </section>

        <section aria-label={`${template.name} 色彩 Token`}>
          <h4 className="text-sm font-semibold text-[#3f5a45]">语义色彩</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {[
              ["背景", template.colorTokens.background],
              ["表面", template.colorTokens.surface],
              ["主色", template.colorTokens.primary],
              ["强调", template.colorTokens.accent],
              ["文字", template.colorTokens.text],
            ].map(([label, color]) => (
              <div
                className="flex items-center gap-2 rounded-full border border-[#d6e5d2] bg-[#f5faf1] py-1 pl-1 pr-3 text-xs text-[#667568]"
                key={label}
              >
                <span
                  className="size-5 rounded-full border border-black/10"
                  style={{ backgroundColor: color }}
                />
                {label}
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-4 text-xs text-[#667568] sm:grid-cols-2">
          <section>
            <h4 className="font-semibold text-[#3f5a45]">最适合</h4>
            <p className="mt-2 leading-5">{template.bestFor.slice(0, 3).join("、")}</p>
          </section>
          <section>
            <h4 className="font-semibold text-[#3f5a45]">设计配方</h4>
            <p className="mt-2 leading-5">
              {template.profile.inspirationTemplate} · {template.profile.scheme}
            </p>
          </section>
        </div>

        <details className="rounded-2xl border border-[#d6e5d2] bg-[#f5faf1] p-4 transition-colors open:bg-white">
          <summary className="cursor-pointer rounded text-sm font-semibold text-[#3f5a45] outline-none hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]">
            查看 CSS Variables
          </summary>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-[#dce9d8] bg-[#edf6e9] p-3 font-mono text-xs leading-5 text-[#294231]">
            {cssText}
          </pre>
        </details>
      </div>
    </article>
  );
}
