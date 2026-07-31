import { AiSchemaValidationError } from "@/server/infra/ai/error";
import { validateHtmlEngineerOutput } from "@/server/agent/plugins/model-steps/course/html-engineer-model-step";
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

  const result = normalizeIssueReferences(parsed.data, request);
  if (
    result.pageId !== request.pageId ||
    result.targetArtifact !== request.targetArtifact
  ) {
    throw new AiSchemaValidationError("RepairResult 必须引用请求中的页面和目标产物。");
  }

  const allowedCodes = new Set(request.issueCodes);

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
  assertNoScrollableLessonContainers(html);
  validateHtmlEngineerOutput(html, {
    content: request.content,
    visualBrief: request.visualBrief,
    assets: request.assets,
  });
  return { result, html };
}

/**
 * patch/candidate 才是实际修改证据；模型返回的 addressed/unresolved 只是摘要。
 * 将摘要收敛到请求授权范围，防止完整 QA 报告里的旁路 warning 消耗 Repair
 * 预算，同时继续严格拒绝任何未授权 patch 和 selector。
 */
function normalizeIssueReferences(
  result: RepairResult,
  request: RepairRequest,
): RepairResult {
  const allowedCodes = new Set(request.issueCodes);

  if (result.kind === "declined") {
    return { ...result, issueCodes: request.issueCodes };
  }

  if (result.kind === "html_patch_candidate") {
    const unauthorizedPatch = result.patches.find(
      ({ issueCode }) => !allowedCodes.has(issueCode),
    );
    if (unauthorizedPatch) {
      throw new AiSchemaValidationError(
        `HTML patch 引用了未授权 issue ${unauthorizedPatch.issueCode}。`,
      );
    }

    const addressedIssueCodes = unique(
      result.patches.map(({ issueCode }) => issueCode),
    );
    return {
      ...result,
      addressedIssueCodes,
      unresolvedIssueCodes: request.issueCodes.filter(
        (code) => !addressedIssueCodes.includes(code),
      ),
    };
  }

  const addressedIssueCodes = unique(
    result.addressedIssueCodes.filter((code) => allowedCodes.has(code)),
  );
  if (addressedIssueCodes.length === 0) {
    throw new AiSchemaValidationError(
      "DSL Repair 没有引用任何已授权的 issue code。",
    );
  }
  return {
    ...result,
    addressedIssueCodes,
    unresolvedIssueCodes: request.issueCodes.filter(
      (code) => !addressedIssueCodes.includes(code),
    ),
  };
}

function validateDslCandidate(
  candidateInput: unknown,
  request: RepairRequest,
) {
  const candidate = PageContentDSLSchema.parse(candidateInput);
  const original = request.content;
  const allowedContentFields = new Set(request.allowedContentFields);
  const immutablePairs: Array<[string, unknown, unknown]> = [
    ["pageId", original.pageId, candidate.pageId],
    ["functionalTemplateId", original.functionalTemplateId, candidate.functionalTemplateId],
    ["title", original.title, candidate.title],
    ...(!allowedContentFields.has("narration")
      ? [["narration", original.narration, candidate.narration] as [
          string,
          unknown,
          unknown,
        ]]
      : []),
    ...(!allowedContentFields.has("interaction")
      ? [["interaction", original.interaction, candidate.interaction] as [
          string,
          unknown,
          unknown,
        ]]
      : []),
    ["usedReferences", original.usedReferences, candidate.usedReferences],
    ["assetSlots", original.assetSlots, candidate.assetSlots],
    ["layoutHints", original.layoutHints, candidate.layoutHints],
    ["runtime", original.runtime, candidate.runtime],
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
    allowedContentFields.has("interaction") &&
    original.interaction.type !== candidate.interaction.type
  ) {
    throw new AiSchemaValidationError(
      "DSL Repair 修改 interaction 时必须保留原互动类型。",
    );
  }
  if (
    allowedContentFields.has("interaction") &&
    !sameValue(
      interactionIdentity(original.interaction),
      interactionIdentity(candidate.interaction),
    )
  ) {
    throw new AiSchemaValidationError(
      "DSL Repair 修改 interaction 时必须保留原技术 ID。",
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

function interactionIdentity(
  interaction: RepairRequest["content"]["interaction"],
) {
  switch (interaction.type) {
    case "choice":
      return {
        type: interaction.type,
        questions: interaction.questions.map((question) => ({
          id: question.id,
          optionIds: question.options.map(({ id }) => id),
        })),
      };
    case "reveal":
    case "sort":
    case "explore":
      return {
        type: interaction.type,
        itemIds: interaction.items.map(({ id }) => id),
      };
    default:
      return { type: interaction.type };
  }
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

const LESSON_CONTAINER_NAME =
  "(?:content|content-area|content-grid|content-panel|content-section|course-action|course-content|course-stage|interaction|interaction-container|interaction-content|interaction-items|interaction-panel|lesson-body|lesson-card|lesson-content|main-content|page-body|page-content|quiz|quiz-container)";
const LESSON_CONTAINER_MARKER =
  /(?:\[\s*data-(?:block-id|interaction-(?:id|item-id|type)|page-id|question-id)\b)|(?:[.#](?:content|content-area|content-grid|content-panel|content-section|course-action|course-content|course-stage|interaction|interaction-container|interaction-content|interaction-items|interaction-panel|lesson-body|lesson-card|lesson-content|main-content|page-body|page-content|quiz|quiz-container)(?=$|[.#:[\]]))/i;

/**
 * Repair 的候选必须继续满足固定画布合同。这里只拒绝课程根、正文和互动
 * 容器上的滚动，不限制纯装饰节点，避免把局部视觉裁切误判成正文滚动。
 */
function assertNoScrollableLessonContainers(html: string) {
  for (const styleBlock of html.matchAll(
    /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi,
  )) {
    const css = (styleBlock[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = rule[2] ?? "";
      if (!hasScrollableOverflowDeclaration(declarations)) continue;

      const selectorList = rule[1] ?? "";
      const selector =
        selectorList.match(
          /:(?:is|where)\([^)]*\b(?:html|body|main)\b[^)]*\)/i,
        )?.[0] ??
        selectorList.split(",").find(selectorTargetsLessonContainer);
      if (selector) {
        throw new AiSchemaValidationError(
          `HTML Repair 候选不得在课程根、正文或互动容器 ${selector.trim()} 使用 overflow:auto/scroll。`,
        );
      }
    }
  }

  for (const openingTag of html.matchAll(
    /<([a-z][a-z0-9-]*)\b[^>]*>/gi,
  )) {
    const tag = openingTag[1]!.toLowerCase();
    const markup = openingTag[0];
    const inlineStyle = readAttribute(markup, "style");
    if (
      inlineStyle &&
      isLessonContainerElement(tag, markup) &&
      hasScrollableOverflowDeclaration(inlineStyle)
    ) {
      throw new AiSchemaValidationError(
        `HTML Repair 候选不得在课程根、正文或互动容器 <${tag}> 使用 overflow:auto/scroll。`,
      );
    }
  }
}

function hasScrollableOverflowDeclaration(declarations: string) {
  return /(?:^|;)\s*overflow(?:-[xy])?\s*:\s*[^;{}]*\b(?:auto|scroll)\b/i.test(
    declarations,
  );
}

function selectorTargetsLessonContainer(selectorInput: string) {
  const selector = selectorInput.trim();
  if (!selector || /:{1,2}(?:after|before|backdrop|marker)\b/i.test(selector)) {
    return false;
  }
  const subject = selector.split(/[\s>+~]+/).at(-1);
  const targetsBroadUniversal =
    subject === "*" &&
    (selector === "*" ||
      /^(?::root|html|body|main)(?:\b|[.#[:])[\s>]+\*$/i.test(selector));
  return Boolean(
    subject &&
      (/^(?:html|body|main)(?=$|[.#[:])/i.test(subject) ||
        /^:root$/.test(subject) ||
        targetsBroadUniversal ||
        LESSON_CONTAINER_MARKER.test(subject)),
  );
}

function isLessonContainerElement(tag: string, openingTag: string) {
  if (tag === "html" || tag === "body" || tag === "main") return true;
  const classOrIdValues = [
    ...(readAttribute(openingTag, "class")?.split(/\s+/) ?? []),
    readAttribute(openingTag, "id"),
  ].filter((value): value is string => Boolean(value));
  return (
    LESSON_CONTAINER_MARKER.test(openingTag) ||
    classOrIdValues.some((value) =>
      new RegExp(`^${LESSON_CONTAINER_NAME}$`, "i").test(value),
    )
  );
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
      /\[([a-z0-9-]+)=["']([^"']+)["']\]\s*$/i,
    );
    if (dataAttribute) {
      return rangesForAttribute(
        html,
        dataAttribute[1]!,
        dataAttribute[2]!,
      ).some(
        ([start, end]) =>
          matchIndex >= start && matchIndex + search.length <= end,
      );
    }

    const tag = selector.match(/^[a-z][a-z0-9-]*$/i)?.[0];
    if (tag) {
      return rangesForTag(html, tag).some(
        ([start, end]) => matchIndex >= start && matchIndex + search.length <= end,
      );
    }

    const terminalClass = selector.match(/\.([a-z0-9_-]+)\s*$/i)?.[1];
    if (terminalClass) {
      return rangesForAttribute(html, "class", terminalClass, true).some(
        ([start, end]) =>
          matchIndex >= start && matchIndex + search.length <= end,
      );
    }

    const terminalId = selector.match(/#([a-z0-9_-]+)\s*$/i)?.[1];
    if (terminalId) {
      return rangesForAttribute(html, "id", terminalId).some(
        ([start, end]) =>
          matchIndex >= start && matchIndex + search.length <= end,
      );
    }

    return search.includes(selector);
  });
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

/**
 * QA selectors often point at an element while a Repair patch replaces only
 * text inside that element. Resolve the owning element range instead of
 * requiring the replacement snippet itself to repeat the class/id marker.
 */
function rangesForAttribute(
  html: string,
  attribute: string,
  value: string,
  tokenMatch = false,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const openingTag = /<([a-z][a-z0-9-]*)\b[^>]*>/gi;
  for (const match of html.matchAll(openingTag)) {
    if (match.index === undefined) continue;
    const attributeValue = readAttribute(match[0], attribute);
    const matches = tokenMatch
      ? attributeValue?.split(/\s+/).includes(value)
      : attributeValue === value;
    if (!matches) continue;

    const range = rangeForElement(html, {
      tag: match[1]!,
      start: match.index,
      openEnd: match.index + match[0].length,
      openingTag: match[0],
    });
    if (range) ranges.push(range);
  }
  return ranges;
}

function readAttribute(tag: string, attribute: string) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return tag.match(
    new RegExp(`\\s${escaped}\\s*=\\s*["']([^"']*)["']`, "i"),
  )?.[1];
}

function rangeForElement(
  html: string,
  input: {
    tag: string;
    start: number;
    openEnd: number;
    openingTag: string;
  },
): [number, number] | undefined {
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  if (
    voidTags.has(input.tag.toLowerCase()) ||
    /\/\s*>$/.test(input.openingTag)
  ) {
    return [input.start, input.openEnd];
  }

  const escapedTag = input.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`<\\/?${escapedTag}\\b[^>]*>`, "gi");
  boundary.lastIndex = input.openEnd;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(html))) {
    if (new RegExp(`^<\\/${escapedTag}\\b`, "i").test(match[0])) {
      depth -= 1;
      if (depth === 0) {
        return [input.start, match.index + match[0].length];
      }
    } else if (!/\/\s*>$/.test(match[0])) {
      depth += 1;
    }
  }
  return undefined;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unique<Value>(values: Value[]) {
  return [...new Set(values)];
}
