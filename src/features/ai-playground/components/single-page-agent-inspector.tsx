"use client";

import { FormEvent, useState } from "react";

import type { PagePlanDraft } from "@/shared/course-schema";

import { getErrorText } from "../lib/messages";

type AgentEvent = {
  id: string;
  sequence: number;
  type: "start" | "model_call" | "tool_call" | "finish" | "error";
  timestamp: string;
  step: number;
  summary: string;
};

type SinglePageAgentResponse = {
  traceId: string;
  state: {
    status: "idle" | "running" | "completed" | "failed";
    step: number;
    maxSteps: number;
    events: AgentEvent[];
    selectedTemplate?: {
      toolName: string;
      templateId: string;
      templateName: string;
      reason: string;
    };
    pagePlan?: PagePlanDraft;
    error?: { code: string; message: string };
  };
};

const defaultPageGoal = "设计一个太阳系互动问答页面";

const eventStyles: Record<AgentEvent["type"], string> = {
  start: "border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]",
  model_call: "border-[#ddd6fe] bg-[#f5f3ff] text-[#6d28d9]",
  tool_call: "border-[#bae6fd] bg-[#f0f9ff] text-[#0369a1]",
  finish: "border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]",
  error: "border-[#fecaca] bg-[#fef2f2] text-[#b42318]",
};

export function SinglePageAgentInspector() {
  const [pageGoal, setPageGoal] = useState(defaultPageGoal);
  const [audience, setAudience] = useState("8 岁儿童");
  const [maxSteps, setMaxSteps] = useState(3);
  const [result, setResult] = useState<SinglePageAgentResponse>();
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  async function runAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedGoal = pageGoal.trim();

    if (!trimmedGoal) {
      setError("请输入页面目标。");
      return;
    }

    setIsRunning(true);
    setError("");
    setResult(undefined);

    try {
      const response = await fetch("/api/agents/single-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageGoal: trimmedGoal,
          audience: audience.trim() || undefined,
          maxSteps,
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
          : "SinglePageAgent 请求失败。",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <article className="flex flex-col gap-5 rounded-xl border border-[#d8dee8] bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7c3aed]">
            Day 06 验收
          </p>
          <h3 className="mt-1 text-xl font-semibold text-[#101827]">
            SinglePageAgent Timeline
          </h3>
          <p className="mt-1 text-sm leading-6 text-[#64748b]">
            检查最终状态、模板选择、PagePlan 和事件顺序。
          </p>
        </div>
        <span className="rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-medium text-[#6d28d9]">
          /api/agents/single-page
        </span>
      </header>

      <form className="flex flex-col gap-3" onSubmit={runAgent}>
        <label
          className="text-sm font-medium text-[#344054]"
          htmlFor="agent-page-goal"
        >
          Page Goal
        </label>
        <textarea
          id="agent-page-goal"
          className="min-h-20 resize-y rounded-md border border-[#cbd5e1] bg-[#fbfdff] p-3 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#ddd6fe]"
          value={pageGoal}
          onChange={(event) => setPageGoal(event.currentTarget.value)}
        />

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <label className="flex flex-col gap-2 text-sm font-medium text-[#344054]">
            Audience
            <input
              className="min-h-10 rounded-md border border-[#cbd5e1] bg-[#fbfdff] px-3 text-sm text-[#172033] outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#ddd6fe]"
              value={audience}
              onChange={(event) => setAudience(event.currentTarget.value)}
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-medium text-[#344054]">
            Max Steps
            <input
              className="min-h-10 rounded-md border border-[#cbd5e1] bg-[#fbfdff] px-3 text-sm text-[#172033] outline-none transition focus:border-[#7c3aed] focus:ring-2 focus:ring-[#ddd6fe]"
              type="number"
              min={1}
              max={6}
              value={maxSteps}
              onChange={(event) =>
                setMaxSteps(
                  Math.min(6, Math.max(1, Number(event.currentTarget.value))),
                )
              }
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1.5 text-xs font-medium text-[#15803d] transition hover:bg-[#dcfce7]"
            type="button"
            onClick={() => {
              setPageGoal(defaultPageGoal);
              setAudience("8 岁儿童");
              setMaxSteps(3);
            }}
          >
            成功路径
          </button>
          <button
            className="rounded-full border border-[#fecaca] bg-[#fef2f2] px-3 py-1.5 text-xs font-medium text-[#b42318] transition hover:bg-[#fee2e2]"
            type="button"
            onClick={() => {
              setPageGoal(defaultPageGoal);
              setAudience("8 岁儿童");
              setMaxSteps(1);
            }}
          >
            步骤超限路径
          </button>
        </div>

        <button
          className="min-h-11 rounded-md bg-[#7c3aed] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#6d28d9] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
          type="submit"
          disabled={isRunning || !pageGoal.trim()}
        >
          {isRunning ? "Agent 运行中..." : "运行 SinglePageAgent"}
        </button>
      </form>

      {error ? (
        <p
          className="rounded-md border border-[#fecaca] bg-[#fef2f2] p-3 text-sm text-[#b42318]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="flex flex-col gap-5" aria-label="Agent 运行结果">
          <AgentSummary result={result} />
          <AgentTimeline events={result.state.events} />
          {result.state.pagePlan ? (
            <PagePlanCard pagePlan={result.state.pagePlan} />
          ) : null}
          <details className="rounded-lg border border-[#d8dee8] bg-[#f8fafc] p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#344054]">
              查看完整 AgentState JSON
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-[#eef2f7] p-3 font-mono text-xs leading-5 text-[#172033]">
              {JSON.stringify(result.state, null, 2)}
            </pre>
          </details>
        </section>
      ) : (
        <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-5 text-center text-sm text-[#64748b]">
          运行成功路径或步骤超限路径，Timeline 会显示在这里。
        </div>
      )}
    </article>
  );
}

function AgentSummary({ result }: { result: SinglePageAgentResponse }) {
  const { state } = result;
  const completed = state.status === "completed";

  return (
    <div
      className={`rounded-lg border p-4 ${
        completed
          ? "border-[#bbf7d0] bg-[#f0fdf4]"
          : "border-[#fecaca] bg-[#fef2f2]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
            completed
              ? "bg-[#dcfce7] text-[#15803d]"
              : "bg-[#fee2e2] text-[#b42318]"
          }`}
        >
          {state.status}
        </span>
        <span className="text-sm text-[#475569]">
          Steps {state.step}/{state.maxSteps}
        </span>
      </div>
      {state.selectedTemplate ? (
        <div className="mt-3">
          <p className="font-semibold text-[#172033]">
            {state.selectedTemplate.templateName}
          </p>
          <p className="mt-1 text-sm text-[#64748b]">
            {state.selectedTemplate.toolName} · {state.selectedTemplate.templateId}
          </p>
          <p className="mt-1 text-sm text-[#475569]">
            {state.selectedTemplate.reason}
          </p>
        </div>
      ) : null}
      {state.error ? (
        <p className="mt-3 text-sm font-medium text-[#b42318]">
          {state.error.code}：{state.error.message}
        </p>
      ) : null}
      <code className="mt-3 block break-all text-xs text-[#64748b]">
        traceId: {result.traceId}
      </code>
    </div>
  );
}

function AgentTimeline({ events }: { events: AgentEvent[] }) {
  return (
    <div>
      <h4 className="mb-3 font-semibold text-[#101827]">Agent Timeline</h4>
      <ol className="flex flex-col gap-3">
        {events.map((event) => (
          <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3" key={event.id}>
            <span className="flex size-8 items-center justify-center rounded-full bg-[#172033] text-xs font-semibold text-white">
              {event.sequence}
            </span>
            <div className={`rounded-lg border p-3 ${eventStyles[event.type]}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {event.type}
                </span>
                <span className="text-xs opacity-75">Step {event.step}</span>
              </div>
              <p className="mt-1 text-sm font-medium">{event.summary}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PagePlanCard({ pagePlan }: { pagePlan: PagePlanDraft }) {
  return (
    <div className="rounded-lg border border-[#ddd6fe] bg-[#faf8ff] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#7c3aed]">
        PagePlan
      </p>
      <h4 className="mt-1 text-lg font-semibold text-[#101827]">
        {pagePlan.title}
      </h4>
      <p className="mt-2 text-sm leading-6 text-[#475569]">
        <strong>学习目标：</strong>
        {pagePlan.learningObjective}
      </p>
      <ol className="mt-4 flex flex-col gap-2">
        {pagePlan.sections.map((section, index) => (
          <li
            className="rounded-md border border-[#e2e8f0] bg-white p-3"
            key={`${section.title}-${index}`}
          >
            <p className="text-sm font-semibold text-[#172033]">
              {index + 1}. {section.title}
            </p>
            <p className="mt-1 text-sm text-[#64748b]">{section.purpose}</p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-sm leading-6 text-[#475569]">
        <strong>视觉方向：</strong>
        {pagePlan.visualDirection}
      </p>
    </div>
  );
}
