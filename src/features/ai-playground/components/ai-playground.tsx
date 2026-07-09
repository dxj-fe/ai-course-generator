"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { FormEvent, useMemo, useState } from "react";

import {
  createUserMessage,
  getErrorText,
  getMessageText,
} from "../lib/messages";

const defaultPrompt = "用三句话介绍什么是 AI Agent。";

export function AiPlayground() {
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [generateResult, setGenerateResult] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const {
    messages,
    sendMessage,
    status,
    error: streamError,
    clearError,
  } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai/stream" }),
  });

  const trimmedPrompt = prompt.trim();
  const streamBusy = status === "submitted" || status === "streaming";

  const latestAssistantText = useMemo(() => {
    const assistantMessages = messages.filter(
      (message) => message.role === "assistant",
    );
    const latest = assistantMessages.at(-1);

    return latest ? getMessageText(latest) : "";
  }, [messages]);

  async function runGenerate() {
    if (!trimmedPrompt) {
      setGenerateError("请输入 prompt。");
      return;
    }

    setIsGenerating(true);
    setGenerateError("");
    setGenerateResult("");

    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [createUserMessage(trimmedPrompt)] }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        const payload = contentType.includes("application/json")
          ? await response.json()
          : { error: await response.text() };

        throw new Error(getErrorText(payload));
      }

      setGenerateResult(await response.text());
    } catch (error) {
      setGenerateError(
        error instanceof Error ? error.message : "普通生成接口请求失败。",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function runStream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!trimmedPrompt || streamBusy) {
      return;
    }

    clearError();
    sendMessage({ text: trimmedPrompt });
  }

  return (
    <main className="min-h-screen bg-[#f8fafc] text-[#172033]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-5 py-8 sm:px-8">
        <header className="flex flex-col gap-2 border-b border-[#d8dee8] pb-5">
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#436b8f]">
            Day 01
          </p>
          <h1 className="text-3xl font-semibold text-[#101827]">
            AI Course Generator
          </h1>
        </header>

        <section className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <form
            className="flex min-h-[420px] flex-col gap-4 rounded-lg border border-[#d8dee8] bg-white p-5 shadow-sm"
            onSubmit={runStream}
          >
            <label
              className="text-sm font-medium text-[#344054]"
              htmlFor="prompt"
            >
              Prompt
            </label>
            <textarea
              id="prompt"
              className="min-h-44 flex-1 resize-none rounded-md border border-[#cbd5e1] bg-[#fbfdff] p-3 text-base leading-7 text-[#172033] outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
            />

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                className="min-h-11 rounded-md bg-[#1d4ed8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1e40af] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
                type="button"
                disabled={isGenerating || !trimmedPrompt}
                onClick={runGenerate}
              >
                {isGenerating ? "生成中..." : "普通生成"}
              </button>
              <button
                className="min-h-11 rounded-md bg-[#0f766e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
                type="submit"
                disabled={streamBusy || !trimmedPrompt}
              >
                {streamBusy ? "输出中..." : "流式输出"}
              </button>
            </div>
          </form>

          <section className="grid gap-5">
            <div className="rounded-lg border border-[#d8dee8] bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[#101827]">
                  普通生成结果
                </h2>
                <span className="rounded-full bg-[#e0ecff] px-3 py-1 text-xs font-medium text-[#1d4ed8]">
                  /api/ai/generate
                </span>
              </div>
              <pre className="min-h-36 whitespace-pre-wrap rounded-md bg-[#f1f5f9] p-3 text-sm leading-6 text-[#172033]">
                {generateError || generateResult || "等待请求"}
              </pre>
            </div>

            <div className="rounded-lg border border-[#d8dee8] bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[#101827]">
                  流式输出结果
                </h2>
                <span className="rounded-full bg-[#dff7ef] px-3 py-1 text-xs font-medium text-[#0f766e]">
                  /api/ai/stream
                </span>
              </div>
              <pre className="min-h-36 whitespace-pre-wrap rounded-md bg-[#f1f5f9] p-3 text-sm leading-6 text-[#172033]">
                {streamError?.message || latestAssistantText || "等待请求"}
              </pre>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
