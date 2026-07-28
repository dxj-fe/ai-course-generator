"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BookOpen as BookOpenIcon,
  CheckCircle2 as CheckCircleIcon,
  Clock as ClockIcon,
  FileArchive as ArchiveIcon,
  LoaderCircle as RunningIcon,
  Search as SearchIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CourseCoverFrame } from "@/features/keya/course-cover-frame";
import type { CourseHistoryItem } from "@/shared/course-schema";

type FilterMode = "all" | "completed" | "running" | "exportable";

const filterOptions: Array<{
  id: FilterMode;
  label: string;
  Icon: typeof BookOpenIcon;
}> = [
  { id: "all", label: "全部课程", Icon: BookOpenIcon },
  { id: "completed", label: "已完成", Icon: CheckCircleIcon },
  { id: "running", label: "生成中", Icon: RunningIcon },
  { id: "exportable", label: "可导出", Icon: ArchiveIcon },
];

const statusLabel: Record<CourseHistoryItem["status"], string> = {
  running: "生成中",
  completed: "已完成",
  failed: "生成失败",
  cancelled: "已取消",
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2 focus-visible:ring-offset-[#fff9ee]";

export function WorkGallery({ works }: { works: CourseHistoryItem[] }) {
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [query, setQuery] = useState("");

  const visibleWorks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return works
      .filter((work) => {
        if (filterMode === "exportable" && !work.exportable) return false;
        if (
          filterMode !== "all" &&
          filterMode !== "exportable" &&
          work.status !== filterMode
        ) {
          return false;
        }
        return (
          !normalizedQuery ||
          `${work.title}\n${work.prompt}\n${work.courseId}`
            .toLocaleLowerCase("zh-CN")
            .includes(normalizedQuery)
        );
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [filterMode, query, works]);

  return (
    <section className="bg-[#fff9ee] pb-[215px] pt-16" id="work-gallery">
      <div className="mx-auto w-[calc(100%-48px)] max-w-[1200px]">
        <h2 className="text-2xl font-semibold leading-8 text-[#397a52]">
          我的真实课程
        </h2>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <ToggleGroup
            className="grid w-[234.25px] grid-cols-2 gap-2 sm:w-[476.5px] sm:grid-cols-4"
            onValueChange={(value) => {
              if (value) setFilterMode(value as FilterMode);
            }}
            type="single"
            value={filterMode}
          >
            {filterOptions.map(({ id, label, Icon }) => (
              <ToggleGroupItem
                aria-label={label}
                className={`flex h-10 w-[113.125px] items-center justify-center gap-2 rounded-full px-4 text-sm leading-[14px] transition-colors duration-150 ${focusRing} ${
                  filterMode === id
                    ? "bg-[#fce6b6] font-bold text-[#7a5410] data-[state=on]:bg-[#fce6b6] data-[state=on]:text-[#7a5410]"
                    : "bg-[#f6eedc] font-medium text-[#6f6a60] hover:bg-[#f4e8cd]"
                }`}
                key={id}
                value={id}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <label className="flex h-10 w-[282px] items-center gap-2 rounded-full border border-[#e8dfd0] bg-[#fffcf5] px-4 text-[#7a7468] transition-shadow focus-within:ring-2 focus-within:ring-[#397a52] focus-within:ring-offset-2 focus-within:ring-offset-[#fff9ee]">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only">搜索课程</span>
            <Input
              className="h-auto w-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-sm leading-[21px] text-[#2d332b] outline-none placeholder:text-[#7a7468] focus-visible:border-0 focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索课程"
              type="search"
              value={query}
            />
          </label>
        </div>

        {visibleWorks.length > 0 ? (
          <div className="mt-[25px] grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleWorks.map((work) => (
              <CourseWorkCard key={work.courseId} work={work} />
            ))}
          </div>
        ) : (
          <div className="py-24 text-center">
            <BookOpenIcon className="mx-auto size-8 text-[#9cb58f]" />
            <p className="mt-3 text-sm text-[#7a7468]">
              {works.length === 0
                ? "完成第一门课程后，真实作品会出现在这里。"
                : "没有找到相关课程。"}
            </p>
            {works.length === 0 ? (
              <Link
                className={`mt-4 inline-flex h-9 items-center rounded-full bg-[#397a52] px-4 text-sm font-semibold text-white hover:bg-[#2f6845] ${focusRing}`}
                href="/chat"
              >
                创建课程
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function CourseWorkCard({ work }: { work: CourseHistoryItem }) {
  return (
    <Link
      className={`group flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-xl border border-[rgba(232,223,208,0.8)] bg-[#fffcf5] shadow-[var(--keya-card-shadow)] transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(45,51,43,0.2)] ${focusRing}`}
      href={`/course/${work.courseId}`}
    >
      <div className="relative aspect-video overflow-hidden bg-[#f3eee4]">
        <CourseCoverFrame
          courseId={work.courseId}
          cover={work.cover}
          title={work.title}
        />
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-3">
          <Badge className="border-0 bg-[#edf5ee] text-[#2f6845]">
            {statusLabel[work.status]}
          </Badge>
          <span className="text-xs text-[#7a7468]">
            {work.completedPages}/{work.totalPages} 页
          </span>
        </div>
        <p className="mt-3 line-clamp-3 text-sm leading-6 text-[#6f6a60]">
          {work.prompt}
        </p>
        <p className="mt-auto flex items-center gap-1.5 border-t border-dotted border-[#efe7df] pt-3 text-xs text-[#7a7468]">
          <ClockIcon aria-hidden="true" className="size-3.5" />
          {formatDate(work.updatedAt)}
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
