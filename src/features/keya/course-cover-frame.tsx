"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { CourseHistoryCover } from "@/shared/course-schema";

const COVER_WIDTH = 960;
const COVER_HEIGHT = 540;

type CourseCoverFrameProps = {
  className?: string;
  courseId: string;
  cover?: CourseHistoryCover;
  loading?: "eager" | "lazy";
  title: string;
};

type FramePlacement = {
  left: number;
  scale: number;
  top: number;
};

export function CourseCoverFrame({
  className,
  courseId,
  cover,
  loading = "lazy",
  title,
}: CourseCoverFrameProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<FramePlacement>();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cover) return;

    const placeFrame = () => {
      const { height, width } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const scale = Math.min(width / COVER_WIDTH, height / COVER_HEIGHT);
      setPlacement({
        left: (width - COVER_WIDTH * scale) / 2,
        scale,
        top: (height - COVER_HEIGHT * scale) / 2,
      });
    };

    placeFrame();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", placeFrame);
      return () => window.removeEventListener("resize", placeFrame);
    }

    const observer = new ResizeObserver(placeFrame);
    observer.observe(container);
    return () => observer.disconnect();
  }, [cover]);

  const coverUrl = cover
    ? `/api/courses/${encodeURIComponent(courseId)}/cover?${new URLSearchParams({
        pageId: cover.pageId,
        revision: String(cover.revision),
        generatedAt: cover.generatedAt,
      })}`
    : undefined;

  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_22%_18%,rgba(255,255,255,0.82),transparent_24%),radial-gradient(circle_at_82%_22%,rgba(242,184,75,0.28),transparent_22%),linear-gradient(135deg,#dff1dc,#eff8e8_48%,#fff2c9)]",
        className,
      )}
      ref={containerRef}
    >
      <span className="absolute -right-8 -top-10 size-32 rounded-full border-[20px] border-[#86c584]/24 shadow-[0_0_0_18px_rgba(255,255,255,0.18)]" />
      <span className="absolute inset-x-5 bottom-5 line-clamp-2 text-xl font-semibold leading-7 text-[#28533a] drop-shadow-[0_1px_0_rgba(255,255,255,0.8)]">
        {title}
      </span>

      {coverUrl ? (
        <iframe
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute block h-[540px] w-[960px] origin-top-left border-0 bg-white transition-opacity duration-300 motion-reduce:transition-none",
            placement ? "opacity-100" : "opacity-0",
          )}
          inert
          loading={loading}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts"
          scrolling="no"
          src={coverUrl}
          style={
            placement
              ? {
                  left: placement.left,
                  top: placement.top,
                  transform: `scale(${placement.scale})`,
                }
              : undefined
          }
          tabIndex={-1}
          title={`${title}课程封面`}
        />
      ) : null}
    </span>
  );
}
