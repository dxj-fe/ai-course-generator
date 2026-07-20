import {
  QualityReportSchema,
  type QualityDimensionName,
} from "../../src/shared/course-schema";
import { pageContentDsl } from "./course-design";

export function qualityReportWithIssue(input: {
  code: string;
  dimension: QualityDimensionName;
  blockId?: string;
  selector?: string;
  id?: string;
}) {
  return QualityReportSchema.parse({
    id: input.id ?? `quality-${input.code.toLowerCase()}`,
    target: { type: "page", pageId: pageContentDsl.pageId },
    overallScore: 68,
    dimensions: {
      contentAccuracy: { score: 95, summary: "内容整体准确。" },
      layoutQuality: { score: 95, summary: "布局需要检查。" },
      courseCoherence: { score: 95, summary: "课程整体连贯。" },
      styleConsistency: { score: 95, summary: "风格整体一致。" },
      htmlRuntime: { score: 95, summary: "HTML 合同完整。" },
      assetUsability: { score: 95, summary: "素材整体可用。" },
    },
    issues: [
      {
        code: input.code,
        dimension: input.dimension,
        severity: "error",
        source: "model",
        message: `${input.code} 需要修复。`,
        location: {
          pageId: pageContentDsl.pageId,
          blockId: input.blockId,
          selector: input.selector,
          description: input.blockId ?? input.selector ?? "当前页面",
        },
        repairHint: `定向处理 ${input.code}。`,
      },
    ],
    shouldRepair: true,
    decision: "revise",
    createdAt: "2026-07-16T10:00:00+08:00",
  });
}
