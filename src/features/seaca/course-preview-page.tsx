"use client";

import { useSyncExternalStore } from "react";
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
import { HtmlPreviewFrame } from "@/features/seaca/html-preview-frame";
import {
  loadGeneratedHtmlPreview,
  type GeneratedHtmlPreviewRecord,
} from "@/shared/html-preview";

export function CoursePreviewPage({ previewId }: { previewId: string }) {
  const router = useRouter();
  const loaded = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const preview: GeneratedHtmlPreviewRecord | undefined = loaded
    ? loadGeneratedHtmlPreview(previewId)
    : undefined;

  const goBack = () => {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/chat");
  };

  return (
    <main className="flex h-dvh overflow-hidden flex-col bg-[#fcf9f2] text-[#382c19]">
      <header className="flex h-[70px] shrink-0 items-center justify-between gap-4 border-b border-[#ebe1d6] bg-[#fffdf7] px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            aria-label="返回课程编辑"
            className="size-10 shrink-0 rounded-full border-[#e5d9cb] bg-[#fffdf8] text-[#5b4c3b] hover:bg-[#f8f3ec]"
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
            <p className="mt-0.5 truncate text-[11px] text-[#988e80]">
              {preview ? `页面 ${preview.pageId}` : "正在读取安全预览…"}
            </p>
          </div>
        </div>

        <div className="hidden items-center gap-2 rounded-full border border-[#e5d9cb] bg-[#f8f3ec] p-1 sm:flex">
          <span className="flex items-center gap-2 rounded-full bg-[#5b4c3b] px-4 py-2 text-xs font-semibold text-white shadow-sm">
            <Monitor aria-hidden="true" size={14} strokeWidth={1.8} />
            预览模式
          </span>
          <span className="flex items-center gap-2 px-3 text-xs font-semibold text-[#786d5f]">
            <ShieldCheck aria-hidden="true" size={14} strokeWidth={1.8} />
            安全沙箱
          </span>
        </div>

        <span className="shrink-0 rounded-full bg-[#eff7e9] px-3 py-2 text-xs font-semibold text-[#5d9845]">
          草稿
        </span>
      </header>

      <section className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6 lg:p-8">
        <div className="h-full w-full max-w-[1500px]">
          {!loaded ? (
            <p className="rounded-3xl border border-[#e6ddd1] bg-[#fffdf8] p-8 text-center text-sm text-[#988e80]">
              正在读取预览…
            </p>
          ) : preview ? (
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

      <footer className="flex h-[74px] shrink-0 items-center justify-center border-t border-[#ebe1d6] bg-[#fffdf7] px-4">
        <div className="flex items-center gap-4 rounded-full border border-[#e5d9cb] bg-[#fffdf8] px-3 py-2 shadow-sm">
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
          <span className="rounded-full bg-[#f2ece4] px-4 py-2 font-mono text-xs font-semibold text-[#5b4c3b]">
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

function subscribeToHydration() {
  return () => undefined;
}

function getClientHydrationSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}
