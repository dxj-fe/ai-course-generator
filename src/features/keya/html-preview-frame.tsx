"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  LessonRuntimeEventSchema,
  type LessonRuntimeEvent,
} from "@/shared/course-schema";
import {
  buildFittedLessonSrcDoc,
  buildTrustedLessonSrcDoc,
  sanitizeHtmlLite,
  type TrustedLessonRuntimeConfig,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";

type HtmlPreviewFrameProps = {
  className?: string;
  chrome?: "diagnostic" | "learner";
  frameClassName?: string;
  html: string;
  onRuntimeEvent?(event: LessonRuntimeEvent): void;
  runtimeConfig?: TrustedLessonRuntimeConfig;
  title: string;
};

type HtmlThumbnailFrameProps = {
  html: string;
  title: string;
};

/**
 * 课程缩略图使用不可交互的独立文档，只为平台固定的视口适配脚本开放执行权限，
 * 再以固定 16:9 画布缩放。外层按钮负责导航，iframe 本身不进入焦点顺序。
 */
export function HtmlThumbnailFrame({
  html,
  title,
}: HtmlThumbnailFrameProps) {
  const contract = validateGeneratedHtmlContract(html);
  const safety = sanitizeHtmlLite(html);
  const issues = [...contract.issues, ...safety.issues];
  const srcDoc = useMemo(() => buildFittedLessonSrcDoc(html), [html]);

  if (issues.length > 0) {
    return (
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(135deg,#f2eee6,#fbfaf7)]"
      />
    );
  }

  return (
    <span aria-hidden="true" className="absolute inset-0 overflow-hidden bg-white">
      <iframe
        aria-hidden="true"
        className="pointer-events-none absolute top-px left-0 block h-[540px] w-[960px] origin-top-left border-0 bg-white"
        inert
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts"
        scrolling="no"
        srcDoc={srcDoc}
        style={{ transform: "scale(0.0604167)" }}
        tabIndex={-1}
        title={title}
      />
    </span>
  );
}

/** 生成 HTML 先预检；学习器只为平台固定运行时开放脚本，不开放同源或网络能力。 */
export function HtmlPreviewFrame({
  className,
  chrome = "diagnostic",
  frameClassName,
  html,
  onRuntimeEvent,
  runtimeConfig,
  title,
}: HtmlPreviewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const contract = validateGeneratedHtmlContract(html);
  const safety = sanitizeHtmlLite(html);
  const issues = [...contract.issues, ...safety.issues];
  const trustedRuntime =
    chrome === "learner" && runtimeConfig && issues.length === 0
      ? runtimeConfig
      : undefined;
  const srcDoc = useMemo(
    () =>
      trustedRuntime
        ? buildTrustedLessonSrcDoc(html, trustedRuntime)
        : html,
    [html, trustedRuntime],
  );

  useEffect(() => {
    if (!trustedRuntime || !onRuntimeEvent) return;
    const handleMessage = (message: MessageEvent<unknown>) => {
      if (message.source !== iframeRef.current?.contentWindow) return;
      const parsed = LessonRuntimeEventSchema.safeParse(message.data);
      if (
        !parsed.success ||
        parsed.data.pageId !== trustedRuntime.pageId ||
        parsed.data.runtimeVersion !== trustedRuntime.runtime.runtimeVersion
      ) {
        return;
      }
      onRuntimeEvent(parsed.data);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onRuntimeEvent, trustedRuntime]);

  if (issues.length > 0) {
    if (chrome === "learner") {
      return (
        <Alert
          className="rounded-2xl border border-[#edc4b9] bg-[#fff0eb] px-4 py-4 text-sm text-[#984735]"
          role="alert"
          variant="destructive"
        >
          这一节暂时无法显示，请稍后重试或切换到其他课程节。
        </Alert>
      );
    }

    return (
      <Alert
        className="rounded-2xl border border-[#edc4b9] bg-[#fff0eb] px-4 py-3 text-[#984735]"
        role="alert"
        variant="destructive"
      >
        <div className="flex items-start gap-2.5">
          <ShieldAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
            strokeWidth={1.8}
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold">HTML 已被安全预检拒绝</p>
            <ul className="mt-1.5 grid gap-1 text-xs leading-5">
              {issues.map((issue) => (
                <li key={issue.code}>{issue.message}</li>
              ))}
            </ul>
          </div>
        </div>
      </Alert>
    );
  }

  return (
    <section
      aria-label={chrome === "learner" ? "课程内容" : "HTML 安全预览"}
      className={cn(
        "grid min-h-0",
        chrome === "diagnostic" ? "gap-3" : "h-full",
        className,
      )}
    >
      {chrome === "diagnostic" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#2f6845]">
            <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />
            <span>HTML 合同与安全预检已通过</span>
          </div>
          <span className="rounded-full bg-[#edf5ee] px-2 py-1 font-mono text-[10px] text-[#397a52]">
            sandbox · srcDoc
          </span>
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0 overflow-hidden border border-[#e2d7ca] bg-white shadow-[0_12px_32px_-28px_rgba(45,51,43,0.75)]",
          chrome === "learner" ? "h-full rounded-[inherit]" : "rounded-2xl",
        )}
      >
        <iframe
          className={cn(
            "block w-full bg-white",
            chrome === "diagnostic" ? "h-[480px]" : "h-full",
            frameClassName,
          )}
          loading="lazy"
          referrerPolicy="no-referrer"
          ref={iframeRef}
          sandbox={trustedRuntime ? "allow-scripts" : ""}
          scrolling="no"
          srcDoc={srcDoc}
          title={title}
        />
      </div>

      {chrome === "diagnostic" ? (
        <p className="text-[11px] leading-5 text-[#7a7468]">
          预览文档位于独立浏览上下文；表单提交、弹窗、下载、顶层导航与同源能力均未开放。
        </p>
      ) : null}
    </section>
  );
}
