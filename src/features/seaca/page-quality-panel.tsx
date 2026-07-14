import { AlertTriangle, CheckCircle2, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  QualityDimensionName,
  QualityReport,
  QualitySeverity,
} from "@/shared/course-schema";

const dimensionLabels: Record<QualityDimensionName, string> = {
  contentAccuracy: "内容正确",
  layoutQuality: "排版协调",
  courseCoherence: "课程连贯",
  styleConsistency: "风格一致",
  htmlRuntime: "HTML 运行",
  assetUsability: "素材可用",
};

const severityLabels: Record<QualitySeverity, string> = {
  error: "严重",
  warning: "警告",
  info: "提示",
};

/** 在 Seaca 学习工作区展示可执行的 Page QA 报告，不暴露模型推理。 */
export function PageQualityPanel({ report }: { report: QualityReport }) {
  const dimensions = Object.entries(report.dimensions) as Array<
    [QualityDimensionName, QualityReport["dimensions"][QualityDimensionName]]
  >;
  const issues = [...report.issues].sort(
    (left, right) => severityRank(right.severity) - severityRank(left.severity),
  );

  return (
    <section
      aria-label="页面质量报告"
      className="mt-4 grid gap-4 rounded-2xl border border-[#e5dbcf] bg-[#fffdf8] p-4"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className={`flex size-12 items-center justify-center rounded-full text-lg font-bold ${
              report.shouldRepair
                ? "bg-[#fff0eb] text-[#a44f3d]"
                : "bg-[#eff7e9] text-[#4f8938]"
            }`}
          >
            {report.overallScore}
          </span>
          <div>
            <p className="text-sm font-semibold text-[#4c3e2b]">页面质量评分</p>
            <p className="mt-0.5 text-xs text-[#988e80]">
              {report.issues.length} 个问题 · {report.decision}
            </p>
          </div>
        </div>
        <Badge
          className={`h-auto overflow-visible rounded-full border-0 px-3 py-1 text-xs ${
            report.shouldRepair
              ? "bg-[#fff0eb] text-[#a44f3d]"
              : "bg-[#eff7e9] text-[#4f8938]"
          }`}
        >
          {report.shouldRepair ? (
            <Wrench aria-hidden="true" className="mr-1 size-3" />
          ) : (
            <CheckCircle2 aria-hidden="true" className="mr-1 size-3" />
          )}
          {report.shouldRepair ? "需要修复" : "质量通过"}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        {dimensions.map(([name, result]) => (
          <div className="rounded-xl bg-[#f8f3ec] p-3" key={name}>
            <dt className="text-[#918678]">{dimensionLabels[name]}</dt>
            <dd className="mt-1 font-semibold text-[#594a37]">
              {result.score} 分
            </dd>
          </div>
        ))}
      </dl>

      {issues.length > 0 ? (
        <ol className="grid gap-2">
          {issues.map((issue, index) => (
            <li
              className="rounded-xl border border-[#eadfd3] bg-[#fffefa] p-3"
              key={`${issue.code}-${index}`}
            >
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
                  {severityLabels[issue.severity]} · {dimensionLabels[issue.dimension]}
                </span>
                <code className="text-[10px] text-[#a09689]">{issue.code}</code>
              </div>
              <p className="mt-2 text-xs leading-5 text-[#625544]">
                {issue.message}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-[#988e80]">
                位置：{issue.location.description}
                {issue.location.viewport ? ` · ${issue.location.viewport}` : ""}
              </p>
              <p className="mt-2 rounded-lg bg-[#f8f3ec] px-3 py-2 text-xs leading-5 text-[#746858]">
                建议：{issue.repairHint}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-xl bg-[#eff7e9] px-3 py-2 text-xs text-[#4f8938]">
          没有发现需要处理的具体问题。
        </p>
      )}
    </section>
  );
}

function severityRank(severity: QualitySeverity) {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}
