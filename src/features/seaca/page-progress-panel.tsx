import { Badge } from "@/components/ui/badge";
import type {
  CourseRunStageStatus,
  SeacaCourseRun,
} from "@/types/seaca";

type PageProgressPanelProps = {
  run?: SeacaCourseRun;
};

type ProgressStatus = CourseRunStageStatus | "optional";

const statusCopy: Record<ProgressStatus, string> = {
  idle: "等待中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  optional: "可选·未运行",
};

const statusClasses: Record<ProgressStatus, string> = {
  idle: "border-[#ddd4c8] bg-[#f7f1e9] text-[#8d8172]",
  running: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  completed: "border-[#bdddaf] bg-[#eff8e9] text-[#4f8938]",
  failed: "border-[#e4b6aa] bg-[#fff0eb] text-[#a44f3d]",
  optional: "border-[#e3dbd1] bg-[#faf7f2] text-[#94897c]",
};

const pageStatusCopy: Record<CourseRunStageStatus, string> = {
  idle: "页面等待中",
  running: "页面生成中",
  completed: "页面已完成",
  failed: "页面失败",
};

/**
 * 在学习工作区集中展示逐页 DSL、素材、HTML 与可选 QA 进度。
 * 组件只消费 Controller 投影后的状态，不直接访问业务 API。
 */
export function PageProgressPanel({ run }: PageProgressPanelProps) {
  const outline =
    run?.planner.data?.state.outline ?? run?.generation?.outline;
  const pages = outline?.pages ?? [];

  return (
    <section
      aria-labelledby="page-progress-title"
      className="rounded-[20px] border border-[#ebe1d6] bg-[#fffdf8] p-4 sm:p-5"
    >
      <div>
        <p className="text-xs font-semibold tracking-[0.08em] text-[#77a863]">
          页面进度
        </p>
        <h3
          className="mt-1 text-base font-semibold text-[#493b29]"
          id="page-progress-title"
        >
          逐页生成状态
        </h3>
        <p className="mt-1 text-xs leading-5 text-[#988e80]">
          DSL、素材与 HTML 是页面交付阶段；QA 为完成后可选检查。
        </p>
      </div>

      {pages.length > 0 && run ? (
        <ol aria-label="课程逐页生成进度" className="mt-4 grid gap-3">
          {pages.map((page) => {
            const writeStatus = run.pageWrites[page.id]?.status ?? "idle";
            const assetStatus = run.pageAssets[page.id]?.status ?? "idle";
            const htmlStatus = run.pageHtml[page.id]?.status ?? "idle";
            const qaStatus = run.pageQa[page.id]?.status ?? "optional";
            const pageStatus = getPageStatus([
              writeStatus,
              assetStatus,
              htmlStatus,
            ]);

            return (
              <li
                className="rounded-2xl border border-[#eee5da] bg-[#fdfaf5] p-3 sm:p-4"
                key={page.id}
              >
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eff8e9] text-xs font-semibold text-[#5f9848]"
                    >
                      {String(page.order).padStart(2, "0")}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold leading-5 text-[#4c3e2b]">
                        {page.title}
                      </h4>
                      <p className="mt-0.5 text-[11px] text-[#a1978a]">
                        {page.id}
                      </p>
                    </div>
                  </div>
                  <ProgressBadge
                    label={pageStatusCopy[pageStatus]}
                    status={pageStatus}
                  />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StageProgress label="Page DSL" status={writeStatus} />
                  <StageProgress label="图片素材" status={assetStatus} />
                  <StageProgress label="HTML" status={htmlStatus} />
                  <StageProgress label="页面 QA" status={qaStatus} />
                </dl>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 rounded-2xl bg-[#f8f3ec] px-4 py-5 text-center text-sm leading-6 text-[#988e80]">
          课程规划生成后，这里会显示每页的 DSL、素材、HTML 与 QA
          进度。
        </p>
      )}
    </section>
  );
}

function StageProgress({
  label,
  status,
}: {
  label: string;
  status: ProgressStatus;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-white px-3 py-2.5">
      <dt className="text-[11px] font-medium text-[#8d8172]">{label}</dt>
      <dd className="mt-1.5">
        <ProgressBadge label={statusCopy[status]} status={status} />
      </dd>
    </div>
  );
}

function ProgressBadge({
  label,
  status,
}: {
  label: string;
  status: ProgressStatus;
}) {
  return (
    <Badge
      className={`h-auto max-w-full whitespace-normal rounded-full border px-2 py-0.5 text-[11px] leading-normal font-semibold ${statusClasses[status]}`}
      data-status={status}
      variant="outline"
    >
      {label}
    </Badge>
  );
}

/** 可选 QA 不参与页面交付状态计算。 */
function getPageStatus(
  requiredStatuses: CourseRunStageStatus[],
): CourseRunStageStatus {
  if (requiredStatuses.some((status) => status === "failed")) {
    return "failed";
  }

  if (requiredStatuses.every((status) => status === "completed")) {
    return "completed";
  }

  if (
    requiredStatuses.some(
      (status) => status === "running" || status === "completed",
    )
  ) {
    return "running";
  }

  return "idle";
}
