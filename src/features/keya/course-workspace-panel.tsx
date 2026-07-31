"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CirclePause,
  CircleX,
  Download,
  Eye,
  LoaderCircle,
  Play,
  RotateCcw,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CourseCreationBrief } from "@/features/keya/course-creation-model";
import { getCourseFailurePresentation } from "@/features/keya/course-run-timeline";
import type { CourseTaskStatus } from "@/shared/course-schema";
import type { KeyaCourseRun } from "@/types/keya";

type CourseWorkspacePanelProps = {
  run?: KeyaCourseRun;
  brief?: CourseCreationBrief;
  busy?: boolean;
  onOpenHtmlPreview(pageId: string): void;
  onOpenCoursePlayer?(): void;
  onResumeCourse(): void;
  onExportCourse(): void;
  exporting?: boolean;
  exportError?: string;
  taskStatus?: CourseTaskStatus;
};

type DraftSection = {
  id: string;
  order: number;
  title: string;
  status: "completed" | "failed" | "paused" | "running" | "pending";
  html?: string;
};

/**
 * 普通用户的课程草稿只呈现课程结构、可用内容和下一步。
 * 设计、素材、质量与修复细节仍保留在生成状态中，但不进入此产品表面。
 */
export function CourseWorkspacePanel({
  run,
  brief,
  busy = false,
  onOpenHtmlPreview,
  onOpenCoursePlayer,
  onResumeCourse,
  onExportCourse,
  exporting = false,
  exportError,
  taskStatus,
}: CourseWorkspacePanelProps) {
  const outline = run?.generation?.outline;
  const intent = run?.generation?.intent;
  const generationStatus = run?.generation?.status;
  const requestFailed =
    !run?.generation && run?.planner.status === "failed";
  const sections = useMemo(
    () => buildDraftSections(run, taskStatus),
    [run, taskStatus],
  );
  const firstReadyId = sections.find(({ status, html }) => status === "completed" && html)?.id;
  const [selectedId, setSelectedId] = useState<string>();
  const effectiveSelectedId =
    sections.some(({ id, html }) => id === selectedId && html)
      ? selectedId
      : firstReadyId;
  const selectedSection = sections.find(({ id }) => id === effectiveSelectedId);
  const completedCount = sections.filter(
    ({ status }) => status === "completed",
  ).length;
  const failedCount = sections.filter(
    ({ status }) => status === "failed",
  ).length;
  const pausedCount = sections.filter(
    ({ status }) => status === "paused",
  ).length;
  const knownSectionCount =
    sections.length ||
    (typeof brief?.sectionCount === "number" ? brief.sectionCount : 0);
  const terminalStatus =
    generationStatus === "cancelled"
      ? "cancelled"
      : generationStatus === "failed" || requestFailed
        ? "failed"
        : undefined;
  const failure = terminalStatus
    ? getCourseFailurePresentation(
        terminalStatus,
        run?.generation?.errors.at(-1),
      )
    : undefined;
  const complete =
    generationStatus === "completed" ||
    (sections.length > 0 && completedCount === sections.length);
  const topic = intent?.topic ?? brief?.topic ?? "新课程";
  const summary =
    outline?.overview ??
    brief?.goal ??
    "确认课程方向后，课芽会把每一节内容依次整理到这里。";

  return (
    <section
      aria-labelledby="course-workspace-title"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(247,252,242,0.98)_0%,rgba(237,248,234,0.95)_100%)] text-foreground"
    >
      <header className="relative min-w-0 shrink-0 overflow-hidden border-b border-[#cfe2ca] bg-[radial-gradient(circle_at_100%_0%,rgba(166,218,162,0.42),transparent_15rem),rgba(255,255,255,0.52)] px-5 py-6">
        <span
          aria-hidden="true"
          className="keya-gentle-bob pointer-events-none absolute -right-3 bottom-2 h-20 w-11 rotate-[30deg] rounded-[90%_10%_90%_10%] bg-[#74c67a]/13"
        />
        <p className="relative z-[1] text-xs font-semibold tracking-[0.12em] text-primary">
          课程草稿
        </p>
        <h2
          className="relative z-[1] mt-2 text-[22px] leading-8 font-semibold text-[#284d34]"
          id="course-workspace-title"
        >
          {topic}
        </h2>
        <p className="relative z-[1] mt-2 line-clamp-3 text-sm leading-6 text-[#667568]">
          {summary}
        </p>
        <div className="relative z-[1] mt-4 flex flex-wrap gap-2">
          <MetaPill>
            {intent?.audienceAgeRange.label ?? brief?.audience ?? "初学者"}
          </MetaPill>
          <MetaPill>
            {knownSectionCount > 0
              ? `${knownSectionCount} 节`
              : "按内容规划章节"}
          </MetaPill>
          <MetaPill>
            {brief?.learningMode === "practice"
              ? "互动练习"
              : brief?.learningMode === "guided"
                ? "讲解为主"
                : "讲解 + 互动"}
          </MetaPill>
          {taskStatus === "paused" ? (
            <span className="rounded-full bg-[#f7efdf] px-3 py-1 text-xs font-medium text-[#8a672f]">
              已暂停
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-5 py-4">
        <section
          aria-labelledby="course-draft-sections-title"
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 items-end justify-between gap-3">
            <div>
              <h3
                className="text-base font-semibold"
                id="course-draft-sections-title"
              >
                课程内容
              </h3>
              <p
                aria-atomic="true"
                aria-live="polite"
                className="mt-1 text-xs text-muted-foreground"
                role="status"
              >
                {knownSectionCount > 0
                  ? [
                      `已完成 ${completedCount} / ${knownSectionCount} 节`,
                      failedCount > 0
                        ? taskStatus === "queued" || taskStatus === "running"
                          ? `${failedCount} 节暂未完成`
                          : taskStatus === "paused"
                            ? `${failedCount} 节未完成`
                            : `${failedCount} 节待处理`
                        : undefined,
                      pausedCount > 0
                        ? `${pausedCount} 节已暂停`
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : taskStatus === "paused"
                    ? "课程规划已暂停"
                    : "正在确定最合适的章节结构"}
              </p>
            </div>
            {complete ? (
              <span className="rounded-full border border-[#cfe2ca] bg-[#dff1d9] px-2.5 py-1 text-[11px] font-medium text-primary shadow-[0_8px_18px_-16px_rgba(47,104,69,0.65)]">
                已完成
              </span>
            ) : null}
          </div>

          {sections.length > 0 ? (
            <ol
              aria-label="课程章节列表"
              className="scrollbar-hide mt-4 min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain rounded-[22px] border border-[#cfe2ca] bg-white/72 shadow-[0_18px_40px_-34px_rgba(35,82,49,0.65)] backdrop-blur-sm"
            >
              {sections.map((section) => {
                const interactive =
                  section.status === "completed" && Boolean(section.html);
                return (
                  <li
                    className="border-b border-[#dcead8] last:border-b-0"
                    key={section.id}
                  >
                    <button
                      aria-current={section.id === effectiveSelectedId ? "true" : undefined}
                      className={`flex min-h-[70px] w-full items-center gap-3 px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed ${
                        section.id === effectiveSelectedId
                          ? "bg-[#dff1d9]/88 shadow-[inset_3px_0_0_#397a52]"
                          : interactive
                            ? "hover:bg-[#edf8ea]/80"
                            : "bg-white/35"
                      }`}
                      disabled={!interactive}
                      onClick={() => setSelectedId(section.id)}
                      type="button"
                    >
                      <SectionStatusIcon
                        order={section.order}
                        status={section.status}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 block break-words text-sm font-medium">
                          第 {section.order} 节 · {section.title}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {sectionStatusCopy(section.status, taskStatus)}
                        </span>
                      </span>
                      {interactive ? (
                        <ChevronRight
                          aria-hidden="true"
                          className="text-primary"
                          size={16}
                          strokeWidth={1.8}
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="keya-page-reveal relative mt-4 overflow-hidden rounded-[22px] border border-dashed border-[#aecdac] bg-[linear-gradient(145deg,rgba(255,255,255,0.72),rgba(227,242,222,0.72))] px-4 py-5 shadow-[0_16px_34px_-30px_rgba(47,104,69,0.55)]">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-3 -bottom-6 h-20 w-11 rotate-[35deg] rounded-[90%_10%_90%_10%] bg-[#74c67a]/12"
              />
              <p className="text-sm font-medium text-foreground">
                {taskStatus === "paused"
                  ? "课程规划已暂停"
                  : "课芽正在规划课程结构"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {taskStatus === "paused"
                  ? "继续生成后，会从已保存的位置恢复章节规划。"
                  : "会根据知识依赖、内容深度和练习需要确定章节，规划完成后在这里展示。"}
              </p>
            </div>
          )}
        </section>

        {selectedSection?.html ? (
          <section
            aria-labelledby="course-draft-preview-title"
            className="keya-card-lift min-w-0 shrink-0 rounded-[22px] border border-[#c5ddc1] bg-white/78 p-3 shadow-[0_14px_30px_-26px_rgba(47,104,69,0.6)] backdrop-blur-sm"
          >
            <div className="flex items-center gap-3 px-1">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[14px] bg-[#dff1d9] text-primary shadow-[0_8px_18px_-14px_rgba(47,104,69,0.7)]">
                <Eye aria-hidden="true" size={17} strokeWidth={1.8} />
              </span>
              <div className="min-w-0">
                <h3
                  className="line-clamp-2 break-words text-sm font-semibold"
                  id="course-draft-preview-title"
                >
                  第 {selectedSection.order} 节 · {selectedSection.title}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  已完成，可打开查看完整互动内容
                </p>
              </div>
              <Button
                className="ml-auto h-8 shrink-0 rounded-full border border-transparent px-3 text-xs text-primary hover:border-[#d5e7d0] hover:bg-[#edf8ea]"
                onClick={() => onOpenHtmlPreview(selectedSection.id)}
                type="button"
                variant="ghost"
              >
                <Eye aria-hidden="true" size={14} strokeWidth={1.8} />
                查看内容
              </Button>
            </div>
          </section>
        ) : null}

        {failure ? (
          <Alert className="rounded-2xl border-[#efcdbd] bg-[#fff3ec] p-4 text-[#8e4f34]">
            <div className="flex items-start gap-3">
              <RotateCcw
                aria-hidden="true"
                className="mt-0.5 shrink-0"
                size={17}
                strokeWidth={1.8}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{failure.title}</p>
                <p className="mt-1 text-xs leading-5">
                  {failure.description} 已完成的 {completedCount} 节内容不会丢失。
                </p>
                <Button
                  className="mt-3 h-9 rounded-xl bg-[linear-gradient(145deg,#68b96f,#397a52)] px-3 text-xs font-semibold text-white shadow-[0_9px_20px_-13px_rgba(47,104,69,0.82)] transition duration-200 hover:-translate-y-0.5 hover:bg-[linear-gradient(145deg,#74c67a,#2f6845)] motion-reduce:transform-none"
                  disabled={busy}
                  onClick={onResumeCourse}
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={14} strokeWidth={1.8} />
                  {busy
                    ? failedCount > 0
                      ? "正在重新生成失败章节…"
                      : "正在继续…"
                    : failure.actionLabel === "重新生成" && failedCount > 0
                      ? `重试 ${failedCount} 个失败章节`
                      : failure.actionLabel}
                </Button>
              </div>
            </div>
          </Alert>
        ) : null}

        {exportError ? (
          <Alert className="rounded-2xl border-[#efcdbd] bg-[#fff3ec] text-sm text-[#8e4f34]">
            课程暂时无法导出，请稍后再试。
          </Alert>
        ) : null}

        {completedCount > 0 && onOpenCoursePlayer ? (
          <Button
            className="h-12 w-full shrink-0 rounded-2xl bg-[linear-gradient(145deg,#68b96f,#397a52)] text-sm font-semibold text-white shadow-[0_14px_28px_-15px_rgba(47,104,69,0.9)] transition duration-200 hover:-translate-y-0.5 hover:bg-[linear-gradient(145deg,#74c67a,#2f6845)] hover:shadow-[0_17px_32px_-15px_rgba(47,104,69,0.95)] motion-reduce:transform-none"
            onClick={onOpenCoursePlayer}
            type="button"
          >
            <Play aria-hidden="true" size={17} strokeWidth={1.8} />
            {complete ? "开始学习" : "先预览课程"}
          </Button>
        ) : null}

        {complete ? (
          <Button
            className="h-10 w-full shrink-0 rounded-2xl border-[#c5ddc1] bg-white/78 text-xs text-[#667568] shadow-[0_10px_22px_-18px_rgba(47,104,69,0.55)] hover:bg-white hover:text-[#2f6845]"
            disabled={exporting}
            onClick={onExportCourse}
            type="button"
            variant="outline"
          >
            {exporting ? (
              <LoaderCircle
                aria-hidden="true"
                className="motion-safe:animate-spin"
                size={15}
              />
            ) : (
              <Download aria-hidden="true" size={15} strokeWidth={1.8} />
            )}
            {exporting ? "正在整理课程…" : "下载课程"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function buildDraftSections(
  run?: KeyaCourseRun,
  taskStatus?: CourseTaskStatus,
): DraftSection[] {
  const outline = run?.generation?.outline;
  if (outline) {
    const generationFailed =
      taskStatus === "failed" || run?.generation?.status === "failed";
    return outline.pages.map((page) => {
      const generated = run?.generation?.pages.find(
        ({ pageId }) => pageId === page.id,
      );
      const htmlStage = run?.pageHtml[page.id];
      const html = generated?.htmlOutput?.html;
      const status = generated?.status ?? htmlStage?.status ?? "idle";

      return {
        id: page.id,
        order: page.order,
        title: page.title,
        html,
        status:
          status === "completed"
            ? "completed"
            : generationFailed
              ? "failed"
            : status === "failed"
              ? "failed"
              : status === "running" && taskStatus === "paused"
                ? "paused"
                : status === "running"
                  ? "running"
                  : "pending",
      };
    });
  }

  return [];
}

function SectionStatusIcon({
  order,
  status,
}: {
  order: number;
  status: DraftSection["status"];
}) {
  if (status === "completed") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[11px] bg-[linear-gradient(145deg,#74c67a,#397a52)] text-white shadow-[0_8px_16px_-10px_rgba(47,104,69,0.9)]">
        <Check aria-hidden="true" size={14} strokeWidth={2.2} />
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[11px] border-2 border-[#e0a126] bg-[#fff9e8] text-[#b77700] shadow-[0_7px_16px_-12px_rgba(183,119,0,0.8)]">
        <LoaderCircle
          aria-hidden="true"
          className="motion-safe:animate-spin"
          size={14}
          strokeWidth={1.8}
        />
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[11px] border border-[#d9bd85] bg-[#fbf4e6] text-[#946f32]">
        <CirclePause aria-hidden="true" size={14} strokeWidth={1.8} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[11px] border border-[#d99779] bg-[#fff5ef] text-[#a85e3c]">
        <CircleX aria-hidden="true" size={13} strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-[11px] border border-[#bcd6b8] bg-[#edf8ea]/70 text-xs font-medium text-[#778778]">
      {order}
    </span>
  );
}

function MetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[#c5ddc1] bg-white/64 px-3 py-1 text-xs text-[#5f7562] shadow-[0_8px_18px_-16px_rgba(47,104,69,0.55)]">
      {children}
    </span>
  );
}

function sectionStatusCopy(
  status: DraftSection["status"],
  taskStatus?: CourseTaskStatus,
) {
  switch (status) {
    case "completed":
      return "已完成，可查看";
    case "running":
      return "正在生成";
    case "paused":
      return "已暂停，继续后恢复";
    case "failed":
      return taskStatus === "queued" || taskStatus === "running"
        ? "本节暂未完成，其余章节继续生成"
        : taskStatus === "paused"
          ? "本节未完成，继续后重新生成"
          : "需要重新生成";
    case "pending":
      return taskStatus === "paused" ? "等待继续生成" : "稍后生成";
  }
}
