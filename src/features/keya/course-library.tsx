"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  BookOpen,
  Clock3,
  FileArchive,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CourseCoverFrame } from "@/features/keya/course-cover-frame";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  listCourseHistory,
  type CourseHistoryFilters,
} from "@/features/keya/api/course-library";
import type {
  CourseHistoryItem,
  CourseHistoryListResponse,
} from "@/shared/course-schema";

const statusCopy = {
  running: "生成中",
  completed: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
} as const;

export function CourseLibrary() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CourseHistoryFilters["status"]>();
  const [result, setResult] = useState<CourseHistoryListResponse>();
  const [error, setError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setError(undefined);
      void listCourseHistory({ query, status }, controller.signal)
        .then(setResult)
        .catch((loadError) => {
          if (loadError instanceof DOMException && loadError.name === "AbortError") {
            return;
          }
          setError(
            loadError instanceof Error ? loadError.message : "课程历史加载失败。",
          );
        });
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, reloadKey, status]);

  return (
    <main className="keya-product-shell keya-page-reveal min-h-[calc(100vh-64px)] overflow-hidden pb-16 text-[#253d2d]">
      <div className="mx-auto w-[calc(100%-32px)] max-w-[1200px] pt-8 sm:w-[calc(100%-48px)]">
        <header className="flex flex-wrap items-end justify-between gap-4 rounded-[28px] border border-[#d7ead2] bg-white/75 px-5 py-6 shadow-[0_22px_55px_-42px_rgba(47,104,69,0.62)] backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 sm:px-7">
          <div>
            <p className="text-xs font-semibold tracking-[0.12em] text-[#397a52]">
              COURSE HISTORY
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-[#245c3a]">
              我的课程
            </h1>
            <p className="mt-2 text-sm text-[#687a69]">
              查看持久化课程、运行记录、页面预览与可交付导出。
            </p>
          </div>
          <Button
            asChild
            className="h-10 rounded-full bg-[#397a52] px-5 text-white shadow-[0_10px_22px_-12px_rgba(47,104,69,0.8)] transition-[transform,background-color,box-shadow] duration-200 hover:bg-[#2f6845] hover:shadow-[0_14px_26px_-12px_rgba(47,104,69,0.88)] motion-safe:hover:-translate-y-0.5 [&_svg]:transition-transform motion-safe:hover:[&_svg]:rotate-12"
          >
            <Link href="/chat">
              <Plus aria-hidden="true" /> 新建课程
            </Link>
          </Button>
        </header>

        <section
          aria-label="筛选课程历史"
          className="mt-6 flex flex-wrap gap-3 rounded-[24px] border border-[#deedd9] bg-[#fbfff8]/80 p-3 shadow-[0_14px_38px_-34px_rgba(47,104,69,0.72)] backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500"
        >
          <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-full border border-[#d5e8d0] bg-white/90 px-4 text-[#66806d] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-[border-color,box-shadow,background-color] focus-within:border-[#8fc694] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#397a52]/20">
            <Search aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only">搜索课程</span>
            <Input
              className="h-auto border-0 bg-transparent p-0 text-[#253d2d] placeholder:text-[#8a998b] focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、提示词或课程 ID"
              type="search"
              value={query}
            />
          </label>
          <NativeSelect
            className="w-36 rounded-full border border-[#d5e8d0] bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] [&_[data-slot=native-select]]:h-10 [&_[data-slot=native-select]]:rounded-full [&_[data-slot=native-select]]:border-0 [&_[data-slot=native-select]]:text-[#36533e]"
            value={status ?? ""}
            onChange={(event) => setStatus((event.target.value || undefined) as CourseHistoryFilters["status"])}
          >
            <NativeSelectOption value="">全部状态</NativeSelectOption>
            <NativeSelectOption value="completed">已完成</NativeSelectOption>
            <NativeSelectOption value="running">生成中</NativeSelectOption>
            <NativeSelectOption value="failed">生成失败</NativeSelectOption>
            <NativeSelectOption value="cancelled">已取消</NativeSelectOption>
          </NativeSelect>
        </section>

        {result?.unavailableCount ? (
          <Alert className="mt-5 rounded-[22px] border-[#edc4b9] bg-[#fff5ef]/95 px-5 py-4 text-[#984735] shadow-[0_14px_34px_-30px_rgba(152,71,53,0.55)]">
            <TriangleAlert aria-hidden="true" />
            有 {result.unavailableCount} 条本地记录无法通过 Schema 校验，已安全跳过。
          </Alert>
        ) : null}

        {error ? (
          <section
            className="mx-auto mt-16 max-w-xl rounded-[30px] border border-[#e5d8ca] bg-white/80 px-6 py-10 text-center shadow-[0_24px_60px_-46px_rgba(45,51,43,0.65)] backdrop-blur-sm"
            role="alert"
          >
            <TriangleAlert aria-hidden="true" className="mx-auto size-11 rounded-2xl bg-[#fff0eb] p-2.5 text-[#b65e49]" />
            <h2 className="mt-4 font-semibold text-[#3c493e]">课程历史加载失败</h2>
            <p className="mt-2 text-sm text-[#748075]">{error}</p>
            <Button
              className="mt-5 rounded-full border-[#cfe3ca] bg-[#fbfff8] text-[#2f6845] hover:bg-[#e9f5e6]"
              onClick={() => setReloadKey((value) => value + 1)}
              variant="outline"
            >
              <RefreshCw aria-hidden="true" /> 重试
            </Button>
          </section>
        ) : !result ? (
          <div
            aria-live="polite"
            className="mx-auto mt-16 flex w-fit items-center justify-center gap-2 rounded-full border border-[#d7ead2] bg-white/75 px-5 py-3 text-sm text-[#5f7865] shadow-[0_14px_34px_-28px_rgba(47,104,69,0.62)] backdrop-blur-sm"
          >
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" /> 正在读取课程历史…
          </div>
        ) : result.items.length === 0 ? (
          <section className="mx-auto mt-16 max-w-xl rounded-[30px] border border-[#d7ead2] bg-white/78 px-6 py-12 text-center shadow-[0_24px_60px_-46px_rgba(47,104,69,0.66)] backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500">
            <BookOpen aria-hidden="true" className="mx-auto size-12 rounded-[18px] bg-[#e7f4e3] p-3 text-[#397a52] shadow-[0_10px_22px_-16px_rgba(47,104,69,0.7)]" />
            <h2 className="mt-4 font-semibold text-[#2f5e3e]">没有找到课程</h2>
            <p className="mt-2 text-sm text-[#6d7d6f]">
              {query || status ? "调整筛选条件后再试试。" : "完成一次课程生成后，记录会出现在这里。"}
            </p>
          </section>
        ) : (
          <section
            aria-label="课程记录"
            className="mt-7 grid gap-5 md:grid-cols-2 xl:grid-cols-3"
          >
            {result.items.map((course) => (
              <CourseHistoryCard course={course} key={course.courseId} />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}

function CourseHistoryCard({ course }: { course: CourseHistoryItem }) {
  return (
    <Link
      className="keya-card-lift group overflow-hidden rounded-[26px] border border-[#d9e9d4] bg-[#fffef8]/95 shadow-[0_18px_44px_-34px_rgba(47,104,69,0.58)] outline-none hover:border-[#a9d1a6] focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2 focus-visible:ring-offset-[#eff8eb] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3"
      href={`/course/${course.courseId}`}
    >
      <div className="relative aspect-video overflow-hidden bg-[#e9f4e5]">
        <CourseCoverFrame
          className="transition-transform duration-500 motion-safe:group-hover:scale-[1.025] motion-reduce:transition-none"
          courseId={course.courseId}
          cover={course.cover}
          title={course.title}
        />
      </div>
      <div className="bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,253,244,0.94))] p-5">
        <div className="flex items-start justify-between gap-3">
          <Badge
            className={`border-0 px-2.5 ${
              course.status === "completed"
                ? "bg-[#e5f3e4] text-[#2f6845]"
                : course.status === "running"
                  ? "bg-[#fff5cf] text-[#80691e]"
                  : "bg-[#fff0eb] text-[#a44f3d]"
            }`}
          >
            {statusCopy[course.status]}
          </Badge>
          {course.exportable ? (
            <FileArchive
              aria-label="可导出"
              className="size-4 text-[#4b8b5f] transition-transform motion-safe:group-hover:-rotate-6"
            />
          ) : null}
        </div>
        <h2 className="mt-4 line-clamp-2 text-lg font-semibold text-[#2b4432] transition-colors group-hover:text-[#2f6845]">
          {course.title}
        </h2>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#607562]">
          {course.prompt}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-xs text-[#607562]">
          <div>
            <dt className="text-[#6b7f6e]">页面</dt>
            <dd className="mt-1 font-medium text-[#35543e]">
              {course.completedPages}/{course.totalPages}
            </dd>
          </div>
          <div>
            <dt className="text-[#6b7f6e]">运行</dt>
            <dd className="mt-1 font-medium text-[#35543e]">
              {course.runCount} 次
            </dd>
          </div>
        </dl>
        <p className="mt-5 flex items-center gap-1.5 border-t border-[#e7efe3] pt-4 text-xs text-[#607562]">
          <Clock3 aria-hidden="true" className="size-3.5" />{" "}
          {formatDate(course.updatedAt)}
        </p>
      </div>
    </Link>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
