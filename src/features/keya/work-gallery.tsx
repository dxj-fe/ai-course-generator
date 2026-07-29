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
  Sprout as SproutIcon,
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
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2 focus-visible:ring-offset-[#edf8ea]";

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
    <section
      className="keya-home-gallery relative overflow-hidden pb-[180px] pt-20"
      id="work-gallery"
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <span className="keya-home-orb absolute -left-32 top-40 size-80 rounded-full bg-[#c7e9ba]/35 blur-3xl" />
        <span className="keya-home-leaf absolute right-[4%] top-28 h-20 w-11 rotate-[36deg] rounded-[90%_10%_90%_10%] bg-[#89cb79]/20" />
      </div>
      <div className="mx-auto w-[calc(100%-48px)] max-w-[1200px]">
        <div className="relative">
          <p className="flex items-center gap-2 text-sm font-medium text-[#4f7757]">
            <SproutIcon aria-hidden="true" className="size-4" />
            我的学习花园
          </p>
          <h2 className="mt-2 text-3xl font-semibold leading-tight tracking-[-0.03em] text-[#203c2a] sm:text-4xl">
            我的真实课程
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#687a6a]">
            每一次学习，都会在这里留下一片新叶。
          </p>
        </div>

        <div className="relative mt-8 flex flex-wrap items-start justify-between gap-4">
          <ToggleGroup
            className="grid w-full grid-cols-2 gap-2 sm:w-[476.5px] sm:grid-cols-4"
            onValueChange={(value) => {
              if (value) setFilterMode(value as FilterMode);
            }}
            type="single"
            value={filterMode}
          >
            {filterOptions.map(({ id, label, Icon }) => (
              <ToggleGroupItem
                aria-label={label}
                className={`flex h-11 w-full items-center justify-center gap-2 rounded-full px-3 text-sm leading-[14px] transition duration-200 ${focusRing} sm:h-10 sm:w-[113.125px] sm:px-4 ${
                  filterMode === id
                    ? "bg-[#397a52] font-bold text-white shadow-[0_10px_24px_-14px_rgba(47,104,69,0.8)] data-[state=on]:bg-[#397a52] data-[state=on]:text-white"
                    : "bg-[#e2f0dd] font-medium text-[#4f6e55] hover:-translate-y-0.5 hover:bg-white hover:text-[#2f6845] motion-reduce:transform-none"
                }`}
                key={id}
                value={id}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <label className="flex h-11 w-full items-center gap-2 rounded-full border border-[#cfe1ca] bg-white/85 px-4 text-[#6b7b6c] shadow-[0_10px_28px_-24px_rgba(47,104,69,0.55)] transition duration-200 focus-within:border-[#78a875] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#397a52] focus-within:ring-offset-2 focus-within:ring-offset-[#edf8ea] sm:h-10 sm:w-[282px]">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
            <span className="sr-only">搜索课程</span>
            <Input
              className="h-auto w-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-sm leading-[21px] text-[#203c2a] outline-none placeholder:text-[#7b8a7d] focus-visible:border-0 focus-visible:ring-0"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索课程"
              type="search"
              value={query}
            />
          </label>
        </div>

        {visibleWorks.length > 0 ? (
          <div className="relative mt-7 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleWorks.map((work) => (
              <CourseWorkCard key={work.courseId} work={work} />
            ))}
          </div>
        ) : (
          <div className="relative mt-7 rounded-[28px] border border-dashed border-[#b9d2b3] bg-white/55 px-6 py-20 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#dcefd5] text-[#397a52]">
              <BookOpenIcon className="size-6" />
            </span>
            <p className="mt-4 text-sm text-[#647467]">
              {works.length === 0
                ? "完成第一门课程后，真实作品会出现在这里。"
                : "没有找到相关课程。"}
            </p>
            {works.length === 0 ? (
              <Link
                className={`mt-5 inline-flex h-10 items-center rounded-full bg-[#397a52] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_-14px_rgba(47,104,69,0.8)] transition hover:-translate-y-0.5 hover:bg-[#2f6845] motion-reduce:transform-none ${focusRing}`}
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
      className={`keya-home-work-card group flex min-h-[310px] min-w-0 flex-col overflow-hidden rounded-[24px] border border-[#d7e8d2] bg-white/88 shadow-[0_18px_42px_-32px_rgba(35,82,49,0.55)] transition duration-300 hover:-translate-y-1.5 hover:rotate-[0.3deg] hover:border-[#bad5b5] hover:bg-white hover:shadow-[0_26px_52px_-30px_rgba(35,82,49,0.62)] motion-reduce:transform-none ${focusRing}`}
      href={`/course/${work.courseId}`}
    >
      <div className="relative aspect-video overflow-hidden bg-[#e8f2e4]">
        <CourseCoverFrame
          courseId={work.courseId}
          cover={work.cover}
          className="transition-transform duration-500 group-hover:scale-[1.025] motion-reduce:transform-none"
          title={work.title}
        />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-3">
          <Badge className="border-0 bg-[#e2f1dd] text-[#2f6845]">
            {statusLabel[work.status]}
          </Badge>
          <span className="text-xs text-[#607562]">
            {work.completedPages}/{work.totalPages} 页
          </span>
        </div>
        <h3 className="mt-4 line-clamp-2 text-[17px] font-semibold leading-6 text-[#203c2a]">
          {work.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#617064]">
          {work.prompt}
        </p>
        <p className="mt-4 flex items-center gap-1.5 border-t border-dotted border-[#dbe7d8] pt-3 text-xs text-[#607562]">
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
