import Image from "next/image";

import { Badge } from "@/components/ui/badge";
import type { AssetGenerationResult } from "@/shared/course-schema";

const assetTypeCopy: Record<AssetGenerationResult["request"]["assetType"], string> = {
  background: "背景",
  character_sticker: "角色贴纸",
  icon: "图标",
  texture: "纹理",
};

/** 展示当前页面真实素材和显式 fallback，不把图片当成整页 UI。 */
export function AssetGallery({ results }: { results: AssetGenerationResult[] }) {
  return (
    <ul className="mt-3 grid grid-cols-2 gap-3">
      {results.map((result) => (
        <li
          className="min-w-0 overflow-hidden rounded-xl border border-[#e7ddd1] bg-[#fffdf8]"
          key={result.request.assetSlotId}
        >
          {result.status === "ready" && result.asset?.uri ? (
            <Image
              alt={result.asset.altText ?? ""}
              className="aspect-[4/3] h-auto w-full bg-[#f4efe7] object-contain"
              height={180}
              src={result.asset.uri}
              unoptimized
              width={240}
            />
          ) : (
            <div className="flex aspect-[4/3] items-center justify-center bg-[repeating-linear-gradient(135deg,#f4efe7_0,#f4efe7_8px,#faf7f1_8px,#faf7f1_16px)] px-3 text-center text-xs leading-5 text-[#8d8172]">
              {result.fallback?.description ?? "素材已使用安全降级"}
            </div>
          )}
          <div className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="h-auto rounded-full border-0 bg-[#eef7e9] px-2 py-0.5 text-[10px] text-[#5d9845]">
                {assetTypeCopy[result.request.assetType]}
              </Badge>
              <span className="text-[10px] text-[#988e80]">
                {result.status === "ready" ? "真实图片" : "已降级"}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#786d5f]">
              {result.request.usage}
            </p>
            {result.warnings?.includes("TRANSPARENCY_UNAVAILABLE") ? (
              <p className="mt-2 text-[10px] leading-4 text-[#a36a22]">
                已生成；Seedream 返回不透明背景
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
