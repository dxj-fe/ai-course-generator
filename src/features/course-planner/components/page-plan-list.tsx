import type { CoursePlan } from "@/shared/course-schema";

const pageTypeLabels: Record<CoursePlan["pages"][number]["pageType"], string> = {
  cover: "课程封面",
  story_intro: "故事导入",
  knowledge_card: "知识卡",
  quiz: "互动测验",
  comparison: "对比分析",
  timeline: "学习时间线",
  summary: "总结复习",
  achievement: "任务成就",
};

/** 按教学顺序展示 PagePlan、依赖、交互和素材需求。 */
export function PagePlanList({ pages }: { pages: CoursePlan["pages"] }) {
  return (
    <section aria-labelledby="page-plan-list-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          className="text-lg font-semibold text-[#101827]"
          id="page-plan-list-title"
        >
          PagePlan List
        </h3>
        <p className="text-xs text-[#64748b]">引入 → 讲解 → 互动 → 总结</p>
      </div>
      <ol className="mt-4 grid gap-4">
        {pages.map((page) => (
          <li
            className="rounded-xl border border-[#d8dee8] bg-white p-5 shadow-sm"
            key={page.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#ede9fe] font-mono text-sm font-bold text-[#6d28d9]">
                  {String(page.order).padStart(2, "0")}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#7c3aed]">
                    {pageTypeLabels[page.pageType]} · {page.interactionType}
                  </p>
                  <h4 className="mt-1 text-lg font-semibold text-[#101827]">
                    {page.title}
                  </h4>
                  <p className="mt-1 font-mono text-xs text-[#94a3b8]">
                    {page.id}
                  </p>
                </div>
              </div>
              <span className="rounded-full bg-[#f1f5f9] px-3 py-1 text-xs font-medium text-[#475569]">
                {page.functionalTemplateId}
              </span>
            </div>

            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-[#344054]">页面目标</dt>
                <dd className="mt-1 leading-6 text-[#64748b]">
                  {page.learningObjective}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[#344054]">核心信息</dt>
                <dd className="mt-1 leading-6 text-[#64748b]">
                  {page.contentSummary}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[#344054]">依赖页面</dt>
                <dd className="mt-1 text-[#64748b]">
                  {page.dependsOnPageIds.length > 0
                    ? page.dependsOnPageIds.join("、")
                    : "无"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-[#344054]">样式模板</dt>
                <dd className="mt-1 text-[#64748b]">
                  {page.styleTemplateId}
                </dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-[#e2e8f0] pt-4">
              <h5 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#64748b]">
                Asset Needs
              </h5>
              {page.assetNeeds.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {page.assetNeeds.map((need, index) => (
                    <li
                      className="rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1 text-xs text-[#475569]"
                      key={`${page.id}-${need.type}-${index}`}
                    >
                      {need.type}/{need.role} · {need.purpose}
                      {need.required ? " · 必需" : " · 可选"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-[#94a3b8]">无需新增素材</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
