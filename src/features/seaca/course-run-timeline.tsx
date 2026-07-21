"use client";

import { type ReactNode, useEffect, useState } from "react";
import {
  Clock3 as ClockIcon,
  RefreshCcw as ResumeIcon,
  Wifi as ConnectedIcon,
  WifiOff as DisconnectedIcon,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildCourseRunTimelineModel,
  type CourseRunTimelineConnectionStatus,
  type CourseRunTimelinePage,
  type CourseRunTimelineStage,
} from "@/features/seaca/course-run-timeline-model";
import { GenerationLogDrawer } from "@/features/seaca/generation-log-drawer";
import type { CourseTaskStatus } from "@/shared/course-schema";
import type { CourseRunStageStatus, SeacaCourseRun } from "@/types/seaca";

type CourseRunTimelineProps = {
  busy?: boolean;
  connectionStatus?: CourseRunTimelineConnectionStatus;
  nowMs?: number;
  onResumeCourse?(): void;
  run?: SeacaCourseRun;
  taskStatus?: CourseTaskStatus;
};

const stageStatusCopy: Record<CourseRunStageStatus, string> = {
  idle: "等待中",
  running: "进行中",
  completed: "已完成",
  failed: "未完成",
};

const taskStatusCopy: Record<CourseTaskStatus, string> = {
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
};

const connectionStatusCopy: Record<
  CourseRunTimelineConnectionStatus,
  string
> = {
  idle: "未连接",
  connecting: "连接中",
  open: "实时连接",
  reconnecting: "正在重连",
  closed: "连接已关闭",
};

const agentCopy: Record<string, string> = {
  intent: "Intent Agent",
  planner: "Course Planner",
  "course-design": "专业设计 Agent",
  "page-writer": "Page Writer",
  "image-assets": "Image Assets",
  "html-engineer": "HTML Engineer",
  "page-qa": "Page QA",
  "repair-agent": "Repair Agent",
  supervisor: "Supervisor",
  Workflow: "Workflow",
};

/**
 * 把任务、Agent 与页面三个层级放回现有 /chat thread。
 * 原生流数据在 Hook 边界已经消失；这里仅消费类型化状态和公开摘要。
 */
export function CourseRunTimeline({
  busy = false,
  connectionStatus,
  nowMs,
  onResumeCourse,
  run,
  taskStatus,
}: CourseRunTimelineProps) {
  const isLive = Boolean(
    run &&
      (taskStatus === "queued" ||
        taskStatus === "running" ||
        run.generation?.status === "running" ||
        run.planner.status === "running" ||
        run.design.status === "running" ||
        Object.values(run.pageWrites).some(
          ({ status }) => status === "running",
        ) ||
        Object.values(run.pageAssets).some(
          ({ status }) => status === "running",
        ) ||
        Object.values(run.pageHtml).some(
          ({ status }) => status === "running",
        )),
  );
  const [clockMs, setClockMs] = useState(() => nowMs ?? Date.now());

  useEffect(() => {
    if (nowMs !== undefined || !isLive) return;

    const updateClock = () => setClockMs(Date.now());
    updateClock();
    const timer = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(timer);
  }, [isLive, nowMs]);

  if (!run) {
    return (
      <section
        aria-labelledby="course-run-timeline-title"
        className="rounded-[20px] border border-[#ebe1d6] bg-[#fffdf8] p-4 shadow-[0_8px_28px_-24px_rgba(56,44,25,0.35)] sm:p-5"
      >
        <TimelineHeading />
        <p className="mt-4 rounded-2xl bg-[#f8f3ec] px-4 py-5 text-center text-sm text-[#988e80]">
          发送课程需求后，这里会按任务、Agent 与页面显示公开执行进度。
        </p>
      </section>
    );
  }

  const model = buildCourseRunTimelineModel(run, {
    connectionStatus,
    nowMs: nowMs ?? clockMs,
    taskStatus,
  });
  const currentPage = model.pages.find(
    ({ pageId }) => pageId === model.task.currentPageId,
  );
  const liveStatus =
    model.task.status === "running"
      ? `课程正在生成，当前 ${displayAgent(model.task.currentAgent)}${
          currentPage ? `，第 ${currentPage.order} 页` : ""
        }`
      : `课程任务${taskStatusCopy[model.task.status]}`;
  const canResume =
    Boolean(onResumeCourse) &&
    (model.task.status === "failed" || model.task.status === "cancelled");

  return (
    <section
      aria-labelledby="course-run-timeline-title"
      className="rounded-[20px] border border-[#ebe1d6] bg-[#fffdf8] p-4 shadow-[0_8px_28px_-24px_rgba(56,44,25,0.35)] sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TimelineHeading />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {model.task.resumed ? (
            <Badge
              className="h-auto rounded-full border-[#d7c9b9] bg-[#fffaf2] px-2.5 py-1 text-[11px] font-semibold text-[#7c674e]"
              variant="outline"
            >
              已从断点恢复
            </Badge>
          ) : null}
          <Badge
            className="h-auto rounded-full border-[#d7c9b9] bg-[#fffaf2] px-2.5 py-1 text-[11px] font-semibold text-[#7c674e]"
            variant="outline"
          >
            来源 · {model.task.source === "langgraph" ? "LangGraph" : "Workflow"}
          </Badge>
          {connectionStatus ? (
            <ConnectionBadge status={model.task.connectionStatus} />
          ) : null}
          <TaskStatusBadge status={model.task.status} />
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {liveStatus}
      </p>

      <div className="mt-4 rounded-2xl bg-[#f8f3ec] p-3.5 sm:p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <SummaryField
            label="页面进度"
            value={
              model.task.totalPages > 0
                ? `${model.task.completedPages} / ${model.task.totalPages}`
                : "等待规划"
            }
          />
          <SummaryField
            label="当前 Agent"
            value={displayAgent(model.task.currentAgent)}
          />
          <SummaryField
            label="当前页面"
            value={
              currentPage
                ? `第 ${currentPage.order} 页`
                : model.task.currentPageId ?? "整课阶段"
            }
          />
          <SummaryField
            icon={<ClockIcon aria-hidden="true" size={13} strokeWidth={1.8} />}
            label="任务耗时"
            value={formatDuration(model.task.durationMs)}
          />
        </dl>

        {model.task.totalPages > 0 ? (
          <div className="mt-3">
            <div
              aria-label={`课程页面已完成 ${model.task.completedPages} / ${model.task.totalPages}`}
              aria-valuemax={model.task.totalPages}
              aria-valuemin={0}
              aria-valuenow={model.task.completedPages}
              className="h-1.5 overflow-hidden rounded-full bg-[#e7ded2]"
              role="progressbar"
            >
              <span
                className="block h-full rounded-full bg-[#77cc57] transition-[width] duration-300"
                style={{
                  width: `${Math.round(
                    (model.task.completedPages / model.task.totalPages) * 100,
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#e8ded2] pt-3">
          <p className="min-w-0 text-[11px] leading-5 text-[#988e80] [overflow-wrap:anywhere]">
            trace · {model.task.traceId}
          </p>
          {canResume ? (
            <Button
              className="h-8 rounded-full border border-[#dcaa9e] bg-[#fff8f5] px-3 text-xs font-semibold text-[#984735] hover:bg-white"
              disabled={busy}
              onClick={onResumeCourse}
              size="sm"
              type="button"
              variant="outline"
            >
              <ResumeIcon aria-hidden="true" size={13} strokeWidth={1.8} />
              {busy ? "正在恢复…" : "从断点继续"}
            </Button>
          ) : null}
        </div>
      </div>

      {model.supervisorDecisions.length > 0 ? (
        <section
          aria-labelledby="supervisor-decisions-title"
          className="mt-5 rounded-2xl border border-[#dfead9] bg-[#f5fbf1] p-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4
              className="text-sm font-semibold text-[#4c3e2b]"
              id="supervisor-decisions-title"
            >
              Supervisor 调度
            </h4>
            <span className="text-[11px] text-[#7d9273]">
              仅展示公开决策摘要
            </span>
          </div>
          <ol className="mt-3 grid gap-2">
            {model.supervisorDecisions.slice(-3).map((decision) => (
              <li
                className="rounded-xl bg-white px-3 py-2.5"
                key={decision.id}
              >
                <p className="text-xs leading-5 font-medium text-[#55634f]">
                  {decision.summary}
                </p>
                <p className="mt-1 text-[11px] text-[#8a9784]">
                  {decision.pageId
                    ? `${decision.stage} · ${decision.pageId}`
                    : `${decision.stage} · 整课阶段`}
                </p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="global-agent-progress-title" className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4
            className="text-sm font-semibold text-[#4c3e2b]"
            id="global-agent-progress-title"
          >
            全局 Agent
          </h4>
          <span className="text-[11px] text-[#a1978a]">
            需求理解 · 课程规划 · 专业设计
          </span>
        </div>
        <ol className="mt-3 grid gap-2">
          {model.globalStages.map((stage) => (
            <StageRow key={stage.id} stage={stage} />
          ))}
        </ol>
      </section>

      <section aria-labelledby="page-agent-progress-title" className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4
            className="text-sm font-semibold text-[#4c3e2b]"
            id="page-agent-progress-title"
          >
            页面执行
          </h4>
          <span className="text-[11px] text-[#a1978a]">
            {run.generation?.workerConfig
              ? "按页面定位 DSL、素材、HTML、QA 与定向 Repair"
              : "按页面定位 DSL、素材、HTML 与可选 QA"}
          </span>
        </div>
        {model.pages.length > 0 ? (
          <ol className="mt-3 grid gap-3">
            {model.pages.map((page) => (
              <PageGroup key={page.pageId} page={page} />
            ))}
          </ol>
        ) : (
          <p className="mt-3 rounded-2xl bg-[#f8f3ec] px-4 py-4 text-center text-sm text-[#988e80]">
            课程结构生成后，这里会按页面展开 Agent 进度。
          </p>
        )}
      </section>

      <div className="mt-5">
        <GenerationLogDrawer run={run} />
      </div>
    </section>
  );
}

function TimelineHeading() {
  return (
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
  );
}

function PageGroup({ page }: { page: CourseRunTimelinePage }) {
  const stages = [
    page.stages.writer,
    page.stages.assets,
    page.stages.html,
    ...(page.stages.qa ? [page.stages.qa] : []),
    ...(page.stages.repair ? [page.stages.repair] : []),
  ];

  return (
    <li className="rounded-2xl border border-[#eee5da] bg-[#fdfaf5] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eff8e9] text-xs font-semibold text-[#5f9848]"
          >
            {String(page.order).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <h5 className="text-sm leading-5 font-semibold text-[#4c3e2b]">
              {page.title ?? `页面 ${page.pageId}`}
            </h5>
            <p className="mt-0.5 text-[11px] text-[#a1978a]">
              {page.pageId} · {pageProgressCopy[page.status]}
            </p>
          </div>
        </div>
        <StageStatusBadge status={page.status} />
      </div>

      <ol className="mt-3 grid gap-2 border-l border-[#e6ddd1] pl-3">
        {stages.map((stage) => (
          <StageRow compact key={stage.id} stage={stage} />
        ))}
      </ol>
    </li>
  );
}

function StageRow({
  compact = false,
  stage,
}: {
  compact?: boolean;
  stage: CourseRunTimelineStage;
}) {
  return (
    <li className="min-w-0 rounded-xl bg-white px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className={`block size-2.5 shrink-0 rounded-full ${dotClasses[stage.status]}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs leading-5 font-semibold text-[#594a37]">
            {stage.label}
            {!compact ? (
              <span className="ml-1 font-normal text-[#988e80]">
                · {displayAgent(stage.agent)}
              </span>
            ) : null}
          </p>
        </div>
        {stage.optional ? (
          <Badge
            className="h-auto rounded-full border-[#e3dbd1] bg-[#faf7f2] px-2 py-0.5 text-[10px] font-semibold text-[#94897c]"
            variant="outline"
          >
            可选
          </Badge>
        ) : null}
        {stage.attemptCount > 1 ? (
          <Badge
            className="h-auto rounded-full border-[#d7c9b9] bg-[#fffaf2] px-2 py-0.5 text-[10px] font-semibold text-[#7c674e]"
            variant="outline"
          >
            第 {stage.attemptCount} 次执行
          </Badge>
        ) : null}
        {stage.durationMs !== undefined ? (
          <span className="text-[11px] tabular-nums text-[#8d8172]">
            {formatDuration(stage.durationMs)}
          </span>
        ) : null}
        <StageStatusBadge status={stage.status} />
      </div>

      {stage.summaries?.length ? (
        <ul className="mt-2 grid gap-1">
          {stage.summaries.slice(-3).map((summary, index) => (
            <li
              className="flex gap-2 text-[11px] leading-5 text-[#786d5f]"
              key={`${stage.id}-summary-${index}`}
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
      ) : stage.status === "idle" ? (
        <p className="mt-1 text-[11px] leading-5 text-[#a1978a]">
          等待上一阶段完成
        </p>
      ) : null}

      {stage.error ? (
        <Alert
          className="mt-2 rounded-xl border-0 bg-[#fff0eb] px-3 py-2 text-xs leading-5 text-[#984735]"
          variant="destructive"
        >
          <p className="font-semibold [overflow-wrap:anywhere]">
            {displayAgent(stage.error.agent)} · {stage.error.pageId ?? "整课"} ·{" "}
            {stage.error.code}
          </p>
          <p className="mt-0.5 [overflow-wrap:anywhere]">
            {stage.error.message}
          </p>
        </Alert>
      ) : null}
    </li>
  );
}

function SummaryField({
  icon,
  label,
  value,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] text-[#988e80]">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 min-w-0 text-xs font-semibold text-[#594a37] [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function StageStatusBadge({ status }: { status: CourseRunStageStatus }) {
  return (
    <Badge
      className={`h-auto rounded-full border px-2 py-0.5 text-[10px] leading-normal font-semibold ${stageStatusClasses[status]}`}
      data-status={status}
      variant="outline"
    >
      {stageStatusCopy[status]}
    </Badge>
  );
}

function TaskStatusBadge({ status }: { status: CourseTaskStatus }) {
  return (
    <Badge
      className={`h-auto rounded-full border px-2.5 py-1 text-[11px] font-semibold ${taskStatusClasses[status]}`}
      data-task-status={status}
      variant="outline"
    >
      {taskStatusCopy[status]}
    </Badge>
  );
}

function ConnectionBadge({
  status,
}: {
  status: CourseRunTimelineConnectionStatus;
}) {
  const Icon = status === "open" ? ConnectedIcon : DisconnectedIcon;

  return (
    <Badge
      className={`h-auto rounded-full border px-2.5 py-1 text-[11px] font-semibold ${connectionStatusClasses[status]}`}
      data-connection-status={status}
      variant="outline"
    >
      <Icon aria-hidden="true" size={11} strokeWidth={1.8} />
      {connectionStatusCopy[status]}
    </Badge>
  );
}

function displayAgent(agent?: string) {
  if (!agent) return "等待调度";
  return agentCopy[agent] ?? agent;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return "< 1 秒";
  const seconds = Math.floor(durationMs / 1_000);
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes} 分 ${restSeconds} 秒`;
  const hours = Math.floor(minutes / 60);
  return `${hours} 时 ${minutes % 60} 分`;
}

const dotClasses: Record<CourseRunStageStatus, string> = {
  idle: "bg-[#cfc5b8]",
  running:
    "bg-[#77cc57] motion-safe:animate-[seaca-soft-pulse_1.4s_ease-in-out_infinite]",
  completed: "bg-[#77cc57]",
  failed: "bg-[#cf745f]",
};

const stageStatusClasses: Record<CourseRunStageStatus, string> = {
  idle: "border-[#ddd4c8] bg-[#f7f1e9] text-[#8d8172]",
  running: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  completed: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  failed: "border-[#e4b6aa] bg-[#fff0eb] text-[#a44f3d]",
};

const pageProgressCopy: Record<CourseRunStageStatus, string> = {
  idle: "等待生成",
  running: "生成中",
  completed: "3 / 3 必需阶段",
  failed: "必需阶段失败",
};

const taskStatusClasses: Record<CourseTaskStatus, string> = {
  queued: "border-[#ddd4c8] bg-[#f7f1e9] text-[#8d8172]",
  running: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  completed: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  failed: "border-[#e4b6aa] bg-[#fff0eb] text-[#a44f3d]",
  cancelled: "border-[#d7c9b9] bg-[#f7f1e9] text-[#7c674e]",
};

const connectionStatusClasses: Record<
  CourseRunTimelineConnectionStatus,
  string
> = {
  idle: "border-[#ddd4c8] bg-[#f7f1e9] text-[#8d8172]",
  connecting: "border-[#ddd4c8] bg-[#fffaf2] text-[#7c674e]",
  open: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  reconnecting: "border-[#e8cf9d] bg-[#fff8e8] text-[#936e24]",
  closed: "border-[#ddd4c8] bg-[#f7f1e9] text-[#8d8172]",
};
