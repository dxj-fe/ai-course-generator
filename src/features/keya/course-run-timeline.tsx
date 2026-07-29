"use client";

import {
  Check,
  CirclePause,
  CircleX,
  Eye,
  LoaderCircle,
  Play,
  RotateCcw,
  Sprout,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CourseTaskConnectionStatus } from "@/features/course-planner/hooks/use-sse-task";
import {
  CourseBriefCard,
  CourseJourney,
} from "@/features/keya/course-creation-cards";
import {
  createCourseCreationBrief,
  type CourseCreationBrief,
} from "@/features/keya/course-creation-model";
import type { CourseTaskStatus } from "@/shared/course-schema";
import type { CourseGenerationError } from "@/shared/course-schema";
import type { KeyaCourseRun } from "@/types/keya";

interface CourseRunTimelineProps {
  busy?: boolean;
  connectionStatus?: CourseTaskConnectionStatus;
  nowMs?: number;
  onOpenCoursePlayer?(): void;
  onResumeCourse?(): void;
  run: KeyaCourseRun;
  taskStatus?: CourseTaskStatus;
}

export type CourseFailurePresentation = {
  actionLabel: string;
  description: string;
  title: string;
};

/**
 * 只依据稳定错误码返回有限公开文案。
 * 持久化错误中的供应商响应、Schema 路径和内部阶段名不进入产品界面。
 */
export function getCourseFailurePresentation(
  status: "cancelled" | "failed",
  error?: Pick<CourseGenerationError, "causeCode" | "code">,
): CourseFailurePresentation {
  if (status === "cancelled") {
    return {
      actionLabel: "继续生成",
      description: "已完成的课程内容已经保存，需要时可以继续。",
      title: "课程生成已取消",
    };
  }

  if (
    error?.causeCode === "SCHEMA_ERROR" &&
    error.code === "PAGE_WORKER_RETRY_EXHAUSTED"
  ) {
    return {
      actionLabel: "重新生成",
      description:
        "部分页面没有通过内容或互动结构校验，重新生成时会从失败页面继续修正。",
      title: "页面结构校验未通过",
    };
  }
  if (
    error?.causeCode === "SCHEMA_ERROR" &&
    ["REPAIR_EXECUTION_RETRY_EXHAUSTED", "REPAIR_FAILED"].includes(
      error.code,
    )
  ) {
    return {
      actionLabel: "重新生成",
      description:
        "页面修订结果没有通过授权范围或结构校验，重新生成时会从检查点重新评估。",
      title: "页面修复未通过",
    };
  }

  switch (error?.causeCode ?? error?.code) {
    case "SCHEMA_ERROR":
    case "COURSE_DESIGN_VALIDATION_ERROR":
      return {
        actionLabel: "重新生成",
        description: "这次返回的课程内容格式不完整，重新生成时会修正这一部分。",
        title: "课程内容需要重新生成",
      };
    case "RATE_LIMIT_ERROR":
    case "MODEL_RATE_LIMITED":
      return {
        actionLabel: "稍后继续",
        description: "模型服务当前请求较多，请稍等片刻后继续。",
        title: "模型服务繁忙",
      };
    case "TIMEOUT_ERROR":
    case "MODEL_TIMEOUT":
    case "REPAIR_TIMEOUT":
      return {
        actionLabel: "重新生成",
        description: "本次生成等待时间过长，可以重新继续未完成的部分。",
        title: "课程生成超时",
      };
    case "QUOTA_ERROR":
      return {
        actionLabel: "额度恢复后继续",
        description: "请检查模型服务账户的额度或计费状态，然后继续生成。",
        title: "模型服务额度不足",
      };
    case "AUTH_ERROR":
      return {
        actionLabel: "配置完成后继续",
        description: "请检查模型服务的 API Key 和访问权限，然后继续生成。",
        title: "模型服务认证失败",
      };
    case "CONFIG_ERROR":
      return {
        actionLabel: "配置完成后继续",
        description: "请先完成模型服务配置，然后继续生成。",
        title: "模型服务尚未配置",
      };
    case "MODEL_ERROR":
    case "MODEL_PROVIDER_ERROR":
      return {
        actionLabel: "重新生成",
        description: "模型服务这次没有返回有效结果，请稍后继续。",
        title: "模型服务调用失败",
      };
    default:
      return {
        actionLabel: "重新生成",
        description: "未完成的课程内容可以从已保存的位置重新生成。",
        title: "课程生成失败",
      };
  }
}

/**
 * 将内部任务投影为用户可理解的单一课程状态。
 * Agent、工作流、连接、重试与原始错误继续保留在服务端诊断中。
 */
export function CourseRunTimeline({
  busy = false,
  onOpenCoursePlayer,
  onResumeCourse,
  run,
  taskStatus,
}: CourseRunTimelineProps) {
  const outline =
    run.generation?.outline ?? run.planner.data?.state.outline;
  const intent = run.generation?.intent ?? run.planner.data?.intent;
  const pages = outline?.pages ?? [];
  const pageProgress = pages.map((page) => {
    const generated = run.generation?.pages.find(
      ({ pageId }) => pageId === page.id,
    );
    const htmlStage = run.pageHtml[page.id];
    const html =
      generated?.htmlOutput?.html ?? htmlStage?.data?.state.htmlOutput?.html;
    const status = generated?.status ?? htmlStage?.status ?? "idle";
    return { html, page, status };
  });
  const completedPages = pageProgress
    .filter(({ html, status }) => status === "completed" && Boolean(html))
    .map(({ page }) => page);
  const runningPages = pageProgress
    .filter(({ status }) => status === "running")
    .map(({ page }) => page);
  const totalPages =
    pages.length ||
    intent?.courseLength ||
    resolveDisplayedSectionCount(createCourseCreationBrief(run.prompt));
  const completedCount = completedPages.length;
  const currentPageFromState = pageProgress.find(
    ({ page, status }) =>
      page.id === run.generation?.currentPageId &&
      status !== "completed" &&
      status !== "failed",
  )?.page;
  const activePages =
    runningPages.length > 0
      ? runningPages
      : [
          currentPageFromState ??
            pageProgress.find(
              ({ status }) =>
                status !== "completed" && status !== "failed",
            )?.page,
        ].filter((page): page is (typeof pages)[number] => Boolean(page));
  const generationStatus = run.generation?.status;
  const requestFailed =
    !run.generation && run.planner.status === "failed";
  const completed =
    generationStatus === "completed" ||
    (totalPages > 0 && completedCount === totalPages);
  const terminalStatus =
    generationStatus === "cancelled" || taskStatus === "cancelled"
      ? "cancelled"
      : generationStatus === "failed" || taskStatus === "failed" || requestFailed
        ? "failed"
        : undefined;
  const failure = terminalStatus
    ? getCourseFailurePresentation(
        terminalStatus,
        run.generation?.errors.at(-1),
      )
    : undefined;
  const paused = taskStatus === "paused";
  const canResume = Boolean((paused || failure) && onResumeCourse);
  const firstPage = pages[0];
  const firstPageReady = firstPage
    ? completedPages.some(({ id }) => id === firstPage.id)
    : false;
  const brief = briefFromRun(run, totalPages);
  const statusTitle = completed
    ? "课程已经准备好了"
    : paused
      ? "课程生成已暂停"
      : failure
      ? failure.title
      : completedCount > 0
        ? `课程已生成 ${completedCount} / ${totalPages} 节`
        : "正在规划课程结构";
  const statusDescription = completed
    ? `全部 ${totalPages} 节内容已经完成，可以开始学习。`
    : paused
      ? totalPages > 0
        ? `当前进度已保存，已完成 ${completedCount} / ${totalPages} 节，可以随时继续。`
        : "当前进度已保存，可以随时继续生成。"
      : failure
      ? totalPages > 0
        ? `${failure.description} 已完成 ${completedCount} / ${totalPages} 节。`
        : failure.description
      : activePages.length > 1
        ? `正在并行生成第 ${activePages.map(({ order }) => order).join("、")} 节`
        : activePages[0]
          ? `正在生成第 ${activePages[0].order} 节：${activePages[0].title}`
        : "课芽正在把课程方向整理成清晰的学习路径。";

  return (
    <section
      aria-labelledby="course-generation-title"
      className="keya-page-reveal grid gap-6"
    >
      <div className="flex items-start gap-3">
        <span className="keya-gentle-bob mt-1 flex size-10 shrink-0 items-center justify-center rounded-[15px] bg-[linear-gradient(145deg,#74c67a,#397a52)] text-white shadow-[0_12px_24px_-13px_rgba(47,104,69,0.9)] ring-2 ring-white/80">
          <Sprout aria-hidden="true" size={20} strokeWidth={1.8} />
        </span>
        <CourseBriefCard brief={brief} />
      </div>

      <CourseJourney activeStep={completed ? 3 : 2} />

      <section className="relative ml-[52px] overflow-hidden rounded-[24px] border border-[#c5ddc1] bg-[radial-gradient(circle_at_100%_0%,rgba(191,231,174,0.42),transparent_14rem),rgba(255,255,255,0.86)] p-5 shadow-[0_20px_44px_-34px_rgba(35,82,49,0.72)] backdrop-blur-sm">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-4 -bottom-7 h-20 w-12 rotate-[30deg] rounded-[90%_10%_90%_10%] bg-[#74c67a]/10"
        />
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
              completed
                ? "bg-[#dff1d9] text-primary shadow-[0_8px_18px_-14px_rgba(47,104,69,0.8)]"
                : paused
                  ? "bg-[#f7efdf] text-[#946f32]"
                : failure
                  ? "bg-[#fff0e8] text-[#b2643f]"
                  : "bg-[#e3f2de] text-primary ring-4 ring-[#edf8ea]"
            }`}
          >
            {completed ? (
              <Check aria-hidden="true" size={17} strokeWidth={2.2} />
            ) : paused ? (
              <CirclePause aria-hidden="true" size={16} strokeWidth={1.8} />
            ) : failure ? (
              <CircleX aria-hidden="true" size={16} strokeWidth={1.8} />
            ) : (
              <LoaderCircle
                aria-hidden="true"
                className="motion-safe:animate-spin"
                size={17}
                strokeWidth={1.8}
              />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="text-base font-semibold text-foreground"
              id="course-generation-title"
            >
              {statusTitle}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {statusDescription}
            </p>
          </div>
        </div>

        {totalPages > 0 ? (
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>课程内容</span>
              <span className="font-medium text-foreground">
                {completedCount} / {totalPages} 节
              </span>
            </div>
            <div
              aria-label={`课程已生成 ${completedCount} / ${totalPages} 节`}
              aria-valuemax={totalPages}
              aria-valuemin={0}
              aria-valuenow={completedCount}
              className="h-2.5 overflow-hidden rounded-full bg-[#dfeeda] shadow-inner"
              role="progressbar"
            >
              <span
                className="relative block h-full overflow-hidden rounded-full bg-[linear-gradient(90deg,#397a52,#74c67a)] shadow-[0_0_14px_rgba(80,160,92,0.35)] transition-[width] duration-500 motion-reduce:transition-none"
                style={{
                  width: `${(completedCount / totalPages) * 100}%`,
                }}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 right-0 w-8 skew-x-[-24deg] bg-white/40 motion-safe:animate-pulse"
                />
              </span>
            </div>
          </div>
        ) : paused ? (
          <div
            aria-live="polite"
            className="mt-5 flex items-center gap-2 rounded-xl bg-[#fbf4e6] px-3 py-2.5 text-xs text-[#806334]"
          >
            <CirclePause
              aria-hidden="true"
              size={15}
              strokeWidth={1.8}
            />
            章节规划已暂停，已保存当前进度
          </div>
        ) : (
          <div
            aria-live="polite"
            className="mt-5 flex items-center gap-2 rounded-2xl border border-[#d5e7d0] bg-[#edf8ea]/80 px-3 py-2.5 text-xs text-[#627364]"
          >
            <LoaderCircle
              aria-hidden="true"
              className="text-primary motion-safe:animate-spin"
              size={15}
              strokeWidth={1.8}
            />
            正在根据内容深度规划章节结构
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {canResume ? (
            <Button
              className="h-10 rounded-2xl bg-[linear-gradient(145deg,#68b96f,#397a52)] px-4 text-sm font-semibold text-white shadow-[0_10px_22px_-14px_rgba(47,104,69,0.85)] transition duration-200 hover:-translate-y-0.5 hover:bg-[linear-gradient(145deg,#74c67a,#2f6845)] motion-reduce:transform-none"
              disabled={busy}
              onClick={onResumeCourse}
              type="button"
            >
              {paused ? (
                <Play aria-hidden="true" size={16} strokeWidth={1.8} />
              ) : (
                <RotateCcw aria-hidden="true" size={16} strokeWidth={1.8} />
              )}
              {busy
                ? "正在继续…"
                : paused
                  ? "继续生成"
                  : failure?.actionLabel}
            </Button>
          ) : null}
          {(completed || firstPageReady) && onOpenCoursePlayer ? (
            <Button
              className={
                completed
                  ? "h-10 rounded-2xl bg-[linear-gradient(145deg,#68b96f,#397a52)] px-4 text-sm font-semibold text-white shadow-[0_10px_22px_-14px_rgba(47,104,69,0.85)] transition duration-200 hover:-translate-y-0.5 hover:bg-[linear-gradient(145deg,#74c67a,#2f6845)] motion-reduce:transform-none"
                  : "h-10 rounded-2xl border-[#9dc59a] bg-white/78 px-4 text-sm font-semibold text-primary shadow-[0_9px_20px_-16px_rgba(47,104,69,0.7)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#edf8ea] motion-reduce:transform-none"
              }
              onClick={onOpenCoursePlayer}
              type="button"
              variant={completed ? "default" : "outline"}
            >
              {completed ? (
                <Play aria-hidden="true" size={16} strokeWidth={1.8} />
              ) : (
                <Eye aria-hidden="true" size={16} strokeWidth={1.8} />
              )}
              {completed ? "开始学习" : "先预览课程"}
            </Button>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function briefFromRun(
  run: KeyaCourseRun,
  totalPages: number,
): CourseCreationBrief {
  const base = createCourseCreationBrief(run.prompt);
  const intent = run.generation?.intent ?? run.planner.data?.intent;
  const outline =
    run.generation?.outline ?? run.planner.data?.state.outline;
  const interactionTypes = new Set(
    outline?.pages.map(({ interactionType }) => interactionType) ?? [],
  );
  const learningMode =
    interactionTypes.size === 0 ||
    [...interactionTypes].every((type) => type === "none" || type === "navigate")
      ? "guided"
      : "mixed";

  return {
    ...base,
    audience: intent?.audienceAgeRange.label ?? base.audience,
    goal:
      outline?.learningObjectives[0] ??
      outline?.overview ??
      base.goal ??
      "掌握课程核心内容",
    language: intent?.language ?? base.language,
    learningMode,
    sectionCount:
      totalPages > 0 ? totalPages : "auto",
    topic: intent?.topic ?? base.topic,
  };
}

function resolveDisplayedSectionCount(brief: CourseCreationBrief) {
  return typeof brief.sectionCount === "number" ? brief.sectionCount : 0;
}
