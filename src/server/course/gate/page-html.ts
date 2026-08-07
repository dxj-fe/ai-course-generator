import {
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";

const MAX_PAGE_HTML_CHARS = 200_000;

export type PageHtmlEnvelopeIssue = {
  code: string;
  message: string;
};

/**
 * 只检查浏览器交付与安全边界，不要求 DSL 标记、模板结构或正文逐字映射。
 */
export function validatePageHtmlEnvelope(
  html: string,
): PageHtmlEnvelopeIssue[] {
  const issues: PageHtmlEnvelopeIssue[] = [];
  if (!html.trim()) {
    return [{ code: "empty_html", message: "index.html 不能为空。" }];
  }
  if (html.length > MAX_PAGE_HTML_CHARS) {
    issues.push({
      code: "html_too_large",
      message: `index.html 超过 ${MAX_PAGE_HTML_CHARS} 字符上限。`,
    });
  }
  issues.push(
    ...validateGeneratedHtmlContract(html).issues,
    ...sanitizeHtmlLite(html).issues,
  );

  const mainOpenTags = html.match(/<main\b[^>]*>/gi) ?? [];
  const mainCloseTags = html.match(/<\/main\s*>/gi) ?? [];
  if (mainOpenTags.length !== 1 || mainCloseTags.length !== 1) {
    issues.push({
      code: "invalid_main_region",
      message: "页面必须包含且只能包含一个 main 主内容区域。",
    });
  }
  return issues;
}
