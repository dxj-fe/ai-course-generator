import { ShieldAlert, ShieldCheck } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";

type HtmlPreviewFrameProps = {
  className?: string;
  frameClassName?: string;
  html: string;
  title: string;
};

/** 在不可信页面进入 srcDoc 前执行预检，并用最严格的空 sandbox 隔离展示。 */
export function HtmlPreviewFrame({
  className,
  frameClassName,
  html,
  title,
}: HtmlPreviewFrameProps) {
  const contract = validateGeneratedHtmlContract(html);
  const safety = sanitizeHtmlLite(html);
  const issues = [...contract.issues, ...safety.issues];

  if (issues.length > 0) {
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
      aria-label="HTML 安全预览"
      className={cn("grid gap-3", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#2f6845]">
          <ShieldCheck aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>HTML 合同与安全预检已通过</span>
        </div>
        <span className="rounded-full bg-[#edf5ee] px-2 py-1 font-mono text-[10px] text-[#397a52]">
          sandbox · srcDoc
        </span>
      </div>

      <div className="min-h-0 overflow-hidden rounded-2xl border border-[#e2d7ca] bg-white shadow-[0_12px_32px_-28px_rgba(45,51,43,0.75)]">
        <iframe
          className={cn("block h-[480px] w-full bg-white", frameClassName)}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox=""
          srcDoc={html}
          title={title}
        />
      </div>

      <p className="text-[11px] leading-5 text-[#7a7468]">
        预览文档位于独立浏览上下文；脚本、表单、弹窗、下载、顶层导航与同源能力均未开放。
      </p>
    </section>
  );
}
