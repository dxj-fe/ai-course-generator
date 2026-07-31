import {
  QualityReportSchema,
  type QualityReport,
} from "@/shared/course-schema";

import {
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "./validation";

export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;

export type GeneratedHtmlPreviewRecord = {
  id: string;
  pageId: string;
  title: string;
  html: string;
  qualityReport?: QualityReport;
  createdAt: string;
  expiresAt: string;
};

export type GeneratedHtmlPreviewInput = Pick<
  GeneratedHtmlPreviewRecord,
  "html" | "pageId" | "title"
> & {
  qualityReport?: QualityReport;
};

export function createGeneratedHtmlPreviewRecord(
  input: GeneratedHtmlPreviewInput,
  now = new Date(),
): GeneratedHtmlPreviewRecord {
  validatePreviewContent(input);
  return {
    id: crypto.randomUUID(),
    pageId: input.pageId,
    title: input.title,
    html: input.html,
    qualityReport: input.qualityReport,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
  };
}

export function parseGeneratedHtmlPreviewRecord(
  value: unknown,
): GeneratedHtmlPreviewRecord {
  if (!isPreviewRecord(value)) {
    throw new Error("预览记录格式无效。");
  }
  validatePreviewContent(value);
  return value;
}

function validatePreviewContent(input: GeneratedHtmlPreviewInput) {
  const contract = validateGeneratedHtmlContract(input.html);
  const safety = sanitizeHtmlLite(input.html);
  if (!contract.valid || !safety.safe) {
    throw new Error("只有通过 HTML 合同与安全预检的页面才能进入独立预览。");
  }
  if (
    input.qualityReport &&
    (!QualityReportSchema.safeParse(input.qualityReport).success ||
      input.qualityReport.target.type !== "page" ||
      input.qualityReport.target.pageId !== input.pageId)
  ) {
    throw new Error("独立预览的质量报告必须通过校验并指向当前页面。");
  }
}

function isPreviewRecord(value: unknown): value is GeneratedHtmlPreviewRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length >= 8 &&
    typeof record.pageId === "string" &&
    record.pageId.length > 0 &&
    typeof record.title === "string" &&
    record.title.length > 0 &&
    typeof record.html === "string" &&
    typeof record.createdAt === "string" &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    typeof record.expiresAt === "string" &&
    Number.isFinite(Date.parse(record.expiresAt)) &&
    (record.qualityReport === undefined ||
      QualityReportSchema.safeParse(record.qualityReport).success)
  );
}
