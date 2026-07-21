import { AiSchemaValidationError } from "@/server/ai/error";
import { validateHtmlEngineerOutput } from "@/server/agents/html-engineer-agent";
import {
  PageContentDSLSchema,
  RepairResultSchema,
  type HtmlRepairPatch,
  type RepairRequest,
  type RepairResult,
} from "@/shared/course-schema";

export type AppliedRepairCandidate = {
  result: RepairResult;
  content?: RepairRequest["content"];
  html?: string;
};

/** 校验模型只处理已授权 issue，并把定向候选重新送回原产物合同。 */
export function validateAndApplyRepairResult(
  output: unknown,
  request: RepairRequest,
): AppliedRepairCandidate {
  const parsed = RepairResultSchema.safeParse(output);
  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `Repair 结构化输出校验失败：${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const result = parsed.data;
  if (
    result.pageId !== request.pageId ||
    result.targetArtifact !== request.targetArtifact
  ) {
    throw new AiSchemaValidationError("RepairResult 必须引用请求中的页面和目标产物。");
  }

  const allowedCodes = new Set(request.issueCodes);
  const referencedCodes =
    result.kind === "declined"
      ? result.issueCodes
      : [...result.addressedIssueCodes, ...result.unresolvedIssueCodes];
  if (referencedCodes.some((code) => !allowedCodes.has(code))) {
    throw new AiSchemaValidationError("RepairResult 引用了未授权的 issue code。");
  }

  if (result.kind === "declined") return { result };

  const addressedCodes = new Set(result.addressedIssueCodes);
  if (
    result.unresolvedIssueCodes.some((code) => addressedCodes.has(code))
  ) {
    throw new AiSchemaValidationError(
      "同一个 issue 不能同时标记为 addressed 和 unresolved。",
    );
  }

  if (result.kind === "dsl_candidate") {
    const content = validateDslCandidate(result.candidate, request);
    return { result, content };
  }

  const patchCodes = new Set(result.patches.map(({ issueCode }) => issueCode));
  if (
    result.patches.some(({ issueCode }) => !addressedCodes.has(issueCode)) ||
    result.addressedIssueCodes.some((code) => !patchCodes.has(code))
  ) {
    throw new AiSchemaValidationError(
      "HTML patch 必须与 addressedIssueCodes 一一对应。",
    );
  }

  const html = applyHtmlPatches(
    request.html,
    result.patches,
    allowedCodes,
    request.allowedSelectors,
  );
  if (html === request.html) {
    throw new AiSchemaValidationError("HTML Repair 候选没有产生实际变化。");
  }
  validateHtmlEngineerOutput(html, {
    content: request.content,
    visualBrief: request.visualBrief,
    assets: request.assets,
  });
  return { result, html };
}

function validateDslCandidate(
  candidateInput: unknown,
  request: RepairRequest,
) {
  const candidate = PageContentDSLSchema.parse(candidateInput);
  const original = request.content;
  const immutablePairs: Array<[string, unknown, unknown]> = [
    ["version", original.version, candidate.version],
    ["pageId", original.pageId, candidate.pageId],
    ["functionalTemplateId", original.functionalTemplateId, candidate.functionalTemplateId],
    ["title", original.title, candidate.title],
    ["narration", original.narration, candidate.narration],
    ["interaction", original.interaction, candidate.interaction],
    ["assetSlots", original.assetSlots, candidate.assetSlots],
    ["layoutHints", original.layoutHints, candidate.layoutHints],
  ];
  const changedImmutable = immutablePairs.find(
    ([, left, right]) => !sameValue(left, right),
  );
  if (changedImmutable) {
    throw new AiSchemaValidationError(
      `DSL Repair 不得修改未授权字段 ${changedImmutable[0]}。`,
    );
  }

  if (
    original.blocks.length !== candidate.blocks.length ||
    original.blocks.some((block, index) => candidate.blocks[index]?.id !== block.id)
  ) {
    throw new AiSchemaValidationError("DSL Repair 不得增加、删除或重排内容 block。");
  }

  const allowedBlocks = new Set(request.allowedBlockIds);
  original.blocks.forEach((block, index) => {
    if (
      !sameValue(block, candidate.blocks[index]) &&
      !allowedBlocks.has(block.id)
    ) {
      throw new AiSchemaValidationError(
        `DSL Repair 修改了未授权 block ${block.id}。`,
      );
    }
  });

  if (sameValue(original, candidate)) {
    throw new AiSchemaValidationError("DSL Repair 候选没有产生实际变化。");
  }

  return candidate;
}

function applyHtmlPatches(
  original: string,
  patches: HtmlRepairPatch[],
  allowedCodes: Set<string>,
  allowedSelectors: string[],
) {
  let html = original;
  for (const patch of patches) {
    if (!allowedCodes.has(patch.issueCode)) {
      throw new AiSchemaValidationError(
        `HTML patch 引用了未授权 issue ${patch.issueCode}。`,
      );
    }

    const operation = patch.operation ?? "replace";
    if (operation !== "replace") {
      const selector = patch.selector!;
      if (!isAllowedBoundaryScope(selector, allowedSelectors)) {
        throw new AiSchemaValidationError(
          `HTML patch 超出允许 selector scope：${patch.issueCode}。`,
        );
      }
      const boundary = findUniqueTagBoundary(
        html,
        selector,
        operation === "insert_after_open_tag" ? "open" : "close",
        patch.issueCode,
      );
      const insertionIndex =
        operation === "insert_after_open_tag"
          ? boundary.index + boundary.length
          : boundary.index;
      html = `${html.slice(0, insertionIndex)}${patch.replacement}${html.slice(insertionIndex)}`;
      continue;
    }

    const search = patch.search!;
    const first = html.indexOf(search);
    const last = html.lastIndexOf(search);
    if (first < 0 || first !== last) {
      throw new AiSchemaValidationError(
        `HTML patch 的 search 必须在当前文档中唯一匹配：${patch.issueCode}。`,
      );
    }
    if (!isAllowedHtmlScope(html, first, search, allowedSelectors)) {
      throw new AiSchemaValidationError(
        `HTML patch 超出允许 selector scope：${patch.issueCode}。`,
      );
    }
    html = `${html.slice(0, first)}${patch.replacement}${html.slice(first + search.length)}`;
  }
  return html;
}

function isAllowedBoundaryScope(selector: string, selectors: string[]) {
  return selectors.includes("html") || selectors.includes(selector);
}

function findUniqueTagBoundary(
  html: string,
  selector: string,
  boundary: "open" | "close",
  issueCode: string,
) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern =
    boundary === "open"
      ? new RegExp(`<${escapedSelector}\\b[^>]*>`, "gi")
      : new RegExp(`<\\/${escapedSelector}\\s*>`, "gi");
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1 || matches[0]!.index === undefined) {
    throw new AiSchemaValidationError(
      `HTML patch 的 selector 必须在当前文档中唯一定位标签边界：${issueCode}。`,
    );
  }
  return { index: matches[0]!.index, length: matches[0]![0].length };
}

function isAllowedHtmlScope(
  html: string,
  matchIndex: number,
  search: string,
  selectors: string[],
) {
  return selectors.some((selector) => {
    if (selector === "html") return true;
    if (selector === "style") {
      return rangesForTag(html, "style").some(
        ([start, end]) => matchIndex >= start && matchIndex + search.length <= end,
      );
    }

    const dataAttribute = selector.match(
      /^\[([a-z0-9-]+)=["']([^"']+)["']\]$/i,
    );
    if (dataAttribute) {
      return (
        search.includes(dataAttribute[2]!) ||
        search.includes(`${dataAttribute[1]}=`)
      );
    }

    const tag = selector.match(/^[a-z][a-z0-9-]*$/i)?.[0];
    if (tag) {
      return rangesForTag(html, tag).some(
        ([start, end]) => matchIndex >= start && matchIndex + search.length <= end,
      );
    }

    const terminalClass = selector.match(/\.([a-z0-9_-]+)\s*$/i)?.[1];
    if (terminalClass && hasAttributeToken(search, "class", terminalClass)) {
      return true;
    }

    const terminalId = selector.match(/#([a-z0-9_-]+)\s*$/i)?.[1];
    if (terminalId && hasAttributeToken(search, "id", terminalId)) {
      return true;
    }

    return search.includes(selector);
  });
}

function hasAttributeToken(html: string, attribute: "class" | "id", token: string) {
  const pattern = new RegExp(`${attribute}=["']([^"']*)["']`, "gi");
  return [...html.matchAll(pattern)].some((match) =>
    match[1]?.split(/\s+/).includes(token),
  );
}

function rangesForTag(html: string, tag: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  for (const match of html.matchAll(pattern)) {
    if (match.index !== undefined) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
