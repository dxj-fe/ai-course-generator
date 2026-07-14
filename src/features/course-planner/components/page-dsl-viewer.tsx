"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type {
  CourseIntent,
  PageContentDSL,
  PagePlan,
  PageWorkerBrief,
} from "@/shared/course-schema";

import {
  type PageWriterResponse,
  writeCoursePage,
} from "../lib/course-planner-api";

/** 选择一个 PagePlan，生成并检查其 PageContentDSL 与 HTML 自由边界。 */
export function PageDSLViewer({
  intent,
  pages,
  briefs,
}: {
  intent: CourseIntent;
  pages: PagePlan[];
  briefs: PageWorkerBrief[];
}) {
  const [selectedPageId, setSelectedPageId] = useState(pages[0]?.id ?? "");
  const [result, setResult] = useState<PageWriterResponse>();
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const selectedPage = useMemo(
    () => pages.find(({ id }) => id === selectedPageId),
    [pages, selectedPageId],
  );
  const selectedBrief = useMemo(
    () => briefs.find(({ pageId }) => pageId === selectedPageId),
    [briefs, selectedPageId],
  );

  /** 请求单页 DSL；切换页面后只重跑该页，不重复执行上游工作流。 */
  async function runPageWriter() {
    if (!selectedPage || !selectedBrief) {
      setError("当前页面缺少 PagePlan 或 PageWorkerBrief。");
      return;
    }

    setIsRunning(true);
    setError("");
    setResult(undefined);

    try {
      setResult(
        await writeCoursePage({
          intent,
          page: selectedPage,
          brief: selectedBrief,
        }),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Page Writer 请求失败。",
      );
    } finally {
      setIsRunning(false);
    }
  }

  /** 清空旧页面结果，避免把上一页 DSL 误认为当前选中页。 */
  function selectPage(pageId: string) {
    setSelectedPageId(pageId);
    setResult(undefined);
    setError("");
  }

  return (
    <section
      aria-labelledby="page-dsl-title"
      className="grid gap-4 border-t border-[#d8dee8] pt-6"
    >
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#0369a1]">
          Day 12 · Page Content DSL
        </p>
        <h4
          className="mt-1 text-xl font-semibold text-[#101827]"
          id="page-dsl-title"
        >
          单页内容协议检查器
        </h4>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748b]">
          DSL 约束内容、互动和素材槽位；HTML Engineer 仍可在模板和
          StyleToken 边界内自由实现视觉表现。
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#d8dee8] bg-white p-4 shadow-sm">
        <label className="grid min-w-64 flex-1 gap-1 text-sm font-semibold text-[#344054]">
          选择 PagePlan
          <NativeSelect
            className="w-full [&_select]:min-h-11 [&_select]:rounded-lg [&_select]:border-[#cbd5e1] [&_select]:bg-[#fbfdff] [&_select]:pl-3 [&_select]:text-sm [&_select]:font-normal [&_select]:outline-none [&_select]:focus:border-[#0284c7] [&_select]:focus:ring-2 [&_select]:focus:ring-[#bae6fd]"
            onChange={(event) => selectPage(event.currentTarget.value)}
            value={selectedPageId}
          >
            {pages.map((page) => (
              <NativeSelectOption key={page.id} value={page.id}>
                {String(page.order).padStart(2, "0")} · {page.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {selectedPage ? (
          <span className="rounded-full bg-[#e0f2fe] px-3 py-2 text-xs font-semibold text-[#0369a1]">
            {selectedPage.functionalTemplateId}
          </span>
        ) : null}
        <Button
          className="min-h-11 rounded-lg bg-[#0369a1] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#075985] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
          disabled={isRunning || !selectedPage || !selectedBrief}
          onClick={runPageWriter}
          type="button"
        >
          {isRunning ? "正在生成 Page DSL..." : "生成 Page DSL"}
        </Button>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-[#fecaca] bg-[#fef2f2] p-4 text-sm text-[#b42318]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {result ? <PageWriterTimeline result={result} /> : null}
      {result?.state.content ? (
        <PageDslResult dsl={result.state.content} />
      ) : null}
    </section>
  );
}

/** 展示 Page Writer 的公开事件摘要和失败原因。 */
function PageWriterTimeline({ result }: { result: PageWriterResponse }) {
  return (
    <section className="rounded-xl border border-[#d8dee8] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="font-semibold text-[#101827]">Page Writer Timeline</h5>
        <span className="rounded-full bg-[#e0f2fe] px-3 py-1 text-xs font-semibold text-[#0369a1]">
          {result.state.status}
        </span>
      </div>
      {result.state.error ? (
        <p className="mt-3 rounded-lg bg-[#fef2f2] p-3 text-sm text-[#b42318]" role="alert">
          {result.state.error.message}
        </p>
      ) : null}
      <ol className="mt-3 grid gap-2">
        {result.state.events.map((event) => (
          <li
            className="grid gap-1 rounded-lg bg-[#f8fafc] px-3 py-2 text-sm sm:grid-cols-[2rem_6rem_1fr]"
            key={event.id}
          >
            <span className="font-mono text-xs font-bold text-[#0284c7]">
              {String(event.sequence).padStart(2, "0")}
            </span>
            <span className="font-semibold text-[#344054]">{event.type}</span>
            <span className="text-[#64748b]">{event.summary}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 分区展示 DSL，并明确标记 HTML 仍属于下一阶段。 */
function PageDslResult({ dsl }: { dsl: PageContentDSL }) {
  return (
    <div className="grid gap-4">
      <section className="grid gap-4 rounded-xl border border-[#d8dee8] bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1.3fr)_minmax(16rem,0.7fr)]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="text-lg font-semibold text-[#101827]">{dsl.title}</h5>
            <span className="rounded-full bg-[#f1f5f9] px-2 py-1 font-mono text-xs text-[#475569]">
              DSL v{dsl.version}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-[#64748b]">
            {dsl.pageId} · {dsl.functionalTemplateId}
          </p>
          <div className="mt-4 grid gap-3">
            {dsl.blocks.length > 0 ? (
              dsl.blocks.map((block) => (
                <article
                  className="rounded-lg border border-[#e2e8f0] bg-[#fbfdff] p-3"
                  key={block.id}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-[#0284c7]">{block.id}</span>
                    <span className="rounded bg-[#e0f2fe] px-2 py-0.5 text-xs font-semibold text-[#0369a1]">
                      {block.kind}
                    </span>
                    <strong className="text-sm text-[#344054]">{block.heading}</strong>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#475569]">{block.body}</p>
                </article>
              ))
            ) : (
              <p className="rounded-lg bg-[#f8fafc] p-3 text-sm text-[#64748b]">
                当前模板不需要正文 blocks。
              </p>
            )}
          </div>
        </div>
        <div className="grid content-start gap-3">
          <BoundaryCard
            label="DSL 已约束"
            tone="blue"
            values={["内容语义与顺序", "互动数据与反馈", "素材用途与替代文本", "弱布局提示"]}
          />
          <BoundaryCard
            label="HTML 尚未生成"
            tone="gray"
            values={["DOM 与组件结构", "CSS 与响应式布局", "具体动效表现", "安全 iframe 预览"]}
          />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <JsonCard label="Interaction" value={dsl.interaction} />
        <JsonCard label="Asset Slots" value={dsl.assetSlots} />
        <JsonCard label="Layout Hints" value={dsl.layoutHints} />
      </section>

      <details className="rounded-lg border border-[#d8dee8] bg-[#f8fafc] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-[#344054]">
          查看完整 PageContentDSL
        </summary>
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-[#eef2f7] p-3 font-mono text-xs leading-5 text-[#172033]">
          {JSON.stringify(dsl, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/** 展示 DSL 与 HTML 两侧的职责清单。 */
function BoundaryCard({
  label,
  tone,
  values,
}: {
  label: string;
  tone: "blue" | "gray";
  values: string[];
}) {
  const className =
    tone === "blue"
      ? "border-[#bae6fd] bg-[#f0f9ff] text-[#075985]"
      : "border-[#e2e8f0] bg-[#f8fafc] text-[#475569]";

  return (
    <div className={`rounded-lg border p-3 ${className}`}>
      <h6 className="text-sm font-semibold">{label}</h6>
      <ul className="mt-2 grid gap-1 text-xs leading-5">
        {values.map((value) => (
          <li key={value}>· {value}</li>
        ))}
      </ul>
    </div>
  );
}

/** 紧凑展示互动、素材和布局提示的结构化 JSON。 */
function JsonCard({ label, value }: { label: string; value: unknown }) {
  return (
    <article className="min-w-0 rounded-xl border border-[#d8dee8] bg-white p-4 shadow-sm">
      <h5 className="font-semibold text-[#101827]">{label}</h5>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-[#f8fafc] p-3 font-mono text-xs leading-5 text-[#475569]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </article>
  );
}
