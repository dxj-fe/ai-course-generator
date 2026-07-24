import { Badge } from "@/components/ui/badge";
import type { RepairAttemptRecord } from "@/shared/course-schema";

const statusCopy: Record<RepairAttemptRecord["status"], string> = {
  running: "修复中",
  applied: "已应用",
  failed: "未完成",
};

/** 只展示 checkpoint 中的公开 Repair 摘要，不暴露候选正文或模型推理。 */
export function RepairLogPanel({
  attempts,
}: {
  attempts: RepairAttemptRecord[];
}) {
  if (attempts.length === 0) return null;

  return (
    <section
      aria-labelledby="repair-log-title"
      className="mt-4 rounded-xl border border-[#eadfd3] bg-[#fffefa] p-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h6 className="text-xs font-semibold text-[#3f4a40]" id="repair-log-title">
          Repair 记录
        </h6>
        <span className="text-[11px] text-[#7a7468]">最多 2 轮</span>
      </div>
      <ol className="mt-2 grid gap-2">
        {attempts.map((attempt) => (
          <li className="rounded-lg bg-[#f6eedc] px-3 py-2" key={attempt.round}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-[#625544]">
                第 {attempt.round} 轮 · {attempt.targetArtifact.toUpperCase()}
              </span>
              <Badge
                className="h-auto rounded-full border-[#ded3c6] bg-[#fffcf5] px-2 py-0.5 text-[10px] text-[#6f6a60]"
                variant="outline"
              >
                {statusCopy[attempt.status]}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-[#7a7468]">
              issues · {attempt.issueCodes.join("、")}
            </p>
            {attempt.changeSummary.length > 0 ? (
              <p className="mt-1 text-[11px] leading-5 text-[#746858]">
                {attempt.changeSummary.join("；")}
              </p>
            ) : attempt.failureClass ? (
              <p className="mt-1 text-[11px] leading-5 text-[#a44f3d]">
                {attempt.failureClass}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
