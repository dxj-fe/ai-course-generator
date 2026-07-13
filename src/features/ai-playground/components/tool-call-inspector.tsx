"use client";

import { FormEvent, useState } from "react";

import { getErrorText } from "../lib/messages";

const functionalExample = "为 8 岁儿童设计一个互动问答页面";
const styleExample = "为企业管理者设计一个极简专业课程封面";

type ToolCallResponse = {
  traceId: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    output: unknown;
  }>;
};

export function ToolCallInspector() {
  const [pagePurpose, setPagePurpose] = useState(functionalExample);
  const [result, setResult] = useState<ToolCallResponse>();
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  async function runToolCall(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedPurpose = pagePurpose.trim();

    if (!trimmedPurpose) {
      setError("请输入页面目的。");
      return;
    }

    setIsRunning(true);
    setError("");
    setResult(undefined);

    try {
      const response = await fetch("/api/demo/tool-call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePurpose: trimmedPurpose }),
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
          : "Tool Calling 请求失败。",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <article className="flex flex-col gap-5 rounded-xl border border-[#d8dee8] bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#2563eb]">
            Day 05 验收
          </p>
          <h3 className="mt-1 text-xl font-semibold text-[#101827]">
            Tool Call Inspector
          </h3>
          <p className="mt-1 text-sm leading-6 text-[#64748b]">
            检查模型选择的工具、结构化入参和 Skill Result。
          </p>
        </div>
        <span className="rounded-full bg-[#e0ecff] px-3 py-1 text-xs font-medium text-[#1d4ed8]">
          /api/demo/tool-call
        </span>
      </header>

      <form className="flex flex-col gap-3" onSubmit={runToolCall}>
        <label
          className="text-sm font-medium text-[#344054]"
          htmlFor="tool-page-purpose"
        >
          页面目的
        </label>
        <textarea
          id="tool-page-purpose"
          className="min-h-24 resize-y rounded-md border border-[#cbd5e1] bg-[#fbfdff] p-3 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
          value={pagePurpose}
          onChange={(event) => setPagePurpose(event.currentTarget.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-[#bfdbfe] bg-[#eff6ff] px-3 py-1.5 text-xs font-medium text-[#1d4ed8] transition hover:bg-[#dbeafe]"
            type="button"
            onClick={() => setPagePurpose(functionalExample)}
          >
            功能模板案例
          </button>
          <button
            className="rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-3 py-1.5 text-xs font-medium text-[#6d28d9] transition hover:bg-[#ede9fe]"
            type="button"
            onClick={() => setPagePurpose(styleExample)}
          >
            样式模板案例
          </button>
        </div>
        <button
          className="min-h-11 rounded-md bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
          type="submit"
          disabled={isRunning || !pagePurpose.trim()}
        >
          {isRunning ? "模型选择工具中..." : "运行 Tool Calling"}
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
        <section className="flex flex-col gap-4" aria-label="Tool Calling 结果">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[#f0fdf4] px-3 py-2">
            <span className="text-sm font-semibold text-[#15803d]">
              工具执行成功
            </span>
            <code className="break-all text-xs text-[#475569]">
              traceId: {result.traceId}
            </code>
          </div>

          {result.toolCalls.map((call) => (
            <div
              className="rounded-lg border border-[#dbeafe] bg-[#f8fbff] p-4"
              key={call.toolCallId}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold text-[#1e3a8a]">
                  {call.toolName}
                </h4>
                <span className="rounded-full bg-[#dbeafe] px-2.5 py-1 text-xs font-medium text-[#1d4ed8]">
                  Tool Call
                </span>
              </div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                Input
              </p>
              <CompactJson value={call.input} />
            </div>
          ))}

          {result.toolResults.map((toolResult) => (
            <div
              className="rounded-lg border border-[#bbf7d0] bg-[#f7fef9] p-4"
              key={toolResult.toolCallId}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-semibold text-[#166534]">
                  {toolResult.toolName}
                </h4>
                <span className="rounded-full bg-[#dcfce7] px-2.5 py-1 text-xs font-medium text-[#15803d]">
                  Tool Result
                </span>
              </div>
              <CompactJson value={toolResult.output} />
            </div>
          ))}
        </section>
      ) : (
        <EmptyState text="选择一个案例并运行，结果会显示在这里。" />
      )}
    </article>
  );
}

function CompactJson({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-[#eef2f7] p-3 font-mono text-xs leading-5 text-[#172033]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-5 text-center text-sm text-[#64748b]">
      {text}
    </div>
  );
}
