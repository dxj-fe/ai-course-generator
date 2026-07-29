"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getCourseHistoryDetail } from "@/features/course-planner/lib/course-library-api";
import { InteractiveCoursePlayer } from "@/features/keya/interactive-course-player";
import type { CourseHistoryDetailResponse } from "@/shared/course-schema";

export function CourseHistoryDetail({ courseId }: { courseId: string }) {
  const [detail, setDetail] = useState<CourseHistoryDetailResponse>();
  const [error, setError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getCourseHistoryDetail(courseId, controller.signal)
      .then(setDetail)
      .catch((loadError) => {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "课程加载失败。",
        );
      });
    return () => controller.abort();
  }, [courseId, reloadKey]);

  if (error) {
    return (
      <main
        className="keya-product-shell keya-page-reveal flex h-dvh items-center justify-center px-6 text-center text-[#2d4634]"
        role="alert"
      >
        <div className="w-full max-w-md rounded-[30px] border border-[#dbe8d6] bg-white/80 px-7 py-10 shadow-[0_28px_70px_-48px_rgba(47,104,69,0.68)] backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500">
          <TriangleAlert className="mx-auto size-12 rounded-[18px] bg-[#fff0eb] p-3 text-[#b65e49]" />
          <h1 className="mt-4 text-lg font-semibold">课程暂时无法打开</h1>
          <p className="mt-2 text-sm leading-6 text-[#607562]">
            请检查网络后重试，课程内容不会因此丢失。
          </p>
          <Button
            className="mt-5 rounded-full border-[#cfe3ca] bg-[#fbfff8] px-5 text-[#2f6845] hover:bg-[#e9f5e6]"
            onClick={() => {
              setError(undefined);
              setReloadKey((value) => value + 1);
            }}
            variant="outline"
          >
            <RefreshCw aria-hidden="true" />
            重新加载
          </Button>
        </div>
      </main>
    );
  }

  if (!detail) {
    return (
      <main
        aria-live="polite"
        className="keya-product-shell keya-page-reveal flex h-dvh items-center justify-center gap-2 text-sm font-medium text-[#5f7865]"
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-9 rounded-2xl bg-white/75 p-2 text-[#397a52] shadow-[0_12px_30px_-22px_rgba(47,104,69,0.72)] motion-safe:animate-spin"
        />
        正在打开课程…
      </main>
    );
  }

  return <InteractiveCoursePlayer course={detail.course} />;
}
