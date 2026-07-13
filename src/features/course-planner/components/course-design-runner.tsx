"use client";

import { useState } from "react";

import { getErrorText } from "@/features/ai-playground/lib/messages";
import type {
  CourseDesignBriefs,
  CourseIntent,
  CoursePlan,
  PageWorkerBrief,
} from "@/shared/course-schema";

import { CourseDesignTabs } from "./course-design-tabs";
import { PageDSLViewer } from "./page-dsl-viewer";

type CourseDesignResponse = {
  traceId: string;
  state: {
    status: "completed" | "failed";
    events: Array<{
      id: string;
      sequence: number;
      agent: "pedagogy" | "story" | "visual";
      type: "start" | "model_call" | "tool_call" | "finish" | "error";
      summary: string;
    }>;
    briefs?: CourseDesignBriefs;
    pageWorkerBriefs?: PageWorkerBrief[];
    error?: { agent: string; code: string; message: string };
  };
};

const agentLabels = {
  pedagogy: "Pedagogy Agent",
  story: "Story Agent",
  visual: "Visual Director",
} as const;

/** 从已校验的 CoursePlan 启动 Day 11 专业设计工作流。 */
export function CourseDesignRunner({
  intent,
  outline,
}: {
  intent: CourseIntent;
  outline: CoursePlan;
}) {
  const [result, setResult] = useState<CourseDesignResponse>();
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  /** 调用串行工作流；后一个 Agent 只在前一个成功后运行。 */
  async function runCourseDesign() {
    setIsRunning(true);
    setError("");
    setResult(undefined);

    try {
      const response = await fetch("/api/courses/design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          outline,
          traceId: crypto.randomUUID(),
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(getErrorText(payload));
      }

      setResult(payload);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "专业设计工作流请求失败。",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section
      aria-labelledby="course-design-title"
      className="grid gap-4 border-t border-[#d8dee8] pt-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#7c3aed]">
            Day 11 · Professional Agents
          </p>
          <h3
            className="mt-1 text-xl font-semibold text-[#101827]"
            id="course-design-title"
          >
            教学、故事与视觉规划
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748b]">
            基于当前 CoursePlan 串行生成三个专业 brief，再按 pageId
            组装为 Page Worker 可直接消费的稳定输入。
          </p>
        </div>
        <button
          className="min-h-11 rounded-lg bg-[#6d28d9] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#5b21b6] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
          disabled={isRunning}
          onClick={runCourseDesign}
          type="button"
        >
          {isRunning ? "正在生成专业 Briefs..." : "生成专业 Briefs"}
        </button>
      </header>

      {error ? (
        <p
          className="rounded-lg border border-[#fecaca] bg-[#fef2f2] p-4 text-sm text-[#b42318]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {result ? <CourseDesignSummary result={result} /> : null}

      {result?.state.briefs ? (
        <CourseDesignTabs briefs={result.state.briefs} />
      ) : null}

      {result?.state.pageWorkerBriefs ? (
        <>
          <details className="rounded-lg border border-[#d8dee8] bg-[#f8fafc] p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#344054]">
              查看 Page Worker 交接协议（{result.state.pageWorkerBriefs.length} 页）
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-[#eef2f7] p-3 font-mono text-xs leading-5 text-[#172033]">
              {JSON.stringify(result.state.pageWorkerBriefs, null, 2)}
            </pre>
          </details>
          <PageDSLViewer
            briefs={result.state.pageWorkerBriefs}
            intent={intent}
            pages={outline.pages}
          />
        </>
      ) : null}
    </section>
  );
}

/** 展示各专业 Agent 的公开状态事件，不记录 Prompt 或私有推理链。 */
function CourseDesignSummary({ result }: { result: CourseDesignResponse }) {
  return (
    <section className="rounded-xl border border-[#d8dee8] bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-lg font-semibold text-[#101827]">
          Professional Agent Timeline
        </h4>
        <span className="rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-semibold text-[#6d28d9]">
          {result.state.status}
        </span>
      </div>
      {result.state.error ? (
        <p className="mt-3 rounded-lg bg-[#fef2f2] p-3 text-sm text-[#b42318]" role="alert">
          {result.state.error.agent}: {result.state.error.message}
        </p>
      ) : null}
      <ol className="mt-3 grid gap-2">
        {result.state.events.map((event) => (
          <li
            className="grid gap-1 rounded-lg bg-[#f8fafc] px-3 py-2 text-sm sm:grid-cols-[2rem_8rem_5rem_1fr]"
            key={event.id}
          >
            <span className="font-mono text-xs font-bold text-[#7c3aed]">
              {String(event.sequence).padStart(2, "0")}
            </span>
            <span className="font-semibold text-[#344054]">
              {agentLabels[event.agent]}
            </span>
            <span className="text-[#475569]">{event.type}</span>
            <span className="text-[#64748b]">{event.summary}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
