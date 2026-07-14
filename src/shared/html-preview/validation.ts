export type GeneratedHtmlContractIssueCode =
  | "missing_doctype"
  | "missing_html"
  | "missing_head"
  | "missing_body"
  | "missing_viewport"
  | "missing_style";

export type HtmlSafetyIssueCode =
  | "external_script"
  | "external_iframe"
  | "event_handler"
  | "javascript_url"
  | "meta_refresh"
  | "active_embed"
  | "external_stylesheet";

export type HtmlValidationIssue<Code extends string> = {
  code: Code;
  message: string;
};

type ContractRequirement = HtmlValidationIssue<GeneratedHtmlContractIssueCode> & {
  pattern: RegExp;
};

const contractRequirements: ContractRequirement[] = [
  {
    code: "missing_doctype",
    message: "HTML 必须以 <!doctype html> 声明标准文档模式。",
    pattern: /^\s*<!doctype\s+html\s*>/i,
  },
  {
    code: "missing_html",
    message: "HTML 必须包含完整的 <html> 根元素。",
    pattern: /<html\b[^>]*>[\s\S]*<\/html\s*>/i,
  },
  {
    code: "missing_head",
    message: "HTML 必须包含 <head> 元素。",
    pattern: /<head\b[^>]*>[\s\S]*<\/head\s*>/i,
  },
  {
    code: "missing_body",
    message: "HTML 必须包含 <body> 元素。",
    pattern: /<body\b[^>]*>[\s\S]*<\/body\s*>/i,
  },
  {
    code: "missing_viewport",
    message: "HTML 必须声明 viewport，保证移动端可以正确缩放。",
    pattern: /<meta\b[^>]*\bname\s*=\s*(["'])viewport\1[^>]*>/i,
  },
  {
    code: "missing_style",
    message: "HTML 必须包含内联 <style>，不能依赖宿主应用样式。",
    pattern: /<style\b[^>]*>[\s\S]*<\/style\s*>/i,
  },
];

/** 检查生成页面是否满足完整文档和独立样式契约，不尝试猜测或修复内容。 */
export function validateGeneratedHtmlContract(html: string) {
  const issues = contractRequirements
    .filter(({ pattern }) => !pattern.test(html))
    .map(({ code, message }) => ({ code, message }));

  return { valid: issues.length === 0, issues };
}

/**
 * 对明显危险能力做快速拒绝。它是进入 iframe 前的预检，不是完整 HTML sanitizer，
 * 最终安全边界仍由 iframe sandbox 提供。
 */
export function sanitizeHtmlLite(html: string) {
  const issues: HtmlValidationIssue<HtmlSafetyIssueCode>[] = [];
  const addIssue = (code: HtmlSafetyIssueCode, message: string) => {
    issues.push({ code, message });
  };

  if (/<script\b[^>]*\bsrc\s*=\s*(?:["'][^"']*["']|[^\s>]+)/i.test(html)) {
    addIssue("external_script", "禁止加载外链脚本。生成页面只能使用受控的内联实现。");
  }

  if (
    /<iframe\b[^>]*\bsrc\s*=\s*(["'])\s*(?:https?:)?\/\//i.test(html)
  ) {
    addIssue("external_iframe", "禁止在生成页面中嵌套外链 iframe。");
  }

  if (/\son[a-z][a-z0-9_-]*\s*=/i.test(html)) {
    addIssue("event_handler", "禁止使用 onload、onclick 等内联事件属性。");
  }

  if (
    /\b(?:href|src|action|formaction)\s*=\s*(["'])\s*javascript\s*:/i.test(
      html,
    )
  ) {
    addIssue("javascript_url", "禁止 javascript: URL。");
  }

  if (
    /<meta\b[^>]*\bhttp-equiv\s*=\s*(["'])refresh\1[^>]*>/i.test(html)
  ) {
    addIssue("meta_refresh", "禁止使用 meta refresh 跳转页面。");
  }

  if (/<(?:object|embed|base)\b/i.test(html)) {
    addIssue("active_embed", "禁止 object、embed 和 base 等可改变加载边界的元素。");
  }

  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  if (
    linkTags.some(
      (tag) =>
        /\brel\s*=\s*(["'])stylesheet\1/i.test(tag) &&
        /\bhref\s*=/i.test(tag),
    ) ||
    /@import\s+(?:url\s*\()?\s*["']?(?:https?:)?\/\//i.test(html)
  ) {
    addIssue("external_stylesheet", "禁止加载外部样式表或远程 CSS @import。");
  }

  return { safe: issues.length === 0, issues };
}

