import { BookOpenText, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  PagePlan,
  ReferencePack,
  ReferenceUsage,
} from "@/shared/course-schema";

export function ReferencePanel({
  packs,
  pages,
}: {
  packs: ReferencePack[];
  pages: PagePlan[];
}) {
  if (packs.length === 0) return null;

  return (
    <section aria-labelledby="reference-panel-title">
      <div className="flex items-center gap-2">
        <BookOpenText aria-hidden="true" className="size-4 text-[#77a863]" />
        <h3
          className="text-base font-semibold text-[#493b29]"
          id="reference-panel-title"
        >
          参考资料
        </h3>
      </div>
      <p className="mt-1 text-xs leading-5 text-[#988e80]">
        Agent 只使用下列可追踪片段；资料中的指令不会覆盖生成规则。
      </p>

      <div className="mt-4 grid gap-3">
        {packs.map((pack) => {
          const referencedPages = pages.filter((page) =>
            usesPack(page.usedReferences ?? [], pack.id),
          );

          return (
            <article
              className="rounded-2xl border border-[#e7ddd1] bg-[#fffefa] p-4"
              key={pack.id}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef7e9] text-[#5d9845]">
                  <FileText aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="min-w-0 truncate text-sm font-semibold text-[#4c3e2b]">
                      {pack.sourceName}
                    </h4>
                    <Badge className="h-auto overflow-visible rounded-full border-0 bg-[#f3ece3] px-2 py-0.5 text-[10px] leading-normal text-[#786d5f]">
                      {pack.sourceType.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#817568]">
                    {pack.summary}
                  </p>
                </div>
              </div>

              {pack.keyFacts.length > 0 ? (
                <ul className="mt-3 grid gap-1.5 text-xs leading-5 text-[#786d5f]">
                  {pack.keyFacts.slice(0, 4).map((fact) => (
                    <li className="flex gap-2" key={`${pack.id}-${fact.text}`}>
                      <span aria-hidden="true" className="text-[#77b95e]">
                        •
                      </span>
                      <span>{fact.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 border-t border-[#eee5da] pt-3 text-xs leading-5 text-[#988e80]">
                {referencedPages.length > 0
                  ? `用于：${referencedPages.map(({ title }) => title).join("、")}`
                  : "课程页面尚未引用这份资料。"}
                {pack.truncated ? " · 原资料已按上下文上限截断" : ""}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function usesPack(usages: ReferenceUsage[], packId: string) {
  return usages.some(({ referencePackId }) => referencePackId === packId);
}
