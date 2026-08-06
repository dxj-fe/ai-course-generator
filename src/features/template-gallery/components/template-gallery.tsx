import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Braces,
  LayoutTemplate,
  Palette,
  Sprout,
} from "lucide-react";

import {
  getFunctionalTemplateExample,
  listFunctionalTemplates,
  type FunctionalTemplate,
} from "@/shared/templates/functional";

import { StyleTemplateGallery } from "./style-template-gallery";

/** 展示共享 Registry 中的全部功能模板和 PagePlan 示例。 */
export function TemplateGallery() {
  const templates = listFunctionalTemplates();

  return (
    <main className="keya-product-shell relative min-h-screen overflow-hidden text-[#203c2a]">
      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-10 px-5 py-6 sm:px-8 lg:py-10">
        <header className="keya-page-reveal relative overflow-hidden rounded-[32px] border border-[#cfe4c9] bg-white/80 p-6 shadow-[0_24px_70px_-48px_rgba(47,104,69,0.55)] backdrop-blur sm:p-8 lg:p-10">
          <div className="relative z-10 grid items-center gap-7 lg:grid-cols-[minmax(0,1fr)_230px]">
            <div>
              <Link
                className="group inline-flex min-h-10 items-center gap-2 rounded-full border border-[#d2e5cd] bg-[#f4faef] px-4 text-sm font-medium text-[#397a52] transition duration-200 hover:-translate-y-0.5 hover:border-[#9dc498] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none"
                href="/"
              >
                <ArrowLeft
                  aria-hidden="true"
                  className="size-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transform-none"
                />
                返回课芽
              </Link>
              <p className="mt-7 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-[#4f7f59]">
                <Sprout aria-hidden="true" className="size-4" />
                Keya Template Garden
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-[#203c2a] sm:text-4xl lg:text-5xl">
                课程模板花园
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[#667568] sm:text-base">
                功能模板定义教学任务，样式模板定义视觉语言。两个 Registry
                相互独立，并通过 PagePlan、Theme 和 CSS Variables 组合。
              </p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cfe3ca] bg-[#e7f4e2] px-3 py-1.5 text-[#2f6845]">
                  <LayoutTemplate aria-hidden="true" className="size-3.5" />
                  {templates.length} 个功能模板
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d8e5bd] bg-[#f2f6db] px-3 py-1.5 text-[#5d6f2e]">
                  <Palette aria-hidden="true" className="size-3.5" />
                  8 个样式模板
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#eed89d] bg-[#fff1c9] px-3 py-1.5 text-[#7b6423]">
                  <Braces aria-hidden="true" className="size-3.5" />
                  64 种组合已校验
                </span>
              </div>
            </div>

            <div
              aria-hidden="true"
              className="relative mx-auto hidden h-[210px] w-[210px] lg:block"
            >
              <span className="absolute inset-4 rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.95)_0%,rgba(208,236,196,0.7)_54%,transparent_72%)]" />
              <Image
                alt=""
                className="keya-gentle-bob relative h-full w-full object-contain drop-shadow-[0_20px_24px_rgba(47,104,69,0.17)]"
                height={1536}
                sizes="210px"
                src="/keya/images/keya-sprout-companion.png"
                width={1024}
              />
            </div>
          </div>
        </header>

        <section
          className="flex flex-col gap-6"
          aria-labelledby="functional-templates"
        >
          <header>
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-[#4f7f59]">
              <Sprout aria-hidden="true" className="size-4" />
              Course Structures
            </p>
            <h2
              className="mt-2 text-2xl font-semibold text-[#203c2a]"
              id="functional-templates"
            >
              功能模板
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
    <article className="keya-card-lift keya-page-reveal group overflow-hidden rounded-[26px] border border-[#d3e5cf] bg-[#fffcf5]/95 shadow-[0_18px_44px_-36px_rgba(47,104,69,0.52)] hover:border-[#acd0a7]">
      <header className="border-b border-[#dce9d8] bg-[linear-gradient(135deg,#f8fcf4,#eef8e9)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-[#607562]">{template.id}</p>
            <h2 className="mt-1 text-xl font-semibold text-[#203c2a] transition-colors group-hover:text-[#2f6845]">
              {template.name}
            </h2>
          </div>
          <span className="rounded-full border border-[#c9dfc4] bg-white/80 px-3 py-1 text-xs font-semibold text-[#397a52]">
            {template.pageType}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-[#617064]">
          {template.goal}
        </p>
      </header>

      <div className="flex flex-col gap-6 p-5 sm:p-6">
        <section aria-labelledby={`${template.id}-slots`}>
          <h3
            className="text-sm font-semibold text-[#3f5a45]"
            id={`${template.id}-slots`}
          >
            结构槽位
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {template.slots.map((slot) => (
              <div
                className="rounded-2xl border border-[#d9e8d5] bg-[#f5faf1] p-3 transition-colors hover:border-[#bcd7b7] hover:bg-white"
                key={slot.name}
              >
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs font-semibold text-[#397a52]">
                    {slot.name}
                  </code>
                  <span
                    className={`text-[11px] font-medium ${
                      slot.required ? "text-[#a54f3d]" : "text-[#607562]"
                    }`}
                  >
                    {slot.required ? "必填" : "可选"} · {slot.minItems}–
                    {slot.maxItems}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[#667568]">
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
          <details className="group/details rounded-2xl border border-[#d6e5d2] bg-[#f5faf1] p-4 transition-colors open:bg-white">
            <summary className="cursor-pointer rounded text-sm font-semibold text-[#3f5a45] outline-none hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]">
              查看 PagePlan 示例
            </summary>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-[#dce9d8] bg-[#edf6e9] p-3 font-mono text-xs leading-5 text-[#294231]">
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
    positive: "text-[#2f6845]",
    negative: "text-[#a54f3d]",
    neutral: "text-[#56675a]",
  }[tone];

  return (
    <section aria-labelledby={id}>
      <h3 className={`text-sm font-semibold ${toneClass}`} id={id}>
        {label}
      </h3>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-xs leading-5 text-[#667568] marker:text-[#8ab583]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
