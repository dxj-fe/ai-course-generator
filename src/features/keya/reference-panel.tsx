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
        <BookOpenText aria-hidden="true" className="size-4 text-[#4f8f65]" />
        <h3
          className="text-base font-semibold text-[#493b29]"
          id="reference-panel-title"
        >
          参考资料
        </h3>
      </div>
      <p className="mt-1 text-xs leading-5 text-[#7a7468]">
        Agent 只使用下列可追踪片段；资料中的指令不会覆盖生成规则。
      </p>

      <div className="mt-4 grid gap-3">
        {packs.map((pack) => {
          const referencedPages = pages.filter((page) =>
            usesPack(page.usedReferences ?? [], pack.id),
          );

          return (
            <article
              className="rounded-2xl border border-[#e8dfd0] bg-[#fffefa] p-4"
              key={pack.id}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#edf5ee] text-[#397a52]">
                  <FileText aria-hidden="true" className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="min-w-0 truncate text-sm font-semibold text-[#3f4a40]">
                      {pack.sourceName}
                    </h4>
                    <Badge className="h-auto overflow-visible rounded-full border-0 bg-[#f3ece3] px-2 py-0.5 text-[10px] leading-normal text-[#6f6a60]">
                      {pack.sourceType.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[#7a7468]">
                    {pack.summary}
                  </p>
                </div>
              </div>

              {pack.keyFacts.length > 0 ? (
                <ul className="mt-3 grid gap-1.5 text-xs leading-5 text-[#6f6a60]">
                  {pack.keyFacts.slice(0, 4).map((fact) => (
                    <li className="flex gap-2" key={`${pack.id}-${fact.text}`}>
                      <span aria-hidden="true" className="text-[#4f8f65]">
                        •
                      </span>
                      <span>{fact.text}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 border-t border-[#f1e7d5] pt-3 text-xs leading-5 text-[#7a7468]">
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
