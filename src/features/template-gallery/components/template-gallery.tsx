import Link from "next/link";

import {
  getFunctionalTemplateExample,
  listFunctionalTemplates,
  type FunctionalTemplate,
} from "@/shared/templates/functional";

import { StyleTemplateGallery } from "./style-template-gallery";

/** 展示共享 Registry 中的全部功能模板和 PagePlan mock。 */
export function TemplateGallery() {
  const templates = listFunctionalTemplates();

  return (
    <main className="min-h-screen bg-[#f4f7fb] text-[#172033]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-5 py-8 sm:px-8 lg:py-12">
        <header className="flex flex-col gap-5 border-b border-[#d8dee8] pb-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#436b8f]">
                Day 09 · Template Registries
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#101827] sm:text-4xl">
                模板系统清单
              </h1>
            </div>
            <Link
              className="rounded-full border border-[#cbd5e1] bg-white px-4 py-2 text-sm font-medium text-[#344054] transition hover:border-[#7c3aed] hover:text-[#6d28d9]"
              href="/"
            >
              返回工程训练台
            </Link>
          </div>
          <p className="max-w-3xl text-sm leading-7 text-[#64748b]">
            功能模板定义教学任务，样式模板定义视觉语言。两个 Registry 相互独立，并通过 PagePlan、Theme 和 CSS Variables 组合。
          </p>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            <span className="rounded-full bg-[#ede9fe] px-3 py-1.5 text-[#6d28d9]">
              {templates.length} 个功能模板
            </span>
            <span className="rounded-full bg-[#e0f2fe] px-3 py-1.5 text-[#0369a1]">
              6 个样式模板
            </span>
            <span className="rounded-full bg-[#dcfce7] px-3 py-1.5 text-[#15803d]">
              48 种组合已校验
            </span>
          </div>
        </header>

        <section className="flex flex-col gap-6" aria-labelledby="functional-templates">
          <header>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#436b8f]">
              Day 08 · Functional Template Registry
            </p>
            <h2
              className="mt-2 text-2xl font-semibold text-[#101827]"
              id="functional-templates"
            >
              功能模板清单
            </h2>
          </header>
          <div
            className="grid items-start gap-6 lg:grid-cols-2"
            aria-label="功能模板列表"
          >
            {templates.map((template) => (
              <TemplateCard key={template.id} template={template} />
            ))}
          </div>
        </section>

        <StyleTemplateGallery />
      </div>
    </main>
  );
}

/** 展示一个模板的目标、槽位、边界和对应的 PagePlan 示例。 */
function TemplateCard({ template }: { template: FunctionalTemplate }) {
  const example = getFunctionalTemplateExample(template.id);

  return (
    <article className="overflow-hidden rounded-2xl border border-[#d8dee8] bg-white shadow-sm">
      <header className="border-b border-[#e5eaf1] bg-[#fbfdff] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-[#64748b]">{template.id}</p>
            <h2 className="mt-1 text-xl font-semibold text-[#101827]">
              {template.name}
            </h2>
          </div>
          <span className="rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-semibold text-[#6d28d9]">
            {template.pageType}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-[#475569]">{template.goal}</p>
      </header>

      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <section aria-labelledby={`${template.id}-slots`}>
          <h3
            className="text-sm font-semibold text-[#344054]"
            id={`${template.id}-slots`}
          >
            结构槽位
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {template.slots.map((slot) => (
              <div
                className="rounded-lg border border-[#dbe5f0] bg-[#f8fafc] p-3"
                key={slot.name}
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs font-semibold text-[#1d4ed8]">
                    {slot.name}
                  </code>
                  <span
                    className={`text-[11px] font-medium ${
                      slot.required ? "text-[#b42318]" : "text-[#64748b]"
                    }`}
                  >
                    {slot.required ? "必填" : "可选"} · {slot.minItems}–
                    {slot.maxItems}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#64748b]">
                  {slot.goal}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-5 sm:grid-cols-2">
          <TemplateList
            id={`${template.id}-best-for`}
            items={template.bestFor}
            label="适合场景"
            tone="positive"
          />
          <TemplateList
            id={`${template.id}-avoid-for`}
            items={template.avoidFor}
            label="避免使用"
            tone="negative"
          />
        </div>

        <TemplateList
          id={`${template.id}-constraints`}
          items={template.constraints}
          label="模板约束"
          tone="neutral"
        />

        {example ? (
          <details className="rounded-lg border border-[#d8dee8] bg-[#f8fafc] p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#344054]">
              查看 PagePlan mock
            </summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-[#eef2f7] p-3 font-mono text-xs leading-5 text-[#172033]">
              {JSON.stringify(example, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
    </article>
  );
}

/** 使用统一的列表样式展示适用场景、避免场景或模板约束。 */
function TemplateList({
  id,
  items,
  label,
  tone,
}: {
  id: string;
  items: string[];
  label: string;
  tone: "positive" | "negative" | "neutral";
}) {
  const toneClass = {
    positive: "text-[#15803d]",
    negative: "text-[#b42318]",
    neutral: "text-[#475569]",
  }[tone];

  return (
    <section aria-labelledby={id}>
      <h3 className={`text-sm font-semibold ${toneClass}`} id={id}>
        {label}
      </h3>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-xs leading-5 text-[#64748b]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
