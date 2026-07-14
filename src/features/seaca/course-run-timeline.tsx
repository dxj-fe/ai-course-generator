import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type {
  CourseRunStageStatus,
  SeacaCourseRun,
} from "@/types/seaca";

type TimelineStep = {
  id: string;
  label: string;
  status: CourseRunStageStatus;
  summaries: string[];
  error?: string;
};

const statusCopy: Record<CourseRunStageStatus, string> = {
  idle: "等待中",
  running: "进行中",
  completed: "已完成",
  failed: "未完成",
};

const statusClasses: Record<CourseRunStageStatus, string> = {
  idle: "border-[#ddd4c8] bg-[#f7f1e9] text-[#8d8172]",
  running: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  completed: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  failed: "border-[#e4b6aa] bg-[#fff0eb] text-[#a44f3d]",
};

/** 只展示可公开的 Agent 事件摘要，不渲染 Prompt、事件 data 或私有推理。 */
export function CourseRunTimeline({ run }: { run?: SeacaCourseRun }) {
  const steps = run ? buildTimelineSteps(run) : [];
  const liveStatus =
    steps.find(({ status }) => status === "running")?.label ??
    steps.find(({ status }) => status === "failed")?.label ??
    (steps.length > 0 ? "课程生成进度已更新" : "等待课程任务");

  return (
    <section
      aria-labelledby="course-run-timeline-title"
      className="rounded-[20px] border border-[#ebe1d6] bg-[#fffdf8] p-4 shadow-[0_8px_28px_-24px_rgba(56,44,25,0.35)] sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-[0.08em] text-[#77a863]">
            AGENT 进度
          </p>
          <h3
            className="mt-1 text-base font-semibold text-[#382c19]"
            id="course-run-timeline-title"
          >
            课程生成时间线
          </h3>
        </div>
        {run ? (
          <Badge
            className="h-auto max-w-full truncate rounded-full border-0 bg-[#f7f1e9] px-3 py-1 text-xs font-normal text-[#8d8172]"
            variant="secondary"
          >
            {run.traceId}
          </Badge>
        ) : null}
      </div>

      <p aria-live="polite" className="sr-only">
        {liveStatus}
      </p>

      {steps.length > 0 ? (
        <ol className="mt-4 grid gap-0">
          {steps.map((step, index) => (
            <li
              className="relative grid grid-cols-[20px_minmax(0,1fr)] gap-3 pb-5 last:pb-0"
              key={step.id}
            >
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-[9px] top-5 w-px bg-[#e6ddd1]"
                />
              ) : null}
              <span
                aria-hidden="true"
                className={`relative mt-1 block size-5 rounded-full border-4 border-[#fffdf8] ring-1 ${dotClasses[step.status]}`}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-[#4c3e2b]">
                    {step.label}
                  </h4>
                  <Badge
                    className={`h-auto overflow-visible rounded-full border px-2 py-0.5 text-[11px] leading-normal font-semibold ${statusClasses[step.status]}`}
                    variant="outline"
                  >
                    {statusCopy[step.status]}
                  </Badge>
                </div>

                {step.error ? (
                  <Alert
                    className="mt-2 rounded-xl border-0 bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-[#984735]"
                    variant="destructive"
                  >
                    {step.error}
                  </Alert>
                ) : step.summaries.length > 0 ? (
                  <ul className="mt-2 grid gap-1.5">
                    {step.summaries.map((summary, summaryIndex) => (
                      <li
                        className="flex gap-2 text-xs leading-5 text-[#786d5f]"
                        key={`${step.id}-${summaryIndex}`}
                      >
                        <span aria-hidden="true" className="text-[#77cc57]">
                          ·
                        </span>
                        <span className="min-w-0 [overflow-wrap:anywhere]">
                          {summary}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-xs leading-5 text-[#a1978a]">
                    {emptyStatusCopy[step.status]}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 rounded-2xl bg-[#f8f3ec] px-4 py-5 text-center text-sm text-[#988e80]">
          发送课程需求后，这里会显示可公开的执行进度。
        </p>
      )}
    </section>
  );
}

const dotClasses: Record<CourseRunStageStatus, string> = {
  idle: "bg-[#cfc5b8] ring-[#cfc5b8]",
  running:
    "bg-[#77cc57] ring-[#77cc57] motion-safe:animate-[seaca-soft-pulse_1.4s_ease-in-out_infinite]",
  completed: "bg-[#77cc57] ring-[#77cc57]",
  failed: "bg-[#cf745f] ring-[#cf745f]",
};

const emptyStatusCopy: Record<CourseRunStageStatus, string> = {
  idle: "等待上一阶段完成",
  running: "Agent 正在处理，请稍候…",
  completed: "这一阶段已经完成",
  failed: "这一阶段未能完成",
};

function buildTimelineSteps(run: SeacaCourseRun): TimelineStep[] {
  const outlinePages = run.planner.data?.state.outline?.pages ?? [];
  const pageIds = [
    ...outlinePages.map(({ id }) => id),
    ...Object.keys(run.pageWrites),
    ...Object.keys(run.pageAssets),
    ...Object.keys(run.pageHtml),
    ...Object.keys(run.pageQa),
  ].filter((pageId, index, values) => values.indexOf(pageId) === index);

  return [
    {
      id: "planner",
      label: "理解需求与规划课程",
      status: run.planner.status,
      summaries: run.planner.events.map(({ summary }) => summary),
      error:
        run.planner.error ?? run.planner.data?.state.error?.message,
    },
    {
      id: "design",
      label: "教学、故事与视觉设计",
      status: run.design.status,
      summaries: run.design.events.map(({ summary }) => summary),
      error: run.design.error ?? run.design.data?.state.error?.message,
    },
    ...pageIds.flatMap((pageId) => {
      const page = outlinePages.find(({ id }) => id === pageId);
      const write = run.pageWrites[pageId];
      const assets = run.pageAssets[pageId];
      const html = run.pageHtml[pageId];
      const qa = run.pageQa[pageId];
      const pageLabel = page
        ? `第 ${page.order} 页 · ${page.title}`
        : `页面 ${pageId}`;

      return [
        {
          id: `page-writer-${pageId}`,
          label: `Page Writer · ${pageLabel}`,
          status: write?.status ?? "idle",
          summaries: write?.events.map(({ summary }) => summary) ?? [],
          error: write?.error ?? write?.data?.state.error?.message,
        },
        {
          id: `image-assets-${pageId}`,
          label: `Image Assets · ${pageLabel}`,
          status: assets?.status ?? "idle",
          summaries: assets?.events.map(({ summary }) => summary) ?? [],
          error: assets?.error ?? assets?.data?.state.error?.message,
        },
        {
          id: `html-engineer-${pageId}`,
          label: `HTML Engineer · ${pageLabel}`,
          status: html?.status ?? "idle",
          summaries: html?.events.map(({ summary }) => summary) ?? [],
          error: html?.error ?? html?.data?.state.error?.message,
        },
        {
          id: `page-qa-${pageId}`,
          label: `Page QA · ${pageLabel}`,
          status: qa?.status ?? "idle",
          summaries: qa?.events.map(({ summary }) => summary) ?? [],
          error: qa?.error ?? qa?.data?.state.error?.message,
        },
      ] satisfies TimelineStep[];
    }),
  ];
}
