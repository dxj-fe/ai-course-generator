"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import {
  planCourse,
  type CoursePlannerResponse,
} from "../lib/course-planner-api";
import { CourseDesignRunner } from "./course-design-runner";
import { CourseOutlinePanel } from "./course-outline-panel";
import { PagePlanList } from "./page-plan-list";

const topicCases = [
  {
    label: "太阳系",
    prompt: "为 8 岁儿童设计一门 5 页太阳系入门课，包含互动问答，使用科幻风格。",
  },
  {
    label: "火星探险",
    prompt: "为 9-11 岁儿童设计一门 5 页火星探险课，以任务故事导入并包含成果挑战。",
  },
  {
    label: "垃圾分类",
    prompt: "为小学生设计一门 5 页垃圾分类课程，包含分类对比和互动测验。",
  },
  {
    label: "AI 素养",
    prompt: "为初中生设计一门 5 页 AI 素养课程，包含负责任使用和信息判断。",
  },
  {
    label: "古诗入门",
    prompt: "为 8 岁儿童设计一门 5 页古诗入门课，包含意境观察和复习总结。",
  },
] as const;

/** 提供一句话课程规划、状态反馈和结构化结果验收界面。 */
export function CoursePlannerPanel() {
  const [userPrompt, setUserPrompt] = useState<string>(topicCases[0].prompt);
  const [result, setResult] = useState<CoursePlannerResponse>();
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  /** 依次运行 Intent Agent 和 CoursePlannerAgent。 */
  async function runPlanner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = userPrompt.trim();

    if (!prompt) {
      setError("请输入课程需求。");
      return;
    }

    setIsRunning(true);
    setError("");
    setResult(undefined);

    try {
      setResult(await planCourse({ userPrompt: prompt }));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Course Planner 请求失败。",
      );
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section
      className="flex flex-col gap-5 border-t border-[#d8dee8] pt-8"
      aria-labelledby="course-planner-title"
    >
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#15803d]">
          Day 10 · Course Planner Agent
        </p>
        <h2
          className="mt-1 text-2xl font-semibold text-[#101827]"
          id="course-planner-title"
        >
          一句话生成课程结构
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#64748b]">
          Intent Agent 先把自然语言解析为 CourseIntent，Planner 再生成 3–12
          页、带依赖关系的 CourseOutline；该阶段不会生成 HTML。
        </p>
      </header>

      <form
        className="rounded-xl border border-[#d8dee8] bg-white p-5 shadow-sm"
        onSubmit={runPlanner}
      >
        <label
          className="text-sm font-semibold text-[#344054]"
          htmlFor="course-planner-prompt"
        >
          课程需求
        </label>
        <Textarea
          className="mt-2 min-h-24 w-full resize-y rounded-lg border border-[#cbd5e1] bg-[#fbfdff] p-3 text-sm leading-6 text-[#172033] outline-none transition focus:border-[#16a34a] focus:ring-2 focus:ring-[#bbf7d0]"
          id="course-planner-prompt"
          value={userPrompt}
          onChange={(event) => setUserPrompt(event.currentTarget.value)}
        />
        <div className="mt-3 flex flex-wrap gap-2" aria-label="课程测试主题">
          {topicCases.map((item) => (
            <Button
              className="rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1.5 text-xs font-medium text-[#475569] transition hover:border-[#16a34a] hover:text-[#15803d]"
              key={item.label}
              type="button"
              onClick={() => setUserPrompt(item.prompt)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <Button
          className="mt-4 min-h-11 rounded-lg bg-[#15803d] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#166534] disabled:cursor-not-allowed disabled:bg-[#94a3b8]"
          type="submit"
          disabled={isRunning || !userPrompt.trim()}
        >
          {isRunning ? "正在规划课程..." : "生成 Course Outline"}
        </Button>
      </form>

      {error ? (
        <p
          className="rounded-lg border border-[#fecaca] bg-[#fef2f2] p-4 text-sm text-[#b42318]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="grid gap-5">
          <PlannerRunSummary result={result} />
          {result.state.outline ? (
            <>
              <CourseOutlinePanel outline={result.state.outline} />
              <PagePlanList pages={result.state.outline.pages} />
              <CourseDesignRunner
                intent={result.intent}
                key={result.traceId}
                outline={result.state.outline}
              />
            </>
          ) : null}
          <details className="rounded-lg border border-[#d8dee8] bg-[#f8fafc] p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#344054]">
              查看完整 Planner 结果
            </summary>
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-[#eef2f7] p-3 font-mono text-xs leading-5 text-[#172033]">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}

/** 展示 Intent、Agent 状态和公开事件摘要，不暴露私有推理。 */
function PlannerRunSummary({ result }: { result: CoursePlannerResponse }) {
  return (
    <section className="grid gap-4 rounded-xl border border-[#d8dee8] bg-white p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-[#101827]">CourseIntent</h3>
          <span className="rounded-full bg-[#ede9fe] px-3 py-1 text-xs font-semibold text-[#6d28d9]">
            {result.state.status}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[#64748b]">主题</dt>
            <dd className="mt-1 font-semibold text-[#344054]">
              {result.intent.topic}
            </dd>
          </div>
          <div>
            <dt className="text-[#64748b]">页数</dt>
            <dd className="mt-1 font-semibold text-[#344054]">
              {result.intent.courseLength}
            </dd>
          </div>
          <div>
            <dt className="text-[#64748b]">受众</dt>
            <dd className="mt-1 font-semibold text-[#344054]">
              {result.intent.audienceAgeRange.label}
            </dd>
          </div>
          <div>
            <dt className="text-[#64748b]">风格</dt>
            <dd className="mt-1 font-semibold text-[#344054]">
              {result.intent.visualStyle}
            </dd>
          </div>
        </dl>
        {result.state.error ? (
          <p className="mt-4 rounded-md bg-[#fef2f2] p-3 text-sm text-[#b42318]">
            {result.state.error.message}
          </p>
        ) : null}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-[#101827]">Agent Timeline</h3>
        <ol className="mt-3 grid gap-2">
          {result.state.events.map((event) => (
            <li
              className="flex items-start gap-3 rounded-lg bg-[#f8fafc] px-3 py-2 text-sm"
              key={event.id}
            >
              <span className="font-mono text-xs font-bold text-[#7c3aed]">
                {String(event.sequence).padStart(2, "0")}
              </span>
              <span className="font-semibold text-[#344054]">{event.type}</span>
              <span className="text-[#64748b]">{event.summary}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
