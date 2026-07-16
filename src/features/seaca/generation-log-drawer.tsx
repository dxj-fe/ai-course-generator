import { ChevronRight as ChevronRightIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { CourseGenerationPublicEvent } from "@/shared/course-schema";
import type { SeacaCourseRun } from "@/types/seaca";

type GenerationLogDrawerProps = {
  run?: SeacaCourseRun;
};

const eventTypeCopy: Record<CourseGenerationPublicEvent["type"], string> = {
  start: "任务开始",
  agent_start: "Agent 开始",
  agent_done: "Agent 完成",
  model_call: "模型调用",
  tool_call: "工具调用",
  validation: "校验",
  supervisor_decision: "Supervisor 决策",
  page_done: "页面完成",
  finish: "任务完成",
  error: "错误",
};

/**
 * 只读取 checkpoint 中经过严格 schema 校验的公开事件。
 * 不序列化 run、原始流消息或事件 data，避免将 Prompt、产物正文和私有推理带入 DOM。
 */
export function GenerationLogDrawer({ run }: GenerationLogDrawerProps) {
  const events = [...(run?.generation?.events ?? [])].sort(
    (left, right) => left.sequence - right.sequence,
  );

  return (
    <details className="group rounded-2xl border border-[#ebe1d6] bg-[#fffdf8] open:shadow-[0_8px_28px_-24px_rgba(56,44,25,0.35)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-semibold text-[#594a37] outline-none transition-colors hover:bg-[#faf6ef] focus-visible:ring-2 focus-visible:ring-[#77b95e] focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <ChevronRightIcon
            aria-hidden="true"
            className="shrink-0 text-[#77b95e] transition-transform group-open:rotate-90"
            size={15}
            strokeWidth={1.8}
          />
          <span>结构化生成日志</span>
        </span>
        <Badge
          className="h-auto shrink-0 rounded-full border-0 bg-[#eff8e9] px-2.5 py-1 text-[11px] font-semibold text-[#4f8938]"
          variant="secondary"
        >
          {events.length} 条事件
        </Badge>
      </summary>

      <div className="border-t border-[#eee5da] px-4 py-4">
        <p className="text-xs leading-5 text-[#988e80]">
          仅展示经过校验的公开事件摘要，不包含 Prompt、产物正文或私有推理。
        </p>

        {events.length > 0 ? (
          <ol className="mt-3 grid gap-3" aria-label="公开生成事件">
            {events.map((event) => (
              <li
                className="rounded-xl bg-[#f8f3ec] px-3 py-3"
                key={event.id}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-sm leading-6 font-medium text-[#4c3e2b] [overflow-wrap:anywhere]">
                    <span className="mr-2 text-xs font-semibold text-[#77a863]">
                      #{event.sequence}
                    </span>
                    {event.summary}
                  </p>
                  <Badge
                    className="h-auto shrink-0 rounded-full border-[#ddd4c8] bg-[#fffdf8] px-2 py-0.5 text-[10px] font-semibold text-[#786d5f]"
                    variant="outline"
                  >
                    {eventTypeCopy[event.type]}
                  </Badge>
                </div>

                <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] leading-5 text-[#8d8172] sm:grid-cols-2">
                  <EventField label="时间" value={event.timestamp} />
                  <EventField label="类型" value={event.type} />
                  <EventField label="阶段" value={event.stage} />
                  <EventField label="步骤" value={String(event.step)} />
                  {event.agent ? (
                    <EventField label="Agent" value={event.agent} />
                  ) : null}
                  {event.pageId ? (
                    <EventField label="页面" value={event.pageId} />
                  ) : null}
                  <EventField label="追踪" value={event.traceId} />
                  <EventField label="事件 ID" value={event.id} />
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 rounded-xl bg-[#f8f3ec] px-3 py-4 text-center text-sm text-[#988e80]">
            暂无公开生成事件
          </p>
        )}
      </div>
    </details>
  );
}

function EventField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] gap-1">
      <dt className="font-medium text-[#a1978a]">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
    </div>
  );
}
