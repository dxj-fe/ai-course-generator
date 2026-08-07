"use client";

import Link from "next/link";
import {
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  BookOpen,
  Captions,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  List,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Monitor,
  Pause,
  Play,
  Volume2,
  X,
} from "lucide-react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import {
  buildCoursePlayerManifest,
  getAdjacentReadySectionId,
  getInitialCourseSectionId,
  type CoursePlayerManifest,
  type CoursePlayerSection,
} from "@/features/keya/course-player-model";
import {
  HtmlPreviewFrame,
  HtmlThumbnailFrame,
} from "@/features/keya/html-preview-frame";
import type {
  CourseGenerationState,
  LessonRuntimeEvent,
} from "@/shared/course-schema";

type LearningMode = "guided" | "self-paced";

type StoredLearningSession = {
  currentSectionId?: string;
  completedSectionIds: string[];
  mode: LearningMode;
  captionsEnabled: boolean;
  narrationRate: number;
  pageStates: Record<string, StoredPageRuntimeState>;
};

type StoredPageRuntimeState = {
  htmlRevision?: number;
  runtimeStatus?: "ready" | "error";
  attempts: number;
  lastResult?: "correct" | "incorrect" | "partial";
};

export function InteractiveCoursePlayer({
  course,
}: {
  course: CourseGenerationState;
}) {
  const manifest = useMemo(() => buildCoursePlayerManifest(course), [course]);
  const firstSectionId = getInitialCourseSectionId(manifest);
  const [currentSectionId, setCurrentSectionId] = useState(firstSectionId);
  const [completedSectionIds, setCompletedSectionIds] = useState<string[]>([]);
  const [mode, setMode] = useState<LearningMode>("guided");
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [narrationRate, setNarrationRate] = useState(1);
  const [narrating, setNarrating] = useState(false);
  const [pageStates, setPageStates] = useState<
    Record<string, StoredPageRuntimeState>
  >({});
  const [mapOpen, setMapOpen] = useState(false);
  const [mapCollapsed, setMapCollapsed] = useState(true);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const previousSectionRef = useRef(currentSectionId);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasSlotRef = useRef<HTMLDivElement>(null);
  const thumbnailRailRef = useRef<HTMLOListElement>(null);
  const [canvasSize, setCanvasSize] = useState<{
    height: number;
    width: number;
  }>();
  const currentSection =
    manifest.sections.find(({ id }) => id === currentSectionId) ??
    manifest.sections.find(({ id }) => id === firstSectionId);
  const readySections = manifest.sections.filter(
    ({ generationStatus }) => generationStatus === "ready",
  );
  const previousId = currentSection
    ? getAdjacentReadySectionId(manifest, currentSection.id, "previous")
    : undefined;
  const nextId = currentSection
    ? getAdjacentReadySectionId(manifest, currentSection.id, "next")
    : undefined;
  const narration = currentSection?.narration.join(" ") ?? "";
  const currentSectionLabel = currentSection
    ? `第 ${currentSection.order} 节 · ${currentSection.title}`
    : "课程内容准备中";
  const currentRuntimeIncomplete = Boolean(
    currentSection &&
      currentSection.runtime?.completionRule.type !== undefined &&
      currentSection.runtime.completionRule.type !== "view" &&
      !completedSectionIds.includes(currentSection.id) &&
      pageStates[currentSection.id]?.runtimeStatus !== "error",
  );
  const storageKey = `keya:course-session:${manifest.courseId}`;

  useEffect(() => {
    try {
      const saved = parseStoredSession(localStorage.getItem(storageKey));
      const storedSectionId = getInitialCourseSectionId(
        manifest,
        saved?.currentSectionId,
      );
      setCurrentSectionId(storedSectionId);
      setCompletedSectionIds(
        saved?.completedSectionIds.filter((id) =>
          manifest.sections.some((section) => {
            if (section.id !== id || section.generationStatus !== "ready") {
              return false;
            }
            const savedRevision = saved.pageStates[id]?.htmlRevision;
            return (
              savedRevision === undefined ||
              section.htmlRevision === undefined ||
              savedRevision === section.htmlRevision
            );
          }),
        ) ?? [],
      );
      setMode(saved?.mode ?? "guided");
      setCaptionsEnabled(saved?.captionsEnabled ?? true);
      setNarrationRate(saved?.narrationRate ?? 1);
      setPageStates(saved?.pageStates ?? {});
    } finally {
      setHydrated(true);
    }
  }, [manifest, storageKey]);

  useEffect(() => {
    if (!hydrated) return;
    const value: StoredLearningSession = {
      currentSectionId,
      completedSectionIds,
      mode,
      captionsEnabled,
      narrationRate,
      pageStates,
    };
    localStorage.setItem(storageKey, JSON.stringify(value));
  }, [
    captionsEnabled,
    completedSectionIds,
    currentSectionId,
    hydrated,
    mode,
    narrationRate,
    pageStates,
    storageKey,
  ]);

  useEffect(() => {
    if (previousSectionRef.current !== currentSectionId) {
      window.speechSynthesis?.cancel();
      setNarrating(false);
      previousSectionRef.current = currentSectionId;
    }
  }, [currentSectionId]);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  useEffect(() => {
    const handleFullscreenChange = () => {
      setFullscreen(document.fullscreenElement === canvasRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    const slot = canvasSlotRef.current;
    if (!slot || typeof ResizeObserver === "undefined") return;

    const updateCanvasSize = () => {
      const bounds = slot.getBoundingClientRect();
      const width = Math.floor(
        Math.min(1280, bounds.width, (bounds.height * 16) / 9),
      );
      if (width <= 0) return;
      const height = Math.floor((width * 9) / 16);
      setCanvasSize((current) =>
        current?.width === width && current.height === height
          ? current
          : { height, width },
      );
    };

    updateCanvasSize();
    const observer = new ResizeObserver(updateCanvasSize);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [mapCollapsed, thumbnailsOpen]);

  const selectSection = (sectionId: string) => {
    const valid = manifest.sections.some(
      ({ generationStatus, id }) =>
        id === sectionId && generationStatus === "ready",
    );
    if (!valid) return;
    setCurrentSectionId(sectionId);
    setMapOpen(false);
  };

  const setLearningMode = (nextMode: LearningMode) => {
    if (nextMode === "self-paced") {
      window.speechSynthesis?.cancel();
      setNarrating(false);
    }
    setMode(nextMode);
  };

  const toggleNarration = () => {
    if (!narration || mode !== "guided" || !("speechSynthesis" in window)) {
      return;
    }
    if (narrating) {
      window.speechSynthesis.cancel();
      setNarrating(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(narration);
    utterance.lang = "zh-CN";
    utterance.rate = narrationRate;
    utterance.onend = () => setNarrating(false);
    utterance.onerror = () => setNarrating(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setNarrating(true);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === canvasRef.current) {
        await document.exitFullscreen();
        return;
      }
      await canvasRef.current?.requestFullscreen();
    } catch {
      setFullscreen(false);
    }
  };

  const completeAndMove = (targetId?: string) => {
    if (!currentSection) return;
    const runtimeState = pageStates[currentSection.id];
    const requiresInteraction =
      currentSection.runtime?.completionRule.type !== undefined &&
      currentSection.runtime.completionRule.type !== "view";
    if (
      requiresInteraction &&
      !completedSectionIds.includes(currentSection.id) &&
      runtimeState?.runtimeStatus !== "error"
    ) {
      return;
    }
    setCompletedSectionIds((current) =>
      current.includes(currentSection.id)
        ? current
        : [...current, currentSection.id],
    );
    if (targetId) selectSection(targetId);
  };

  const handleRuntimeEvent = (event: LessonRuntimeEvent) => {
    if (!currentSection || event.pageId !== currentSection.id) return;
    if (event.type === "section-error") {
      console.error("[keya-course-player]", {
        event: "lesson-runtime:error",
        courseId: course.courseId,
        pageId: event.pageId,
        errorCode: event.code,
      });
    }
    setPageStates((current) => {
      const previous = current[event.pageId] ?? { attempts: 0 };
      const next: StoredPageRuntimeState = {
        ...previous,
        htmlRevision: currentSection.htmlRevision,
      };
      if (event.type === "section-ready") next.runtimeStatus = "ready";
      if (event.type === "section-error") next.runtimeStatus = "error";
      if (event.type === "interaction-submitted") {
        next.attempts = Math.max(previous.attempts, event.attempt);
        next.lastResult = event.result;
      }
      return { ...current, [event.pageId]: next };
    });
    if (event.type === "section-completed") {
      setCompletedSectionIds((current) =>
        current.includes(event.pageId) ? current : [...current, event.pageId],
      );
    }
  };

  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={100}>
      <main className="keya-workspace-shell keya-page-reveal flex h-dvh min-w-[320px] flex-col overflow-hidden text-foreground">
        <header className="z-20 grid h-16 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-[#cfe3cb] bg-[#fbfff7]/92 px-3 shadow-[0_10px_28px_-25px_rgba(36,92,58,0.62)] backdrop-blur-md sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              asChild
              className="size-10 shrink-0 rounded-full border-[#c7ddc3] bg-white/85 text-[#365840] shadow-sm transition-[transform,background-color,border-color] hover:border-[#a9d1a6] hover:bg-[#e4f2e0] motion-safe:hover:-translate-x-0.5 sm:size-11"
              size="icon"
              variant="outline"
            >
              <Link aria-label="返回课程库" href="/course">
                <ArrowLeft aria-hidden="true" size={19} strokeWidth={1.8} />
              </Link>
            </Button>
            <div className="hidden min-w-0 min-[520px]:block">
              <h1>
                <OverflowTooltipText
                  className="text-base font-semibold sm:text-lg"
                  side="bottom"
                  text={manifest.title}
                />
              </h1>
              <p className="mt-0.5">
                <OverflowTooltipText
                  className="text-[11px] text-muted-foreground sm:text-xs"
                  side="bottom"
                  text={currentSectionLabel}
                />
              </p>
            </div>
          </div>

          <div
            aria-label="学习模式"
            className="flex rounded-full border border-[#c5ddc1] bg-[#e5f2e1]/85 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]"
            role="group"
          >
            <ModeButton
              active={mode === "guided"}
              icon="guided"
              label="讲解"
              onClick={() => setLearningMode("guided")}
            />
            <ModeButton
              active={mode === "self-paced"}
              icon="self-paced"
              label="自学"
              onClick={() => setLearningMode("self-paced")}
            />
          </div>

          <div className="flex justify-end">
            <Button
              aria-expanded={mapOpen}
              aria-label="打开课程地图"
              className="size-10 rounded-full border-[#c7ddc3] bg-white/85 text-[#365840] shadow-sm hover:border-[#a9d1a6] hover:bg-[#e4f2e0] lg:hidden"
              onClick={() => setMapOpen(true)}
              size="icon"
              type="button"
              variant="outline"
            >
              <List aria-hidden="true" size={19} strokeWidth={1.8} />
            </Button>
          </div>
        </header>

      <div className="flex min-h-0 flex-1">
        {!mapCollapsed ? (
          <CourseMap
            className="hidden w-[280px] shrink-0 border-r border-[#cfe3cb] bg-[#fbfff7]/94 shadow-[12px_0_34px_-32px_rgba(36,92,58,0.58)] backdrop-blur-sm lg:flex"
            closeLabel="收起课程目录"
            completedSectionIds={completedSectionIds}
            currentSectionId={currentSection?.id}
            manifest={manifest}
            onClose={() => setMapCollapsed(true)}
            onSelect={selectSection}
          />
        ) : null}

        {mapOpen ? (
          <>
            <button
              aria-label="关闭课程地图"
              className="fixed inset-0 z-30 bg-[#173622]/25 backdrop-blur-[2px] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 lg:hidden"
              onClick={() => setMapOpen(false)}
              type="button"
            />
            <CourseMap
              className="fixed inset-y-0 left-0 z-40 flex w-[min(340px,88vw)] border-r border-[#c6ddc2] bg-[#fbfff7] pt-2 shadow-[20px_0_54px_-30px_rgba(23,54,34,0.55)] motion-safe:animate-in motion-safe:slide-in-from-left-5 motion-safe:duration-300 lg:hidden"
              completedSectionIds={completedSectionIds}
              currentSectionId={currentSection?.id}
              manifest={manifest}
              onClose={() => setMapOpen(false)}
              onSelect={selectSection}
            />
          </>
        ) : null}

        <section
          className={`relative min-w-0 flex-1 overflow-y-auto bg-transparent px-3 pt-3 sm:px-5 lg:overflow-hidden lg:px-6 ${
            thumbnailsOpen ? "pb-0" : "pb-6"
          }`}
        >
          {mapCollapsed ? (
            <button
              aria-label="展开课程目录"
              className="absolute top-4 left-0 z-20 hidden h-10 w-6 items-center justify-center rounded-r-xl border border-l-0 border-[#c7ddc3] bg-[#fbfff7]/95 text-[#607562] shadow-[0_8px_22px_-14px_rgba(36,92,58,0.58)] outline-none transition-[width,color,background-color] hover:w-7 hover:bg-[#deefda] hover:text-[#245c3a] focus-visible:ring-2 focus-visible:ring-primary lg:flex"
              onClick={() => setMapCollapsed(false)}
              type="button"
            >
              <ChevronRight aria-hidden="true" size={15} strokeWidth={1.8} />
            </button>
          ) : null}

          <div className="mx-auto flex min-h-0 w-full max-w-[1920px] flex-col lg:h-full">
            <div
              className="flex min-h-[220px] flex-1 items-center justify-center"
              ref={canvasSlotRef}
            >
              <div
                aria-label="课程画布"
                className={`relative aspect-video w-full max-w-[1280px] overflow-hidden rounded-[22px] border border-[#8fba92] bg-[#102c1b] shadow-[0_24px_60px_-34px_rgba(23,54,34,0.7),0_0_0_5px_rgba(255,255,255,0.56)] ${
                  fullscreen ? "h-screen w-screen max-w-none rounded-none border-0" : ""
                }`}
                ref={canvasRef}
                style={
                  !fullscreen && canvasSize
                    ? {
                        height: `${canvasSize.height}px`,
                        width: `${canvasSize.width}px`,
                      }
                    : undefined
                }
              >
                {currentSection?.html ? (
                  <HtmlPreviewFrame
                    key={`${currentSection.id}:${currentSection.htmlRevision ?? "current"}`}
                    chrome="learner"
                    className="h-full min-h-0"
                    frameClassName="h-full min-h-0"
                    html={currentSection.html}
                    onRuntimeEvent={handleRuntimeEvent}
                    runtimeConfig={
                      currentSection.runtime && currentSection.interaction
                        ? {
                            pageId: currentSection.id,
                            runtime: currentSection.runtime,
                            interaction: currentSection.interaction,
                          }
                        : undefined
                    }
                    title={`${currentSection.title} · 第 ${currentSection.order} 节`}
                  />
                ) : (
                  <CourseUnavailableState
                    courseId={manifest.courseId}
                    hasReadySection={readySections.length > 0}
                  />
                )}

                {currentSection?.html ? (
                  <>
                    <Button
                      aria-label={fullscreen ? "退出全屏" : "进入全屏"}
                      className="absolute top-3 right-3 z-10 size-9 rounded-full border-white/25 bg-[#173622]/68 p-0 text-white shadow-lg backdrop-blur-md transition-[transform,background-color] hover:bg-[#102719]/90 motion-safe:hover:scale-105 sm:top-4 sm:right-4"
                      onClick={() => void toggleFullscreen()}
                      size="icon"
                      type="button"
                      variant="outline"
                    >
                      {fullscreen ? (
                        <Minimize2
                          aria-hidden="true"
                          size={15}
                          strokeWidth={1.8}
                        />
                      ) : (
                        <Maximize2
                          aria-hidden="true"
                          size={15}
                          strokeWidth={1.8}
                        />
                      )}
                    </Button>

                    {captionsEnabled && mode === "guided" && narration ? (
                      <div
                        aria-live="polite"
                        className="pointer-events-none absolute right-4 bottom-2 left-4 z-10 flex justify-center sm:right-8 sm:left-8"
                      >
                        <p className="line-clamp-1 max-w-[78%] rounded-lg border border-white/20 bg-[#102c1b]/84 px-3 py-1 text-center text-[10px] leading-4 text-white/95 shadow-lg backdrop-blur-md">
                          {narration}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>

            <PlayerControls
              captionsEnabled={captionsEnabled}
              currentRuntimeIncomplete={currentRuntimeIncomplete}
              currentSection={currentSection}
              mode={mode}
              narration={narration}
              narrating={narrating}
              narrationRate={narrationRate}
              nextId={nextId}
              onCaptionsChange={() =>
                setCaptionsEnabled((value) => !value)
              }
              onNarrationRateChange={(rate) => {
                setNarrationRate(rate);
                if (narrating) {
                  window.speechSynthesis.cancel();
                  setNarrating(false);
                }
              }}
              onNext={() => completeAndMove(nextId)}
              onPrevious={() => previousId && selectSection(previousId)}
              onThumbnailToggle={() => setThumbnailsOpen((value) => !value)}
              onToggleNarration={toggleNarration}
              previousId={previousId}
              sectionCount={manifest.sections.length}
              thumbnailsOpen={thumbnailsOpen}
            />

            {thumbnailsOpen ? (
              <ThumbnailNavigation
                currentSectionId={currentSection?.id}
                manifest={manifest}
                onSelect={selectSection}
                railRef={thumbnailRailRef}
              />
            ) : null}
          </div>
        </section>
      </div>
      </main>
    </TooltipPrimitive.Provider>
  );
}

function PlayerControls({
  captionsEnabled,
  currentRuntimeIncomplete,
  currentSection,
  mode,
  narration,
  narrating,
  narrationRate,
  nextId,
  onCaptionsChange,
  onNarrationRateChange,
  onNext,
  onPrevious,
  onThumbnailToggle,
  onToggleNarration,
  previousId,
  sectionCount,
  thumbnailsOpen,
}: {
  captionsEnabled: boolean;
  currentRuntimeIncomplete: boolean;
  currentSection?: CoursePlayerSection;
  mode: LearningMode;
  narration: string;
  narrating: boolean;
  narrationRate: number;
  nextId?: string;
  onCaptionsChange(): void;
  onNarrationRateChange(rate: number): void;
  onNext(): void;
  onPrevious(): void;
  onThumbnailToggle(): void;
  onToggleNarration(): void;
  previousId?: string;
  sectionCount: number;
  thumbnailsOpen: boolean;
}) {
  return (
    <div
      aria-label="页面播放控制"
      className="mt-3.5 grid shrink-0 items-center gap-3 lg:grid-cols-[1fr_auto_1fr]"
      role="group"
    >
      <span className="hidden lg:block" />

      <div className="flex h-[50px] items-center justify-center rounded-full border border-[#c4dcc0] bg-[#fbfff7]/92 px-1.5 shadow-[0_12px_30px_-22px_rgba(36,92,58,0.72)] backdrop-blur-sm">
        <Button
          className="h-10 min-w-[84px] rounded-full border-0 bg-transparent px-3 text-xs shadow-none hover:bg-[var(--keya-pill)] sm:text-sm"
          disabled={!previousId}
          onClick={onPrevious}
          type="button"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.8} />
          上一页
        </Button>

        {mode === "guided" ? (
          <Button
            aria-label={narrating ? "暂停讲解" : "播放讲解"}
            className="size-11 shrink-0 rounded-full border-0 bg-[#397a52] text-white shadow-[0_8px_20px_-12px_rgba(36,92,58,0.9)] transition-[transform,background-color,box-shadow] hover:bg-[#245c3a] hover:shadow-[0_12px_24px_-12px_rgba(36,92,58,0.95)] motion-safe:hover:scale-105"
            disabled={!narration}
            onClick={onToggleNarration}
            size="icon"
            type="button"
          >
            {narrating ? (
              <Pause aria-hidden="true" size={18} fill="currentColor" />
            ) : (
              <Play aria-hidden="true" size={18} fill="currentColor" />
            )}
          </Button>
        ) : (
          <span
            aria-label="自学模式"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#c9e0c5] bg-[#e3f1df] text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
            role="img"
          >
            <BookOpen aria-hidden="true" size={18} strokeWidth={1.8} />
          </span>
        )}

        <Button
          className="h-10 min-w-[84px] rounded-full border-0 bg-transparent px-3 text-xs shadow-none hover:bg-[var(--keya-pill)] sm:text-sm"
          disabled={!currentSection || currentRuntimeIncomplete}
          onClick={onNext}
          type="button"
          variant="ghost"
        >
          {currentRuntimeIncomplete
            ? "先完成互动"
            : nextId
              ? "下一页"
              : "完成本页"}
          {nextId ? (
            <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
          ) : (
            <Check aria-hidden="true" size={16} strokeWidth={2} />
          )}
        </Button>
      </div>

      <div
        aria-label="显示设置"
        className="flex items-center justify-center gap-2 lg:justify-end"
        role="group"
      >
        <div aria-label="字幕控制" role="group">
          <Button
            aria-label={captionsEnabled ? "关闭字幕" : "开启字幕"}
            aria-pressed={captionsEnabled}
            className={`h-9 rounded-full border-border px-3 text-xs shadow-none ${
              captionsEnabled && mode === "guided"
                ? "border-[#a8cfa5] bg-[#e4f2e0] text-[#245c3a]"
                : "bg-transparent text-muted-foreground"
            }`}
            disabled={mode !== "guided"}
            onClick={onCaptionsChange}
            type="button"
            variant="outline"
          >
            <Captions aria-hidden="true" size={15} strokeWidth={1.8} />
            字幕
          </Button>
        </div>

        <label className="sr-only" htmlFor="narration-rate">
          播放速度
        </label>
        <select
          aria-label="播放速度"
          className="h-9 rounded-full border border-[#c4dcc0] bg-[#fbfff7] px-3 text-xs text-[#365840] shadow-sm outline-none transition-colors hover:bg-white focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={mode !== "guided"}
          id="narration-rate"
          onChange={(event) =>
            onNarrationRateChange(Number(event.target.value))
          }
          value={narrationRate}
        >
          <option value={0.8}>0.8×</option>
          <option value={1}>1.0×</option>
          <option value={1.25}>1.25×</option>
          <option value={1.5}>1.5×</option>
        </select>

        <ThumbnailToggle
          currentOrder={currentSection?.order}
          onClick={onThumbnailToggle}
          open={thumbnailsOpen}
          sectionCount={sectionCount}
        />
      </div>
    </div>
  );
}

function ThumbnailToggle({
  currentOrder,
  onClick,
  open,
  sectionCount,
}: {
  currentOrder?: number;
  onClick(): void;
  open: boolean;
  sectionCount: number;
}) {
  const label = open ? "收起缩略图" : "展开缩略图";
  return (
    <span className="group relative">
      <button
        aria-expanded={open}
        aria-label={label}
        className="flex h-10 items-center gap-2 rounded-full bg-[#2f6845] px-3.5 text-xs font-medium text-white shadow-[0_8px_20px_-13px_rgba(36,92,58,0.92)] outline-none transition-[transform,background-color,box-shadow] hover:bg-[#245c3a] hover:shadow-[0_11px_24px_-13px_rgba(36,92,58,0.98)] focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:hover:-translate-y-0.5"
        onClick={onClick}
        type="button"
      >
        <Monitor aria-hidden="true" size={15} strokeWidth={1.8} />
        <span className="tabular-nums">
          {padPageNumber(currentOrder)} / {padPageNumber(sectionCount)}
        </span>
        {open ? (
          <ChevronUp aria-hidden="true" size={13} strokeWidth={2} />
        ) : (
          <ChevronDown aria-hidden="true" size={13} strokeWidth={2} />
        )}
      </button>
      <span
        className="pointer-events-none absolute right-0 bottom-full z-20 mb-2 whitespace-nowrap rounded-md bg-[#245c3a] px-2 py-1 text-[10px] text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        role="tooltip"
      >
        {label}
      </span>
    </span>
  );
}

function ThumbnailNavigation({
  currentSectionId,
  manifest,
  onSelect,
  railRef,
}: {
  currentSectionId?: string;
  manifest: CoursePlayerManifest;
  onSelect(sectionId: string): void;
  railRef: RefObject<HTMLOListElement | null>;
}) {
  const scroll = (direction: -1 | 1) => {
    railRef.current?.scrollBy({
      behavior: "smooth",
      left: direction * 360,
    });
  };

  return (
    <nav
      aria-label="页面缩略图"
      className="mt-3 flex h-[60px] shrink-0 items-center gap-3 rounded-t-[20px] border-x border-t border-[#cfe3cb] bg-[#e8f4e4]/92 px-3 shadow-[0_-10px_28px_-26px_rgba(36,92,58,0.56)] backdrop-blur-sm"
    >
      <Button
        aria-label="向前浏览缩略图"
        className="size-8 shrink-0 rounded-full border-border bg-card shadow-none hover:bg-[var(--keya-pill)]"
        onClick={() => scroll(-1)}
        size="icon"
        type="button"
        variant="outline"
      >
        <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.8} />
      </Button>

      <ol
        className="scrollbar-hide flex min-w-0 flex-1 snap-x items-center gap-2.5 overflow-x-auto"
        ref={railRef}
      >
        {manifest.sections.map((section, index) => {
          const current = section.id === currentSectionId;
          const ready = section.generationStatus === "ready";
          const alignment = [
            index === 0 ? "ml-auto" : "",
            index === manifest.sections.length - 1 ? "mr-auto" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li
              className={`shrink-0 snap-start ${alignment}`}
              key={section.id}
            >
              <button
                aria-current={current ? "page" : undefined}
                aria-label={`跳转到第 ${section.order} 页：${section.title}`}
                className={`relative block h-[38px] w-[62px] overflow-hidden rounded-md border-2 bg-white outline-none transition-[border-color,box-shadow] focus-visible:ring-2 focus-visible:ring-primary ${
                  current
                    ? "border-[#5aa56a] shadow-[0_0_0_2px_rgba(255,255,255,0.94),0_0_0_4px_rgba(90,165,106,0.2)]"
                    : ready
                      ? "border-transparent hover:border-[#a9d1a6]"
                      : "border-transparent bg-[var(--keya-pill)] opacity-60"
                }`}
                disabled={!ready}
                onClick={() => onSelect(section.id)}
                type="button"
              >
                {section.html ? (
                  <HtmlThumbnailFrame
                    html={section.html}
                    title={`${section.title} · 缩略图`}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 bg-[radial-gradient(circle_at_28%_24%,rgba(116,198,122,0.3),transparent_34%),linear-gradient(135deg,#e9f5e5,#fff7d9)]"
                  />
                )}
                <span className="pointer-events-none absolute top-0.5 left-0.5 z-10 min-w-[18px] rounded-[4px] bg-[#245c3a]/78 px-1 py-0.5 text-[9px] leading-[11px] font-semibold text-white tabular-nums">
                  {padPageNumber(section.order)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <Button
        aria-label="向后浏览缩略图"
        className="size-8 shrink-0 rounded-full border-border bg-card shadow-none hover:bg-[var(--keya-pill)]"
        onClick={() => scroll(1)}
        size="icon"
        type="button"
        variant="outline"
      >
        <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
      </Button>
    </nav>
  );
}

function CourseMap({
  className,
  closeLabel,
  completedSectionIds,
  currentSectionId,
  manifest,
  onClose,
  onSelect,
}: {
  className: string;
  closeLabel?: string;
  completedSectionIds: string[];
  currentSectionId?: string;
  manifest: CoursePlayerManifest;
  onClose?(): void;
  onSelect(sectionId: string): void;
}) {
  return (
    <aside
      aria-label="课程地图"
      className={`${className} min-h-0 flex-col overflow-hidden`}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-5">
        <div>
          <p className="text-xs font-semibold tracking-[0.08em] text-primary">
            课程地图
          </p>
          <h2 className="mt-1 text-base font-semibold">学习路径</h2>
        </div>
        {onClose ? (
          <Button
            aria-label={closeLabel ?? "关闭课程地图"}
            className="size-9 rounded-xl"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            {closeLabel ? (
              <ChevronLeft aria-hidden="true" size={18} strokeWidth={1.8} />
            ) : (
              <X aria-hidden="true" size={18} strokeWidth={1.8} />
            )}
          </Button>
        ) : null}
      </div>
      <nav className="scrollbar-hide min-h-0 flex-1 overflow-y-auto px-3 pb-5">
        <ol className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1.5">
          {manifest.sections.map((section) => {
            return (
              <CourseMapSection
                completed={completedSectionIds.includes(section.id)}
                current={section.id === currentSectionId}
                key={section.id}
                onSelect={onSelect}
                section={section}
              />
            );
          })}
        </ol>
      </nav>
    </aside>
  );
}

function CourseMapSection({
  completed,
  current,
  onSelect,
  section,
}: {
  completed: boolean;
  current: boolean;
  onSelect(sectionId: string): void;
  section: CoursePlayerSection;
}) {
  const ready = section.generationStatus === "ready";
  const title = `${section.order}. ${section.title}`;
  const { overflowing, textRef } = useTextOverflow(title);

  return (
    <li className="min-w-0">
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button
            aria-current={current ? "step" : undefined}
            aria-disabled={!ready}
            className={`flex min-h-[60px] min-w-0 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left outline-none transition-[transform,background-color,color] focus-visible:ring-2 focus-visible:ring-primary aria-disabled:cursor-not-allowed ${
              current
                ? "bg-[#e0f0dc] text-[#245c3a] shadow-[inset_0_0_0_1px_rgba(57,122,82,0.08)]"
                : ready
                  ? "hover:bg-[#edf7e9] motion-safe:hover:translate-x-0.5"
                  : "opacity-70"
            }`}
            onClick={() => ready && onSelect(section.id)}
            type="button"
          >
            <MapStatusIcon
              completed={completed}
              current={current}
              section={section}
            />
            <span className="min-w-0 flex-1">
              <span
                className="block max-w-full truncate text-sm font-medium tracking-[-0.01em]"
                data-slot="overflow-tooltip-text"
                ref={textRef}
              >
                {title}
              </span>
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {completed
                  ? "已完成"
                  : current
                    ? "正在学习"
                    : generationCopy[section.generationStatus]}
              </span>
            </span>
          </button>
        </TooltipPrimitive.Trigger>
        {overflowing ? (
          <OverflowTooltipContent side="right" text={title} />
        ) : null}
      </TooltipPrimitive.Root>
    </li>
  );
}

function OverflowTooltipText({
  className,
  side,
  text,
}: {
  className?: string;
  side: "bottom" | "right";
  text: string;
}) {
  const { overflowing, textRef } = useTextOverflow(text);

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <span className="block min-w-0">
          <span
            className={`block max-w-full truncate ${className ?? ""}`}
            data-slot="overflow-tooltip-text"
            ref={textRef}
          >
            {text}
          </span>
        </span>
      </TooltipPrimitive.Trigger>
      {overflowing ? (
        <OverflowTooltipContent side={side} text={text} />
      ) : null}
    </TooltipPrimitive.Root>
  );
}

function OverflowTooltipContent({
  side,
  text,
}: {
  side: "bottom" | "right";
  text: string;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        align={side === "bottom" ? "start" : "center"}
        className="z-[70] max-w-[min(320px,calc(100vw-24px))] rounded-lg border border-white/10 bg-[#245c3a] px-3 py-2 text-xs leading-5 font-medium text-balance text-white shadow-[0_10px_30px_-12px_rgba(23,54,34,0.7)] [overflow-wrap:anywhere]"
        collisionPadding={12}
        side={side}
        sideOffset={8}
      >
        {text}
        <TooltipPrimitive.Arrow className="fill-[#245c3a]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

function useTextOverflow(text: string) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = textRef.current;
    if (!element) return;

    let active = true;
    const update = () => {
      if (active) setOverflowing(isTextOverflowing(element));
    };
    update();

    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    observer?.observe(element);
    void document.fonts?.ready.then(update);
    window.addEventListener("resize", update);

    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [text]);

  return { overflowing, textRef };
}

export function isTextOverflowing(
  element: Pick<HTMLElement, "clientWidth" | "scrollWidth">,
) {
  return element.scrollWidth > element.clientWidth;
}

function MapStatusIcon({
  completed,
  current,
  section,
}: {
  completed: boolean;
  current: boolean;
  section: CoursePlayerSection;
}) {
  if (completed) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
        <Check aria-hidden="true" size={14} strokeWidth={2.2} />
      </span>
    );
  }
  if (current) {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-[5px] border-[#cde4c9] bg-primary shadow-[0_0_0_3px_rgba(57,122,82,0.08)] motion-safe:animate-pulse" />
    );
  }
  if (section.generationStatus === "generating") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-primary">
        <LoaderCircle
          aria-hidden="true"
          className="motion-safe:animate-spin"
          size={14}
          strokeWidth={1.8}
        />
      </span>
    );
  }
  if (section.generationStatus === "failed") {
    return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[#d99779] text-[#a85e3c]">
        <CircleAlert aria-hidden="true" size={14} strokeWidth={1.8} />
      </span>
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[#a9a196] text-muted-foreground">
      <Circle aria-hidden="true" size={10} strokeWidth={1.8} />
    </span>
  );
}

function ModeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LearningMode;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`flex min-w-[58px] items-center justify-center gap-1.5 rounded-full px-2.5 py-2 text-xs font-semibold transition-colors sm:min-w-[104px] sm:px-5 sm:py-2.5 sm:text-sm ${
        active
          ? "bg-primary text-white shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon === "guided" ? (
        <Volume2 aria-hidden="true" size={14} strokeWidth={1.8} />
      ) : (
        <BookOpen aria-hidden="true" size={14} strokeWidth={1.8} />
      )}
      {label}
    </button>
  );
}

function CourseUnavailableState({
  courseId,
  hasReadySection,
}: {
  courseId: string;
  hasReadySection: boolean;
}) {
  return (
    <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-[24px] border border-[#c8dfc4] bg-[#fbfff7]/94 px-6 text-center shadow-[0_22px_54px_-40px_rgba(36,92,58,0.68)]">
      <div className="max-w-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-[var(--keya-pill)] text-primary">
          <Volume2 aria-hidden="true" size={21} strokeWidth={1.8} />
        </span>
        <h2 className="mt-4 text-lg font-semibold">
          {hasReadySection ? "请选择可学习的课程节" : "课程内容还在准备中"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          已完成的课程节会立即开放，尚未完成的内容不会影响已经可以学习的部分。
        </p>
        <Button asChild className="mt-5 rounded-xl">
          <Link href={`/chat?course=${encodeURIComponent(courseId)}`}>
            返回课程创建
          </Link>
        </Button>
      </div>
    </div>
  );
}

function parseStoredSession(value: string | null): StoredLearningSession | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<StoredLearningSession>;
    const mode =
      parsed.mode === "guided" || parsed.mode === "self-paced"
        ? parsed.mode
        : "guided";
    const narrationRate = [0.8, 1, 1.25, 1.5].includes(
      Number(parsed.narrationRate),
    )
      ? Number(parsed.narrationRate)
      : 1;
    return {
      currentSectionId:
        typeof parsed.currentSectionId === "string"
          ? parsed.currentSectionId
          : undefined,
      completedSectionIds: Array.isArray(parsed.completedSectionIds)
        ? parsed.completedSectionIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
      mode,
      captionsEnabled: parsed.captionsEnabled !== false,
      narrationRate,
      pageStates: parseStoredPageStates(parsed.pageStates),
    };
  } catch {
    return undefined;
  }
}

function parseStoredPageStates(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([pageId, state]) => {
      if (!state || typeof state !== "object" || Array.isArray(state)) {
        return [];
      }
      const candidate = state as Partial<StoredPageRuntimeState>;
      return [
        [
          pageId,
          {
            ...(typeof candidate.htmlRevision === "number"
              ? { htmlRevision: candidate.htmlRevision }
              : {}),
            ...(candidate.runtimeStatus === "ready" ||
            candidate.runtimeStatus === "error"
              ? { runtimeStatus: candidate.runtimeStatus }
              : {}),
            attempts:
              typeof candidate.attempts === "number" &&
              Number.isFinite(candidate.attempts)
                ? Math.max(0, Math.floor(candidate.attempts))
                : 0,
            ...(candidate.lastResult === "correct" ||
            candidate.lastResult === "incorrect" ||
            candidate.lastResult === "partial"
              ? { lastResult: candidate.lastResult }
              : {}),
          } satisfies StoredPageRuntimeState,
        ],
      ];
    }),
  );
}

function padPageNumber(value?: number) {
  return String(value ?? 0).padStart(2, "0");
}

const generationCopy: Record<
  CoursePlayerSection["generationStatus"],
  string
> = {
  ready: "可以学习",
  generating: "生成中",
  failed: "暂时不可用",
  pending: "稍后开放",
};
