"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  CheckCircle2,
  CircleDashed,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";

import { HtmlPreviewFrame } from "@/features/keya/html-preview-frame";
import { cn } from "@/lib/utils";
import type { CourseRunStageStatus } from "@/types/keya";

export type CoursePreviewGridPage = {
  id: string;
  order: number;
  title: string;
  status: CourseRunStageStatus;
  htmlOutput?: string;
  error?: string;
};

type CoursePreviewGridProps = {
  pages: CoursePreviewGridPage[];
};

const statusCopy: Record<CourseRunStageStatus, string> = {
  idle: "等待生成",
  running: "生成中",
  completed: "已完成",
  failed: "生成失败",
};

const statusClasses: Record<CourseRunStageStatus, string> = {
  idle: "bg-[#f2ece4] text-[#7a7468]",
  running: "bg-[#edf5ee] text-[#2f6845]",
  completed: "bg-[#edf5ee] text-[#2f6845]",
  failed: "bg-[#fff0eb] text-[#a44f3d]",
};

/** 在一个课程工作区内切换页面；未选中的 HTML 不会创建 iframe。 */
export function CoursePreviewGrid({ pages }: CoursePreviewGridProps) {
  const orderedPages = useMemo(
    () => [...pages].sort((left, right) => left.order - right.order),
    [pages],
  );
  const preferredPage =
    orderedPages.find(
      ({ htmlOutput, status }) => status === "completed" && htmlOutput,
    ) ?? orderedPages[0];
  const [selectedPageId, setSelectedPageId] = useState<string | null>(
    preferredPage?.id ?? null,
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const componentId = useId().replaceAll(":", "");

  if (orderedPages.length === 0) {
    return (
      <section
        aria-label="课程多页预览"
        className="rounded-[24px] border border-[#e8dfd0] bg-[#fffcf5] p-6 text-center text-sm text-[#7a7468]"
      >
        课程页面生成后，可以在这里统一预览。
      </section>
    );
  }

  const storedSelectedIndex = orderedPages.findIndex(
    ({ id }) => id === selectedPageId,
  );
  const selectedIndex =
    storedSelectedIndex >= 0
      ? storedSelectedIndex
      : Math.max(
          0,
          orderedPages.findIndex(({ id }) => id === preferredPage?.id),
        );
  const selectedPage = orderedPages[selectedIndex];
  const selectedTabId = `${componentId}-page-tab-${selectedIndex}`;
  const panelId = `${componentId}-page-panel`;

  const selectPage = (index: number, moveFocus = false) => {
    const page = orderedPages[index];
    if (!page) return;
    setSelectedPageId(page.id);
    if (moveFocus) tabRefs.current[index]?.focus();
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | undefined;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + orderedPages.length) % orderedPages.length;
        break;
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % orderedPages.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = orderedPages.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    selectPage(nextIndex, true);
  };

  return (
    <section
      aria-labelledby={`${componentId}-title`}
      className="rounded-[24px] border border-[#e8dfd0] bg-[#fffcf5] p-4 shadow-[0_12px_36px_-30px_rgba(45,51,43,0.5)] sm:p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.08em] text-[#4f8f65]">
            COURSE PREVIEW
          </p>
          <h3
            className="mt-1 text-base font-semibold text-[#2d332b]"
            id={`${componentId}-title`}
          >
            多页课程预览
          </h3>
        </div>
        <p aria-live="polite" className="text-xs text-[#7a7468]">
          第 {selectedPage.order} 页，共 {orderedPages.length} 页
        </p>
      </div>

      <div className="mt-4 grid min-h-0 gap-4">
        <div
          aria-label="选择要预览的课程页面"
          className="grid max-h-[640px] content-start gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-1"
          role="tablist"
        >
          {orderedPages.map((page, index) => {
            const selected = index === selectedIndex;
            return (
              <button
                aria-controls={panelId}
                aria-selected={selected}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2",
                  selected
                    ? "border-[#9fc5aa] bg-[#edf5ee]"
                    : "border-[#e8dfd0] bg-[#fffcf5] hover:bg-[#f6eedc]",
                )}
                id={`${componentId}-page-tab-${index}`}
                key={page.id}
                onClick={() => selectPage(index)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                ref={(node) => {
                  tabRefs.current[index] = node;
                }}
                role="tab"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white font-mono text-xs font-semibold text-[#397a52] shadow-sm">
                  {String(page.order).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[#3f4a40]">
                    {page.title}
                  </span>
                  <span
                    className={cn(
                      "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                      statusClasses[page.status],
                    )}
                  >
                    <StatusIcon status={page.status} />
                    {statusCopy[page.status]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div
          aria-labelledby={selectedTabId}
          className="min-w-0 rounded-2xl border border-[#e8dfd0] bg-[#fff9ee] p-3 sm:p-4"
          id={panelId}
          role="tabpanel"
          tabIndex={0}
        >
          {selectedPage.status === "completed" && selectedPage.htmlOutput ? (
            <HtmlPreviewFrame
              className="h-full grid-rows-[auto_minmax(0,1fr)_auto]"
              frameClassName="h-full min-h-[420px]"
              html={selectedPage.htmlOutput}
              title={`${selectedPage.title} · 第 ${selectedPage.order} 页课程预览`}
            />
          ) : selectedPage.status === "failed" ? (
            <div
              className="rounded-2xl border border-[#edc4b9] bg-[#fff0eb] px-4 py-5 text-sm leading-6 text-[#984735]"
              role="alert"
            >
              <p className="font-semibold">这一页暂时无法预览</p>
              <p className="mt-1">
                {selectedPage.error ?? "HTML 生成失败，请返回工作区重试。"}
              </p>
            </div>
          ) : (
            <div
              aria-live="polite"
              className="flex min-h-[220px] items-center justify-center rounded-2xl bg-[#f6eedc] px-6 text-center text-sm leading-6 text-[#7a7468]"
            >
              {selectedPage.status === "running"
                ? "HTML Engineer 正在生成这一页…"
                : selectedPage.status === "completed"
                  ? "这一页的 HTML 结果缺失，请返回工作区重新生成。"
                  : "这一页尚未生成 HTML。"}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StatusIcon({ status }: { status: CourseRunStageStatus }) {
  const commonProps = {
    "aria-hidden": true,
    className: status === "running" ? "animate-spin" : undefined,
    size: 12,
    strokeWidth: 2,
  } as const;

  switch (status) {
    case "completed":
      return <CheckCircle2 {...commonProps} />;
    case "failed":
      return <TriangleAlert {...commonProps} />;
    case "running":
      return <LoaderCircle {...commonProps} />;
    case "idle":
      return <CircleDashed {...commonProps} />;
  }
}
