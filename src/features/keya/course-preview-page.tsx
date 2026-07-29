"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Monitor,
  ShieldCheck,
} from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { HtmlPreviewFrame } from "@/features/keya/html-preview-frame";
import type { GeneratedHtmlPreviewRecord } from "@/shared/html-preview";

export function CoursePreviewPage({
  preview,
}: {
  preview?: GeneratedHtmlPreviewRecord;
}) {
  const router = useRouter();

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/chat");
  };

  return (
    <main className="keya-workspace-shell keya-page-reveal flex h-dvh overflow-hidden flex-col text-[#294532]">
      <header className="flex h-[70px] shrink-0 items-center justify-between gap-4 border-b border-[#d7e9d2] bg-[#fbfff8]/90 px-4 shadow-[0_12px_34px_-30px_rgba(47,104,69,0.58)] backdrop-blur-md sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-label="返回课程编辑"
            className="size-10 shrink-0 rounded-full border-[#cfe3ca] bg-white/85 text-[#35583f] shadow-sm transition-[transform,background-color,border-color] hover:border-[#acd3a8] hover:bg-[#e8f4e5] motion-safe:hover:-translate-x-0.5"
            onClick={goBack}
            size="icon"
            type="button"
            variant="outline"
          >
            <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.8} />
          </Button>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold sm:text-base">
              {preview?.title ?? "课程页面预览"}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-[#6c7e6e]">
              {preview ? `页面 ${preview.pageId}` : "正在读取安全预览…"}
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-[#d1e5cc] bg-[#edf6e9] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.86)] sm:flex">
          <span className="flex items-center gap-2 rounded-full bg-[#397a52] px-4 py-2 text-xs font-semibold text-white shadow-[0_7px_18px_-12px_rgba(47,104,69,0.9)]">
            <Monitor aria-hidden="true" size={14} strokeWidth={1.8} />
            预览模式
          </span>
          <span className="flex items-center gap-2 px-3 text-xs font-semibold text-[#57705d]">
            <ShieldCheck aria-hidden="true" size={14} strokeWidth={1.8} />
            安全沙箱
          </span>
        </div>

        {preview?.qualityReport ? (
          <span
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-semibold ${
              preview.qualityReport.shouldRepair
                ? "bg-[#fff0eb] text-[#a44f3d]"
                : "bg-[#e4f3e3] text-[#2f6845]"
            }`}
          >
            质量 {preview.qualityReport.overallScore} ·{" "}
            {preview.qualityReport.shouldRepair ? "待修复" : "已通过"}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-[#cfe5ca] bg-[#e8f4e5] px-3 py-2 text-xs font-semibold text-[#397a52]">
            草稿
          </span>
        )}
      </header>

      <section className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6 lg:p-8">
        <div className="h-full w-full max-w-[1500px] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-500">
          {preview ? (
            <HtmlPreviewFrame
              className="h-full grid-rows-[auto_minmax(0,1fr)_auto]"
              frameClassName="h-full min-h-0"
              html={preview.html}
              title={`${preview.title} · 独立课程预览`}
            />
          ) : (
            <Alert
              className="mx-auto max-w-xl rounded-[28px] border-[#edc4b9] bg-[#fff5ef]/95 p-7 text-center text-sm leading-6 text-[#984735] shadow-[0_24px_60px_-44px_rgba(152,71,53,0.58)]"
              role="alert"
              variant="destructive"
            >
              找不到该预览，或缓存内容没有通过安全校验。请返回课程工作区重新生成 HTML。
            </Alert>
          )}
        </div>
      </section>

      <footer className="flex h-[74px] shrink-0 items-center justify-center border-t border-[#d7e9d2] bg-[#f8fff5]/90 px-4 backdrop-blur-md">
        <div className="flex items-center gap-4 rounded-full border border-[#d1e5cc] bg-white/85 px-3 py-2 shadow-[0_10px_26px_-20px_rgba(47,104,69,0.62)]">
          <Button
            className="rounded-full text-[#9aaa9b]"
            disabled
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" size={16} />
            上一页
          </Button>
          <span className="rounded-full bg-[#e7f3e3] px-4 py-2 font-mono text-xs font-semibold text-[#35583f]">
            01 / 01
          </span>
          <Button
            className="rounded-full text-[#9aaa9b]"
            disabled
            size="sm"
            type="button"
            variant="ghost"
          >
            下一页
            <ChevronRight aria-hidden="true" size={16} />
          </Button>
        </div>
      </footer>
    </main>
  );
}
