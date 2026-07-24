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
    <main className="flex h-dvh overflow-hidden flex-col bg-[#fff9ee] text-[#2d332b]">
      <header className="flex h-[70px] shrink-0 items-center justify-between gap-4 border-b border-[#e8dfd0] bg-[#fffcf5] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-label="返回课程编辑"
            className="size-10 shrink-0 rounded-full border-[#e5d9cb] bg-[#fffcf5] text-[#3f4a40] hover:bg-[#f6eedc]"
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
            <p className="mt-0.5 truncate text-[11px] text-[#7a7468]">
              {preview ? `页面 ${preview.pageId}` : "正在读取安全预览…"}
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-[#e5d9cb] bg-[#f6eedc] p-1 sm:flex">
          <span className="flex items-center gap-2 rounded-full bg-[#3f4a40] px-4 py-2 text-xs font-semibold text-white shadow-sm">
            <Monitor aria-hidden="true" size={14} strokeWidth={1.8} />
            预览模式
          </span>
          <span className="flex items-center gap-2 px-3 text-xs font-semibold text-[#6f6a60]">
            <ShieldCheck aria-hidden="true" size={14} strokeWidth={1.8} />
            安全沙箱
          </span>
        </div>

        {preview?.qualityReport ? (
          <span
            className={`shrink-0 rounded-full px-3 py-2 text-xs font-semibold ${
              preview.qualityReport.shouldRepair
                ? "bg-[#fff0eb] text-[#a44f3d]"
                : "bg-[#edf5ee] text-[#397a52]"
            }`}
          >
            质量 {preview.qualityReport.overallScore} ·{" "}
            {preview.qualityReport.shouldRepair ? "待修复" : "已通过"}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-[#edf5ee] px-3 py-2 text-xs font-semibold text-[#397a52]">
            草稿
          </span>
        )}
      </header>

      <section className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6 lg:p-8">
        <div className="h-full w-full max-w-[1500px]">
          {preview ? (
            <HtmlPreviewFrame
              className="h-full grid-rows-[auto_minmax(0,1fr)_auto]"
              frameClassName="h-full min-h-0"
              html={preview.html}
              title={`${preview.title} · 独立课程预览`}
            />
          ) : (
            <Alert
              className="mx-auto max-w-xl rounded-3xl border-[#edc4b9] bg-[#fff0eb] p-6 text-center text-sm leading-6 text-[#984735]"
              role="alert"
              variant="destructive"
            >
              找不到该预览，或缓存内容没有通过安全校验。请返回课程工作区重新生成 HTML。
            </Alert>
          )}
        </div>
      </section>

      <footer className="flex h-[74px] shrink-0 items-center justify-center border-t border-[#e8dfd0] bg-[#fffcf5] px-4">
        <div className="flex items-center gap-4 rounded-full border border-[#e5d9cb] bg-[#fffcf5] px-3 py-2 shadow-sm">
          <Button
            className="rounded-full text-[#b0a79b]"
            disabled
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft aria-hidden="true" size={16} />
            上一页
          </Button>
          <span className="rounded-full bg-[#f2ece4] px-4 py-2 font-mono text-xs font-semibold text-[#3f4a40]">
            01 / 01
          </span>
          <Button
            className="rounded-full text-[#b0a79b]"
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
