import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleDashed,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  QUALITY_DIMENSION_LABELS,
  type QualityDimensionName,
  type QualityIssue,
  type QualityReport,
  type QualitySeverity,
} from "@/shared/course-schema";

const dimensionOrder: QualityDimensionName[] = [
  "contentAccuracy",
  "courseCoherence",
  "layoutQuality",
  "styleConsistency",
  "htmlRuntime",
  "assetUsability",
];

const severityLabels: Record<QualitySeverity, string> = {
  error: "严重",
  warning: "警告",
  info: "提示",
};

/** 在 Keya 学习工作区展示服务端已排序的六维 Page QA 报告。 */
export function PageQualityPanel({ report }: { report: QualityReport }) {
  return (
    <section
      aria-label="页面质量报告"
      className="mt-4 grid gap-4 rounded-2xl border border-[#e5dbcf] bg-[#fffcf5] p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-label={`页面质量总分 ${report.overallScore}`}
            className={`flex size-12 items-center justify-center rounded-full text-lg font-bold ${
              report.shouldRepair
                ? "bg-[#fff0eb] text-[#a44f3d]"
                : "bg-[#edf5ee] text-[#2f6845]"
            }`}
          >
            {report.overallScore}
          </span>
          <div>
            <p className="text-sm font-semibold text-[#3f4a40]">页面质量评分</p>
            <p className="mt-0.5 text-xs text-[#7a7468]">
              六维检查 · {report.issues.length} 个问题 · {report.decision}
            </p>
          </div>
        </div>
        <Badge
          className={`h-auto overflow-visible rounded-full border-0 px-3 py-1 text-xs ${
            report.shouldRepair
              ? "bg-[#fff0eb] text-[#a44f3d]"
              : "bg-[#edf5ee] text-[#2f6845]"
          }`}
        >
          {report.shouldRepair ? (
            <Wrench aria-hidden="true" className="mr-1 size-3" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="mr-1 size-3" />
          )}
          {report.shouldRepair ? "建议修订" : "质量通过"}
        </Badge>
      </div>

      <ScreenshotEvidence report={report} />

      <div className="grid gap-3" role="list" aria-label="六维质量检查结果">
        {dimensionOrder.map((name) => {
          const dimension = report.dimensions[name];
          const issues = report.issues.filter(
            (issue) => issue.dimension === name,
          );
          return (
            <section
              aria-labelledby={`quality-dimension-${name}`}
              className="rounded-xl border border-[#eadfd3] bg-[#fffefa] p-3"
              key={name}
              role="listitem"
            >
              <div className="flex items-center justify-between gap-3">
                <h3
                  className="text-xs font-semibold text-[#3f4a40]"
                  id={`quality-dimension-${name}`}
                >
                  {QUALITY_DIMENSION_LABELS[name]}
                </h3>
                <span className="rounded-full bg-[#f6eedc] px-2.5 py-1 text-xs font-semibold text-[#3f4a40]">
                  {dimension.score} 分
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#756a5b]">
                {dimension.summary}
              </p>
              {issues.length > 0 ? (
                <ol className="mt-3 grid gap-2">
                  {issues.map((issue, index) => (
                    <QualityIssueItem
                      issue={issue}
                      key={`${issue.code}-${issue.location.blockId ?? issue.location.selector ?? index}`}
                    />
                  ))}
                </ol>
              ) : (
                <p className="mt-3 text-[11px] text-[#2f6845]">
                  该维度没有发现具体问题。
                </p>
              )}
              {dimension.repairHints.length > 0 ? (
                <div className="mt-3 rounded-lg bg-[#f6eedc] px-3 py-2">
                  <p className="text-[11px] font-semibold text-[#746858]">
                    修订建议
                  </p>
                  <ul className="mt-1 grid gap-1 text-[11px] leading-5 text-[#746858]">
                    {dimension.repairHints.map((hint) => (
                      <li key={hint}>· {hint}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function QualityIssueItem({ issue }: { issue: QualityIssue }) {
  return (
    <li className="rounded-lg bg-[#f6eedc] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle
          aria-hidden="true"
          className={
            issue.severity === "error"
              ? "size-3.5 text-[#b15743]"
              : "size-3.5 text-[#a27b2d]"
          }
        />
        <span className="text-[10px] font-semibold tracking-wide text-[#8b7f70]">
          {severityLabels[issue.severity]} · {issue.source}
        </span>
        <code className="text-[10px] text-[#a09689]">{issue.code}</code>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-[#625544]">{issue.message}</p>
      <p className="mt-1 text-[11px] leading-5 text-[#7a7468]">
        位置：{issue.location.description}
        {issue.location.viewport ? ` · ${issue.location.viewport}` : ""}
      </p>
    </li>
  );
}

function ScreenshotEvidence({ report }: { report: QualityReport }) {
  const evidence = report.screenshotEvidence;
  if (!evidence) return null;
  const captured = evidence.status === "captured" && evidence.metrics;

  return (
    <div
      aria-label="浏览器截图证据"
      className="rounded-xl bg-[#f6eedc] px-3 py-2.5 text-xs text-[#756a5b]"
    >
      <div className="flex items-center gap-2 font-semibold text-[#3f4a40]">
        {captured ? (
          <Camera aria-hidden="true" className="size-3.5 text-[#2f6845]" />
        ) : (
          <CircleDashed aria-hidden="true" className="size-3.5" />
        )}
        Playwright 截图：
        {captured
          ? `${evidence.viewport.width}×${evidence.viewport.height}`
          : evidence.status === "skipped"
            ? "已跳过"
            : "采集失败"}
      </div>
      {captured ? (
        <p className="mt-1 leading-5">
          横向溢出 {evidence.metrics?.horizontalOverflowPx ?? 0}px · 裁切元素{" "}
          {evidence.metrics?.clippedElementCount ?? 0} · 零尺寸交互{" "}
          {evidence.metrics?.zeroSizeInteractiveCount ?? 0}
        </p>
      ) : (
        <p className="mt-1 leading-5">{evidence.reason}</p>
      )}
    </div>
  );
}
