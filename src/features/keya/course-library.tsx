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
} from "@/features/course-planner/lib/course-library-api";
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
    <main className="min-h-[calc(100vh-64px)] bg-[#fff9ee] pb-16 text-[#2d332b]">
      <div className="mx-auto w-[calc(100%-32px)] max-w-[1200px] pt-8 sm:w-[calc(100%-48px)]">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#e8e1d7] pb-6">
          <div>
            <p className="text-xs font-semibold tracking-[0.08em] text-[#4f8f65]">
              COURSE HISTORY
            </p>
            <h1 className="mt-1 text-2xl font-semibold">我的课程</h1>
            <p className="mt-2 text-sm text-[#7a7468]">
              查看持久化课程、运行记录、页面预览与可交付导出。
            </p>
          </div>
          <Button asChild className="rounded-full bg-[#397a52] px-4 text-white hover:bg-[#2f6845]">
            <Link href="/chat">
              <Plus aria-hidden="true" /> 新建课程
            </Link>
          </Button>
        </header>

        <section aria-label="筛选课程历史" className="mt-6 flex flex-wrap gap-3">
          <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-full bg-[#f3ede4] px-4 text-[#7a7468] focus-within:ring-2 focus-within:ring-[#397a52]">
            <Search aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only">搜索课程</span>
            <Input
              className="h-auto border-0 bg-transparent p-0 text-[#2d332b] focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、提示词或课程 ID"
              type="search"
              value={query}
            />
          </label>
          <NativeSelect className="w-36" value={status ?? ""} onChange={(event) => setStatus((event.target.value || undefined) as CourseHistoryFilters["status"])}>
            <NativeSelectOption value="">全部状态</NativeSelectOption>
            <NativeSelectOption value="completed">已完成</NativeSelectOption>
            <NativeSelectOption value="running">生成中</NativeSelectOption>
            <NativeSelectOption value="failed">生成失败</NativeSelectOption>
            <NativeSelectOption value="cancelled">已取消</NativeSelectOption>
          </NativeSelect>
        </section>

        {result?.unavailableCount ? (
          <Alert className="mt-5 rounded-2xl border-[#edc4b9] bg-[#fff0eb] px-4 py-3 text-[#984735]">
            <TriangleAlert aria-hidden="true" />
            有 {result.unavailableCount} 条本地记录无法通过 Schema 校验，已安全跳过。
          </Alert>
        ) : null}

        {error ? (
          <section className="mt-20 text-center" role="alert">
            <TriangleAlert aria-hidden="true" className="mx-auto size-8 text-[#b65e49]" />
            <h2 className="mt-3 font-semibold">课程历史加载失败</h2>
            <p className="mt-2 text-sm text-[#7a7468]">{error}</p>
            <Button className="mt-4 rounded-full" onClick={() => setReloadKey((value) => value + 1)} variant="outline">
              <RefreshCw aria-hidden="true" /> 重试
            </Button>
          </section>
        ) : !result ? (
          <div aria-live="polite" className="mt-20 flex items-center justify-center gap-2 text-sm text-[#7a7468]">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> 正在读取课程历史…
          </div>
        ) : result.items.length === 0 ? (
          <section className="mt-20 text-center">
            <BookOpen aria-hidden="true" className="mx-auto size-9 text-[#4f8f65]" />
            <h2 className="mt-3 font-semibold">没有找到课程</h2>
            <p className="mt-2 text-sm text-[#7a7468]">
              {query || status ? "调整筛选条件后再试试。" : "完成一次课程生成后，记录会出现在这里。"}
            </p>
          </section>
        ) : (
          <section aria-label="课程记录" className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.items.map((course) => <CourseHistoryCard course={course} key={course.courseId} />)}
          </section>
        )}
      </div>
    </main>
  );
}

function CourseHistoryCard({ course }: { course: CourseHistoryItem }) {
  return (
    <Link
      className="group overflow-hidden rounded-[24px] border border-[#e8dfd0] bg-[#fffcf5] shadow-[0_12px_34px_-30px_rgba(45,51,43,0.5)] outline-none transition hover:-translate-y-0.5 hover:border-[#cfe2d1] focus-visible:ring-2 focus-visible:ring-[#397a52]"
      href={`/course/${course.courseId}`}
    >
      <div className="relative aspect-video overflow-hidden bg-[#f3eee4]">
        <CourseCoverFrame
          courseId={course.courseId}
          cover={course.cover}
          title={course.title}
        />
      </div>
      <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <Badge className={`border-0 ${course.status === "completed" ? "bg-[#edf5ee] text-[#2f6845]" : course.status === "running" ? "bg-[#f4f1df] text-[#87752c]" : "bg-[#fff0eb] text-[#a44f3d]"}`}>
          {statusCopy[course.status]}
        </Badge>
        {course.exportable ? <FileArchive aria-label="可导出" className="size-4 text-[#4f8f65]" /> : null}
      </div>
      <h2 className="mt-4 line-clamp-2 text-lg font-semibold group-hover:text-[#2f6845]">{course.title}</h2>
      <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#7a7468]">{course.prompt}</p>
      <dl className="mt-5 grid grid-cols-2 gap-3 text-xs text-[#7a7468]">
        <div><dt className="text-[#a09688]">页面</dt><dd className="mt-1 font-medium text-[#3f4a40]">{course.completedPages}/{course.totalPages}</dd></div>
        <div><dt className="text-[#a09688]">运行</dt><dd className="mt-1 font-medium text-[#3f4a40]">{course.runCount} 次</dd></div>
      </dl>
      <p className="mt-5 flex items-center gap-1.5 border-t border-[#f1e7d5] pt-4 text-xs text-[#7a7468]">
        <Clock3 aria-hidden="true" className="size-3.5" /> {formatDate(course.updatedAt)}
      </p>
      </div>
    </Link>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
