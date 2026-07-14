import type { QualityDimensionName } from "@/shared/course-schema";

/** Day 15 固定回归的十类页面失败，后续 QA 与 Repair 共用稳定 code。 */
export const PAGE_QUALITY_FAILURE_TAXONOMY = [
  { code: "CONTENT_DRIFT", dimension: "contentAccuracy", label: "主题偏离或事实错误" },
  { code: "AUDIENCE_MISMATCH", dimension: "contentAccuracy", label: "难度不符合目标学习者" },
  { code: "DSL_CONTENT_MISSING", dimension: "contentAccuracy", label: "DSL 内容或互动反馈缺失" },
  { code: "COURSE_DISCONTINUITY", dimension: "courseCoherence", label: "与前后页面重复、跳跃或断裂" },
  { code: "TEXT_OVERLOAD", dimension: "layoutQuality", label: "文本过多或信息密度失控" },
  { code: "LAYOUT_CLIPPING", dimension: "layoutQuality", label: "溢出、遮挡或内容裁切" },
  { code: "CONTRAST_RISK", dimension: "layoutQuality", label: "文字对比度不足" },
  { code: "STYLE_TOKEN_DRIFT", dimension: "styleConsistency", label: "视觉风格或 Token 漂移" },
  { code: "HTML_RUNTIME_FAILURE", dimension: "htmlRuntime", label: "HTML 合同、安全或运行结构失败" },
  { code: "ASSET_UNUSABLE", dimension: "assetUsability", label: "素材为空、损坏或不可访问" },
] as const satisfies ReadonlyArray<{
  code: string;
  dimension: QualityDimensionName;
  label: string;
}>;
