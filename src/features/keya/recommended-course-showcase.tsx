"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import {
  ArrowRight,
  Clock3,
  FileStack,
  RefreshCw,
  Sprout,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { fetchRecommendedCourses } from "@/features/keya/recommended-course-api";
import type {
  RecommendedCourseListResponse,
  RecommendedCourseSummary,
} from "@/shared/course-schema";

export function RecommendedCourseShowcase({
  initialData,
}: {
  initialData: RecommendedCourseListResponse;
}) {
  const [data, setData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [announcement, setAnnouncement] = useState(
    `已展示${initialData.items.map(({ title }) => title).join("、")}`,
  );
  const [batchKey, setBatchKey] = useState(0);
  const [featured, ...supporting] = data.items;

  const loadNextBatch = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(undefined);
    try {
      const nextData = await fetchRecommendedCourses(data.nextCursor);
      setData(nextData);
      setBatchKey((value) => value + 1);
      setAnnouncement(
        `已换一批灵感：${nextData.items
          .map(({ title }) => title)
          .join("、")}`,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "推荐课程加载失败。",
      );
      setAnnouncement("换一批灵感失败，当前课程仍然可以使用。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleNextBatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadNextBatch();
  };

  return (
    <section
      aria-labelledby="recommended-courses-title"
      className="keya-home-recommendations relative overflow-hidden pb-16 pt-10 sm:pb-20 sm:pt-12 lg:pt-8"
    >
      <div className="relative z-10 mx-auto w-[calc(100%-48px)] max-w-[1248px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-[#4d7555]">
              <Sprout aria-hidden="true" className="size-4" strokeWidth={1.9} />
              课程灵感
            </p>
            <h2
              className="mt-1.5 text-[28px] font-semibold tracking-[-0.035em] text-[#203c2a] sm:text-[32px]"
              id="recommended-courses-title"
            >
              本周精选
            </h2>
            <p className="mt-1.5 text-sm text-[#6a796b]">
              先看看一门好课可以长成什么样
            </p>
          </div>

          <form
            action="/"
            className="flex min-h-9 flex-col items-end justify-end"
            method="get"
            onSubmit={handleNextBatch}
          >
            <input
              name="recommendationCursor"
              type="hidden"
              value={data.nextCursor}
            />
            <Button
              aria-label="换一批推荐课程"
              className="h-9 rounded-full border border-transparent bg-transparent px-3 text-sm font-medium text-[#397a52] shadow-none transition hover:border-[#cfe2ca] hover:bg-white/72 hover:text-[#2f6845] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52]"
              disabled={isLoading}
              type="submit"
              variant="ghost"
            >
              <RefreshCw
                aria-hidden="true"
                className={`size-4 ${isLoading ? "animate-spin" : ""}`}
                strokeWidth={1.8}
              />
              {isLoading ? "正在换一批" : "换一批灵感"}
            </Button>
            {error ? (
              <span className="mt-1 text-xs text-[#a14f3f]" role="alert">
                {error}
              </span>
            ) : null}
          </form>
        </div>

        <div
          aria-busy={isLoading}
          className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.48fr)_minmax(360px,1fr)] lg:gap-5"
          key={batchKey}
        >
          <FeaturedCourseCard course={featured} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            {supporting.map((course) => (
              <SupportingCourseCard course={course} key={course.id} />
            ))}
          </div>
        </div>

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    </section>
  );
}

function FeaturedCourseCard({ course }: { course: RecommendedCourseSummary }) {
  return (
    <article className="keya-recommendation-card grid min-w-0 overflow-hidden rounded-[26px] border border-[#d2e4ce] bg-white/92 shadow-[0_24px_62px_-42px_rgba(35,82,49,0.62)] sm:grid-cols-[minmax(0,1.16fr)_minmax(260px,0.84fr)]">
      <div className="relative aspect-[16/10] min-h-[230px] overflow-hidden bg-[#dcebd8] sm:aspect-auto sm:min-h-[310px]">
        <RecommendedCoursePreview course={course} loading="eager" />
      </div>
      <div className="flex min-w-0 flex-col justify-center bg-[linear-gradient(145deg,rgba(255,255,255,0.98),rgba(247,252,244,0.94))] p-6 sm:p-7 lg:p-8">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[#e7f3e4] px-3 py-1.5 text-xs font-semibold text-[#397a52]">
          <Sprout aria-hidden="true" className="size-3.5" />
          主推课 · {course.domainLabel}
        </span>
        <h3 className="mt-5 text-[25px] font-semibold leading-tight tracking-[-0.03em] text-[#203c2a]">
          {course.title}
        </h3>
        <p className="mt-3 text-sm leading-6 text-[#637165]">
          {course.description}
        </p>
        <CourseMeta course={course} className="mt-5" />
        <Button
          asChild
          className="mt-7 h-11 w-fit rounded-full bg-[#397a52] px-6 text-sm font-semibold text-white shadow-[0_12px_26px_-15px_rgba(47,104,69,0.92)] transition hover:-translate-y-0.5 hover:bg-[#2f6845] hover:shadow-[0_16px_30px_-14px_rgba(47,104,69,0.92)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#397a52] motion-reduce:transform-none"
        >
          <Link href={coursePromptHref(course)}>
            查看课程
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

function SupportingCourseCard({
  course,
}: {
  course: RecommendedCourseSummary;
}) {
  return (
    <Link
      aria-label={`查看课程：${course.title}`}
      className="keya-recommendation-card group grid min-h-[148px] min-w-0 grid-cols-[minmax(128px,0.9fr)_minmax(0,1.1fr)] overflow-hidden rounded-[24px] border border-[#d4e5d0] bg-white/90 shadow-[0_18px_48px_-38px_rgba(35,82,49,0.72)] outline-none transition duration-300 hover:-translate-y-1 hover:border-[#b9d4b5] hover:bg-white hover:shadow-[0_24px_52px_-34px_rgba(35,82,49,0.78)] focus-visible:ring-2 focus-visible:ring-[#397a52] focus-visible:ring-offset-2 focus-visible:ring-offset-[#edf8ea] motion-reduce:transform-none sm:grid-cols-[minmax(132px,0.9fr)_minmax(0,1.1fr)] lg:min-h-0"
      href={coursePromptHref(course)}
    >
      <div className="relative min-h-[148px] overflow-hidden bg-[#e2efe0] lg:min-h-[148px]">
        <RecommendedCoursePreview course={course} />
      </div>
      <div className="flex min-w-0 flex-col justify-center p-5">
        <span className="text-xs font-semibold text-[#4f805b]">
          {course.domainLabel}
        </span>
        <h3 className="mt-1.5 line-clamp-2 text-[17px] font-semibold leading-6 text-[#203c2a]">
          {course.title}
        </h3>
        <p className="mt-1.5 line-clamp-1 text-xs text-[#6a786c]">
          {course.description}
        </p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <CourseMeta course={course} compact />
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#edf5ea] text-[#477352] transition duration-300 group-hover:translate-x-1 group-hover:bg-[#397a52] group-hover:text-white motion-reduce:transform-none"
          >
            <ArrowRight className="size-[18px]" strokeWidth={1.8} />
          </span>
        </div>
      </div>
    </Link>
  );
}

function RecommendedCoursePreview({
  course,
  loading = "lazy",
}: {
  course: RecommendedCourseSummary;
  loading?: "eager" | "lazy";
}) {
  return (
    <iframe
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 block size-full border-0 bg-[#e2efe0]"
      loading={loading}
      referrerPolicy="no-referrer"
      sandbox=""
      scrolling="no"
      src={course.previewUrl}
      tabIndex={-1}
      title={`${course.title}示例课程封面`}
    />
  );
}

function CourseMeta({
  className = "",
  compact = false,
  course,
}: {
  className?: string;
  compact?: boolean;
  course: RecommendedCourseSummary;
}) {
  return (
    <p
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#607162] ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        <FileStack aria-hidden="true" className="size-3.5" />
        {course.pageCount} 页
      </span>
      <span className={`inline-flex items-center gap-1 ${compact ? "max-xl:hidden" : ""}`}>
        <Clock3 aria-hidden="true" className="size-3.5" />
        约 {course.durationMinutes} 分钟
      </span>
    </p>
  );
}

function coursePromptHref(course: RecommendedCourseSummary) {
  return `/chat?${new URLSearchParams({
    prompt: course.prompt,
    source: "recommendation",
  })}`;
}
