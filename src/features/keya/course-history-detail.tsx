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
        className="flex h-dvh items-center justify-center bg-background px-6 text-center text-foreground"
        role="alert"
      >
        <div>
          <TriangleAlert className="mx-auto size-9 text-[#b65e49]" />
          <h1 className="mt-3 font-semibold">课程暂时无法打开</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            请检查网络后重试，课程内容不会因此丢失。
          </p>
          <Button
            className="mt-4 rounded-xl"
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
        className="flex h-dvh items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
      >
        <LoaderCircle
          aria-hidden="true"
          className="size-4 motion-safe:animate-spin"
        />
        正在打开课程…
      </main>
    );
  }

  return <InteractiveCoursePlayer course={detail.course} />;
}
