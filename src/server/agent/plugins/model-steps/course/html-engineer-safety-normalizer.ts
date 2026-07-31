/**
 * 文本模型偶尔会在完整 HTML 外包 Markdown 围栏。只在能识别完整文档边界时
 * 提取文档，不能凭空补造缺失结构，后续合同校验仍是最终边界。
 */
export function normalizeGeneratedHtmlEnvelope(output: unknown) {
  if (typeof output !== "string") return output;

  const trimmed = output.trim();
  const documentStart = trimmed.search(/<!doctype\s+html\s*>/i);
  const closingTags = [...trimmed.matchAll(/<\/html\s*>/gi)];
  const documentEnd = closingTags.at(-1);
  if (documentStart < 0 || documentEnd?.index === undefined) {
    return trimmed;
  }

  return trimmed.slice(
    documentStart,
    documentEnd.index + documentEnd[0].length,
  );
}

/**
 * 课程 HTML 的交互由平台可信运行时接管，模型生成的脚本、事件处理器和外链
 * 资源既无必要也不可信。这里仅删除主动能力，不修改课程 DSL 的正文与语义。
 */
export function normalizeGeneratedActiveContent(output: unknown) {
  if (typeof output !== "string") return output;

  return output
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/\s*>/gi, "")
    .replace(
      /\s+on[a-z][a-z0-9_-]*\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      "",
    )
    .replace(
      /\s+(href|src|action|formaction)\s*=\s*(["'])\s*javascript\s*:[\s\S]*?\2/gi,
      ' $1="#"',
    )
    .replace(
      /<meta\b[^>]*\bhttp-equiv\s*=\s*(["'])refresh\1[^>]*>/gi,
      "",
    )
    .replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, "")
    .replace(/<embed\b[^>]*\/?\s*>/gi, "")
    .replace(/<base\b[^>]*\/?\s*>/gi, "")
    .replace(
      /<link\b(?=[^>]*\brel\s*=\s*(["'])stylesheet\1)[^>]*>/gi,
      "",
    )
    .replace(
      /\s+(src|srcset|poster)\s*=\s*(["'])\s*(?:https?:)?\/\/[\s\S]*?\2/gi,
      "",
    )
    .replace(
      /(<iframe\b[^>]*?)\s+src\s*=\s*(["'])\s*(?:https?:)?\/\/[\s\S]*?\2/gi,
      "$1",
    )
    .replace(/url\s*\(\s*["']?(?:https?:)?\/\/[^)]*\)/gi, "none")
    .replace(
      /@import\s+(?:url\s*\()?\s*["']?(?:https?:)?\/\/[^;]+;?/gi,
      "",
    );
}
