import {
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "./validation";
import {
  QualityReportSchema,
  type QualityReport,
} from "@/shared/course-schema";

const PREVIEW_STORAGE_PREFIX = "seaca:html-preview:";
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1_000;

export type GeneratedHtmlPreviewRecord = {
  version: 2;
  id: string;
  pageId: string;
  title: string;
  html: string;
  qualityReport?: QualityReport;
  createdAt: string;
  expiresAt: string;
};

type PreviewStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

/** 把已通过校验的 HTML 放入浏览器临时预览缓存，URL 中只暴露随机 ID。 */
export function saveGeneratedHtmlPreview(
  input: Pick<GeneratedHtmlPreviewRecord, "html" | "pageId" | "title"> & {
    qualityReport?: QualityReport;
  },
  storage: PreviewStorage = window.localStorage,
) {
  const contract = validateGeneratedHtmlContract(input.html);
  const safety = sanitizeHtmlLite(input.html);

  if (!contract.valid || !safety.safe) {
    throw new Error("只有通过 HTML 合同与安全预检的页面才能进入独立预览。");
  }

  const id = crypto.randomUUID();
  if (
    input.qualityReport &&
    (!QualityReportSchema.safeParse(input.qualityReport).success ||
      input.qualityReport.target.type !== "page" ||
      input.qualityReport.target.pageId !== input.pageId)
  ) {
    throw new Error("独立预览的质量报告必须通过校验并指向当前页面。");
  }

  const record: GeneratedHtmlPreviewRecord = {
    version: 2,
    id,
    pageId: input.pageId,
    title: input.title,
    html: input.html,
    qualityReport: input.qualityReport,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PREVIEW_TTL_MS).toISOString(),
  };

  storage.setItem(previewStorageKey(id), JSON.stringify(record));
  return record;
}

/** 从不可信浏览器存储读取预览，并再次执行结构、安全和记录形状检查。 */
export function loadGeneratedHtmlPreview(
  id: string,
  storage: PreviewStorage = window.localStorage,
): GeneratedHtmlPreviewRecord | undefined {
  const raw = storage.getItem(previewStorageKey(id));
  if (!raw) return undefined;

  try {
    const value: unknown = JSON.parse(raw);
    if (!isPreviewRecord(value) || value.id !== id) return undefined;
    if (Date.parse(value.expiresAt) <= Date.now()) {
      storage.removeItem(previewStorageKey(id));
      return undefined;
    }

    const contract = validateGeneratedHtmlContract(value.html);
    const safety = sanitizeHtmlLite(value.html);
    return contract.valid && safety.safe ? value : undefined;
  } catch {
    return undefined;
  }
}

function previewStorageKey(id: string) {
  return `${PREVIEW_STORAGE_PREFIX}${id}`;
}

function isPreviewRecord(value: unknown): value is GeneratedHtmlPreviewRecord {
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  return (
    record.version === 2 &&
    typeof record.id === "string" &&
    typeof record.pageId === "string" &&
    typeof record.title === "string" &&
    typeof record.html === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.expiresAt === "string" &&
    (record.qualityReport === undefined ||
      (QualityReportSchema.safeParse(record.qualityReport).success &&
        (record.qualityReport as QualityReport).target.type === "page" &&
        (record.qualityReport as QualityReport & {
          target: { type: "page"; pageId: string };
        }).target.pageId === record.pageId))
  );
}
