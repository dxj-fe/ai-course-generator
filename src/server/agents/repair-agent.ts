import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/ai/client";
import { buildRepairPrompts } from "@/server/prompts/repair";
import { validateAndApplyRepairResult } from "@/server/repair/repair-candidate";
import {
  HtmlRepairPatchSchema,
  PageContentDSLSchema,
  RepairFailureClassSchema,
  RepairRequestSchema,
  RepairTargetArtifactSchema,
  type PageContentDSL,
  type RepairRequest,
  type RepairResult,
} from "@/shared/course-schema";

import { createMinimalAgent } from "./core/minimal-agent";
import type {
  Agent,
  AgentRuntimeContext,
  AgentStateBase,
} from "./core/types";

/** 兼容只支持 root object 的 Provider；最终仍收敛到严格 RepairResult union。 */
export const RepairModelOutputSchema = z
  .object({
    kind: z.enum(["dsl_candidate", "html_patch_candidate", "declined"]),
    pageId: z.string().min(1).max(80),
    targetArtifact: RepairTargetArtifactSchema,
    addressedIssueCodes: z.array(z.string().min(1).max(80)).max(20).optional(),
    unresolvedIssueCodes: z.array(z.string().min(1).max(80)).max(20).optional(),
    changeSummary: z.array(z.string().min(2).max(300)).max(10).optional(),
    candidate: PageContentDSLSchema.optional(),
    patches: z.array(HtmlRepairPatchSchema).max(8).optional(),
    issueCodes: z.array(z.string().min(1).max(80)).max(20).optional(),
    failureClass: RepairFailureClassSchema.optional(),
    reasonSummary: z.string().min(2).max(500).optional(),
  })
  .strict();

export type RepairAgentState = AgentStateBase & {
  task: RepairRequest;
  result?: RepairResult;
  repairedContent?: PageContentDSL;
  repairedHtml?: string;
};

export type RepairAgentDependencies = {
  generateCandidate(input: RepairRequest & {
    abortSignal?: AbortSignal;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: RepairAgentDependencies = { generateCandidate };

/** Repair 携带完整页面和报告，允许比普通结构化调用更长但仍保持有限上限。 */
export const REPAIR_MODEL_TIMEOUT_MS = 120_000;
export const REPAIR_MODEL_FALLBACK_TIMEOUT_MS = 60_000;
const TOUCH_TARGET_ISSUE_CODES = new Set([
  "BROWSER_TOUCH_TARGET_UNDER_24",
  "BROWSER_TOUCH_TARGET_UNDER_44",
  "TOO_SMALL_TOUCH_TARGET",
  "TOUCH_TARGET_INSUFFICIENT",
  "TOUCH_TARGET_TOO_SMALL",
]);
const LEGACY_TOUCH_TARGET_BASELINE_CSS = `[data-interaction-type] button,
[data-interaction-type] summary,
[data-interaction-type] select,
[data-interaction-type] textarea,
[data-interaction-type] input:not([type="radio"]):not([type="checkbox"]),
[data-interaction-type] [role="button"] {
  min-width: 44px !important;
  min-height: 44px !important;
}
[data-interaction-type] label {
  display: inline-flex;
  align-items: center;
  min-height: 44px !important;
  cursor: pointer;
}
[data-interaction-type] input[type="radio"],
[data-interaction-type] input[type="checkbox"] {
  min-width: 24px !important;
  min-height: 24px !important;
}`;
const TOUCH_TARGET_BASELINE_CSS = `/* keya-touch-target-baseline */
[data-interaction-type] button,
[data-interaction-type] summary,
[data-interaction-type] select,
[data-interaction-type] textarea,
[data-interaction-type] input:not([type="radio"]):not([type="checkbox"]),
[data-interaction-type] [role="button"],
[data-interaction-type] [data-interaction-item-id],
[data-interaction-type] [tabindex] {
  min-width: 44px !important;
  min-height: 44px !important;
}
[data-interaction-type] label {
  display: inline-flex;
  align-items: center;
  min-height: 44px !important;
  cursor: pointer;
}
[data-interaction-type] input[type="radio"],
[data-interaction-type] input[type="checkbox"] {
  min-width: 24px !important;
  min-height: 24px !important;
}`;

export function createRepairAgent(
  dependencies: RepairAgentDependencies = defaultDependencies,
): Agent<RepairAgentState> {
  return createMinimalAgent({
    name: "repair-agent",
    isComplete: (state) => Boolean(state.result),
    step: async (state, context, emit) => {
      const request = RepairRequestSchema.parse(state.task);
      const deterministicCandidate =
        buildDeterministicOpaqueAssetCandidate(request) ??
        buildDeterministicTouchTargetCandidate(request);
      const output =
        deterministicCandidate ??
        (await dependencies.generateCandidate({
          ...request,
          abortSignal: context.abortSignal,
          traceId: context.traceId,
        }));
      emit({
        type: deterministicCandidate ? "validation" : "model_call",
        summary: deterministicCandidate
          ? `Repair 已应用平台触控尺寸基线，无需等待模型生成 CSS。`
          : `Repair Agent 已返回第 ${request.round} 轮${request.targetArtifact === "dsl" ? "内容" : "页面"}修复候选。`,
        data: {
          pageId: request.pageId,
          round: request.round,
          targetArtifact: request.targetArtifact,
        },
      });

      const applied = validateAndApplyRepairResult(
        normalizeRepairModelOutput(output, request),
        request,
      );
      emit({
        type: "validation",
        summary:
          applied.result.kind === "declined"
            ? `Repair Agent 拒绝扩大修复范围：${applied.result.reasonSummary}`
            : "Repair 候选已通过授权范围和原产物合同校验。",
        data: {
          pageId: request.pageId,
          round: request.round,
          outcome: applied.result.kind,
        },
      });

      return {
        ...state,
        result: applied.result,
        repairedContent: applied.content,
        repairedHtml: applied.html,
      };
    },
  });
}

function buildDeterministicOpaqueAssetCandidate(
  request: RepairRequest,
): unknown {
  if (
    request.targetArtifact !== "html" ||
    !request.issueCodes.includes("ASSET_TRANSPARENCY_UNAVAILABLE")
  ) {
    return undefined;
  }

  const affectedAsset = request.assets.find(
    ({ asset, warnings }) =>
      Boolean(asset?.uri) &&
      warnings?.includes("TRANSPARENCY_UNAVAILABLE"),
  );
  const slotId = affectedAsset?.request.assetSlotId;
  const approvedUri = affectedAsset?.asset?.uri;
  if (!slotId || !approvedUri) return undefined;

  const allowedSelector = `[data-asset-slot-id="${slotId}"]`;
  if (!request.allowedSelectors.includes(allowedSelector)) return undefined;

  const imageTags = (request.html.match(/<img\b[^>]*>/gi) ?? []).filter(
    (tag) =>
      readHtmlAttribute(tag, "data-asset-slot-id") === slotId &&
      readHtmlAttribute(tag, "src") === approvedUri,
  );
  if (imageTags.length !== 1) return undefined;

  const originalImage = imageTags[0]!;
  const containedImage = removeHtmlAttribute(
    originalImage,
    "data-asset-slot-id",
  );

  return {
    kind: "html_patch_candidate",
    pageId: request.pageId,
    targetArtifact: "html",
    addressedIssueCodes: ["ASSET_TRANSPARENCY_UNAVAILABLE"],
    unresolvedIssueCodes: request.issueCodes.filter(
      (code) => code !== "ASSET_TRANSPARENCY_UNAVAILABLE",
    ),
    changeSummary: [
      "将不透明素材放入独立普通流容器，避免供应商背景与正文或复杂背景叠加。",
    ],
    patches: [
      {
        issueCode: "ASSET_TRANSPARENCY_UNAVAILABLE",
        operation: "replace",
        search: originalImage,
        replacement: `<figure data-asset-slot-id="${escapeHtmlAttribute(slotId)}" data-course-opaque-fallback="true" style="margin: var(--course-spacing-section, 1rem) 0; padding: var(--course-spacing-card, 1rem); border-radius: var(--course-radius-card, 1rem); background: var(--course-color-surface, #fff);">${containedImage}</figure>`,
        summary: "把不透明图片降级为独立容器内的唯一素材。",
      },
    ],
  };
}

function buildDeterministicTouchTargetCandidate(
  request: RepairRequest,
): unknown {
  if (
    request.targetArtifact !== "html" ||
    request.allowedSelectors.length !== 1 ||
    request.allowedSelectors[0] !== "style" ||
    (request.html.match(/<\/style\s*>/gi) ?? []).length !== 1
  ) {
    return undefined;
  }
  const issueCode = request.issueCodes.find((code) =>
    TOUCH_TARGET_ISSUE_CODES.has(code),
  );
  if (!issueCode) return undefined;
  const patch = buildTouchTargetPatch(request.html, issueCode);
  if (!patch) return undefined;

  return {
    kind: "html_patch_candidate",
    pageId: request.pageId,
    targetArtifact: "html",
    addressedIssueCodes: [issueCode],
    unresolvedIssueCodes: request.issueCodes.filter(
      (code) => code !== issueCode,
    ),
    changeSummary: [
      "补齐互动控件的最小触控区域，同时保留现有页面内容与视觉结构。",
    ],
    patches: [patch],
  };
}

function buildTouchTargetPatch(
  html: string,
  issueCode: string,
) {
  const legacyRanges = findExactTextRanges(
    html,
    LEGACY_TOUCH_TARGET_BASELINE_CSS,
  );
  const currentRanges = findExactTextRanges(
    html,
    TOUCH_TARGET_BASELINE_CSS,
  );
  const ranges = [...legacyRanges, ...currentRanges].sort(
    (left, right) => left[0] - right[0],
  );
  if (legacyRanges.length > 0 || currentRanges.length > 1) {
    const first = ranges[0];
    const last = ranges.at(-1);
    const onlyWhitespaceBetween =
      first &&
      last &&
      ranges.slice(1).every((range, index) =>
        html
          .slice(ranges[index]![1], range[0])
          .trim()
          .length === 0,
      );
    if (first && last && onlyWhitespaceBetween) {
      return {
        issueCode,
        operation: "replace" as const,
        search: html.slice(first[0], last[1]),
        replacement: TOUCH_TARGET_BASELINE_CSS,
        summary:
          "合并旧的重复触控样式，并覆盖运行时生成的互动项。",
      };
    }
  }
  if (currentRanges.length === 1) return undefined;

  return {
    issueCode,
    operation: "insert_before_close_tag" as const,
    selector: "style",
    replacement: `\n${TOUCH_TARGET_BASELINE_CSS}\n`,
    summary: "为互动控件和关联标签补齐 24px/44px 触控尺寸基线。",
  };
}

function findExactTextRanges(
  html: string,
  text: string,
): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf(text, cursor);
    if (start < 0) break;
    ranges.push([start, start + text.length]);
    cursor = start + text.length;
  }
  return ranges;
}

function readHtmlAttribute(tag: string, attribute: string) {
  const escapedAttribute = attribute.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return tag.match(
    new RegExp(`\\s${escapedAttribute}\\s*=\\s*(["'])(.*?)\\1`, "i"),
  )?.[2];
}

function removeHtmlAttribute(tag: string, attribute: string) {
  const escapedAttribute = attribute.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return tag.replace(
    new RegExp(`\\s+${escapedAttribute}\\s*=\\s*(["']).*?\\1`, "i"),
    "",
  );
}

function escapeHtmlAttribute(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createRepairAgentState(input: RepairRequest): RepairAgentState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: RepairRequestSchema.parse(input),
  };
}

export function runRepairAgent(
  input: RepairRequest,
  context: AgentRuntimeContext,
) {
  return createRepairAgent().run(createRepairAgentState(input), context);
}

async function generateCandidate(
  input: RepairRequest & {
    abortSignal?: AbortSignal;
    traceId: string;
  },
) {
  const prompts = await buildRepairPrompts(
    buildRepairModelInput({
      pageId: input.pageId,
      targetArtifact: input.targetArtifact,
      round: input.round,
      maxRounds: input.maxRounds,
      sourceReport: input.sourceReport,
      issueCodes: input.issueCodes,
      allowedBlockIds: input.allowedBlockIds,
      allowedContentFields: input.allowedContentFields,
      allowedSelectors: input.allowedSelectors,
      content: input.content,
      html: input.html,
      visualBrief: input.visualBrief,
      assets: input.assets,
    }),
  );
  return generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "repair",
    fallbackTimeoutMs: REPAIR_MODEL_FALLBACK_TIMEOUT_MS,
    maxTokens: 8_000,
    normalizeOutput: (output) => normalizeRepairModelOutput(output, input),
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: RepairModelOutputSchema,
    schemaDescription:
      "A bounded page repair candidate or a structured refusal; never a QA decision.",
    schemaName: "page_repair_result",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.1,
    timeoutMs: REPAIR_MODEL_TIMEOUT_MS,
    traceId: input.traceId,
  });
}

/**
 * 模型只看到本轮明确授权的问题。完整 QualityReport 仍保留在 checkpoint，
 * 但不会把旁路 warning 的 code 暴露给 Repair 造成越权引用。
 */
export function buildRepairModelInput(input: RepairRequest) {
  const request = RepairRequestSchema.parse(input);
  const allowedCodes = new Set(request.issueCodes);
  const boundedInput = {
    pageId: request.pageId,
    targetArtifact: request.targetArtifact,
    round: request.round,
    maxRounds: request.maxRounds,
    sourceReport: {
      id: request.sourceReport.id,
      target: request.sourceReport.target,
      overallScore: request.sourceReport.overallScore,
      issues: request.sourceReport.issues.filter(({ code }) =>
        allowedCodes.has(code),
      ),
    },
    issueCodes: request.issueCodes,
    allowedBlockIds: request.allowedBlockIds,
    allowedContentFields: request.allowedContentFields,
    allowedSelectors: request.allowedSelectors,
    content: request.content,
  };

  if (request.targetArtifact === "dsl") return boundedInput;

  return {
    ...boundedInput,
    html: request.html,
    visualBrief: request.visualBrief,
    assets: request.assets,
  };
}

/**
 * 只归一化可确定恢复的 Provider 形态偏差：DSL candidate 的已知别名、
 * 单项公开摘要、缺失的 patch 公开摘要，以及边界插入时可证明属于 CSS 的
 * `html, body` 定位。归一化后仍须通过严格结果 Schema、请求授权范围和
 * 完整原产物合同校验；无法安全收敛的边界会在已知请求范围时结构化拒绝。
 */
export function normalizeRepairModelOutput(
  output: unknown,
  request?: RepairRequest,
): unknown {
  if (!isRecord(output)) return output;

  let normalized = normalizeDslCandidateAliases(output);
  if (typeof output.changeSummary === "string") {
    normalized = {
      ...normalized,
      changeSummary: [output.changeSummary],
    };
  }
  normalized = normalizeRepairBranchFields(normalized);

  if (!Array.isArray(normalized.patches)) return normalized;

  let patchesChanged = false;
  const patches = normalized.patches.map((rawPatch) => {
    let patch = rawPatch;
    if (
      isRecord(patch) &&
      patch.summary === undefined &&
      typeof patch.issueCode === "string"
    ) {
      patch = {
        ...patch,
        summary:
          patch.operation === "replace" || patch.operation === undefined
            ? `针对 ${patch.issueCode} 应用唯一匹配替换。`
            : `针对 ${patch.issueCode} 在授权标签边界插入修复。`,
      };
      patchesChanged = true;
    }
    if (
      isRecord(patch) &&
      (patch.operation === undefined || patch.operation === "replace") &&
      "selector" in patch
    ) {
      const replacePatch = { ...patch };
      delete replacePatch.selector;
      patchesChanged = true;
      return replacePatch;
    }
    if (
      !isRecord(patch) ||
      (patch.operation !== "insert_after_open_tag" &&
        patch.operation !== "insert_before_close_tag") ||
      typeof patch.selector !== "string"
    ) {
      return patch;
    }

    const selector = normalizeBoundarySelector(
      patch.selector,
      patch.replacement,
    );
    if (selector === patch.selector) return patch;

    patchesChanged = true;
    return { ...patch, selector };
  });

  const normalizedWithPatches = patchesChanged
    ? { ...normalized, patches }
    : normalized;
  return request
    ? declineUnsafeBoundaryCandidate(normalizedWithPatches, request)
    : normalizedWithPatches;
}

/**
 * Provider 有时会把 QA 的 CSS selector（例如 `.course-content`）误当作
 * HTML 标签边界。该形态不能进入 canonical RepairResult，也不能被猜测性
 * 扩权为某个标签。把它收敛成结构化拒绝，避免相同 Schema 错误被无反馈
 * 重试；纯标签仍必须通过 request.allowedSelectors 的授权检查。
 */
function declineUnsafeBoundaryCandidate(
  output: Record<string, unknown>,
  request: RepairRequest,
): Record<string, unknown> {
  if (
    output.kind !== "html_patch_candidate" ||
    output.targetArtifact !== "html" ||
    !Array.isArray(output.patches)
  ) {
    return output;
  }

  const unsafePatch = output.patches.find((patch) => {
    if (
      !isRecord(patch) ||
      (patch.operation !== "insert_after_open_tag" &&
        patch.operation !== "insert_before_close_tag")
    ) {
      return false;
    }
    return (
      typeof patch.selector !== "string" ||
      !/^[a-z][a-z0-9-]*$/i.test(patch.selector)
    );
  });
  if (!isRecord(unsafePatch)) return output;

  const selector =
    typeof unsafePatch.selector === "string"
      ? unsafePatch.selector
      : "(missing)";
  return {
    kind: "declined",
    pageId: request.pageId,
    targetArtifact: "html",
    issueCodes: request.issueCodes,
    failureClass: "unlocatable_issue",
    reasonSummary: `Repair 返回的 ${selector} 不是可安全定位的唯一标签边界，已拒绝猜测性扩大修复范围。`,
  };
}

/**
 * Provider 使用一个兼容根 Schema 生成三种 Repair 分支，偶尔会把另一分支
 * 的已知字段一并返回。根据已经明确的 kind/targetArtifact 只移除这些跨分支
 * 字段；其他未知字段仍保留并由 strict Schema 拒绝。
 */
function normalizeRepairBranchFields(
  output: Record<string, unknown>,
): Record<string, unknown> {
  if (
    output.kind === "dsl_candidate" &&
    output.targetArtifact === "dsl"
  ) {
    const normalized = { ...output };
    for (const key of [
      "patches",
      "issueCodes",
      "failureClass",
      "reasonSummary",
    ]) {
      delete normalized[key];
    }
    return normalized;
  }

  if (
    output.kind === "html_patch_candidate" &&
    output.targetArtifact === "html"
  ) {
    const normalized = { ...output };
    for (const key of [
      "candidate",
      "issueCodes",
      "failureClass",
      "reasonSummary",
    ]) {
      delete normalized[key];
    }
    return normalized;
  }

  if (output.kind !== "declined") return output;

  const nested = isRecord(output.declined) ? output.declined : {};
  const normalized: Record<string, unknown> = {
    ...output,
    issueCodes: output.issueCodes ?? nested.issueCodes,
    failureClass: output.failureClass ?? nested.failureClass,
    reasonSummary: output.reasonSummary ?? nested.reasonSummary,
  };
  for (const key of [
    "declined",
    "addressedIssueCodes",
    "unresolvedIssueCodes",
    "changeSummary",
    "candidate",
    "patches",
  ]) {
    delete normalized[key];
  }
  return normalized;
}

/**
 * 部分兼容 Provider 会在已经返回 canonical candidate 的同时，额外附加
 * `dsl_candidate` / `dsl`；也有 Provider 直接把 DSL 放进该别名。只在
 * 明确的 DSL Repair 分支收敛这两个已知形态，其他未知字段仍由 strict
 * Schema 拒绝。
 */
function normalizeDslCandidateAliases(
  output: Record<string, unknown>,
): Record<string, unknown> {
  if (
    output.kind !== "dsl_candidate" ||
    output.targetArtifact !== "dsl"
  ) {
    return output;
  }

  const aliases = ["dsl_candidate", "dsl"] as const;
  const presentAliases = aliases.filter((key) => key in output);
  if (presentAliases.length === 0) return output;

  let candidate = output.candidate;
  if (candidate === undefined) {
    const aliasCandidates = presentAliases.map((key) =>
      unwrapDslCandidateAlias(output[key]),
    );
    if (
      aliasCandidates.some((value) => value === undefined) ||
      aliasCandidates.some((value) => !sameValue(value, aliasCandidates[0]))
    ) {
      return output;
    }
    candidate = aliasCandidates[0];
  }

  const normalized: Record<string, unknown> = { ...output, candidate };
  for (const key of aliases) delete normalized[key];
  return normalized;
}

function unwrapDslCandidateAlias(value: unknown) {
  if (!isRecord(value)) return undefined;
  return value.candidate ?? value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeBoundarySelector(
  selector: string,
  replacement: unknown,
) {
  if (/^[a-z][a-z0-9-]*$/i.test(selector)) return selector;

  /**
   * CSS QA occasionally reports the authored rule scope (`html, body`) and
   * providers copy that value into a boundary-insert patch. A selector list
   * can never be a safe HTML tag boundary. Only when the replacement is
   * provably a CSS rule fragment do we redirect the insertion to the
   * canonical `style` boundary; request-scope validation still has to
   * explicitly authorize `style`.
   */
  if (
    /^(?:html\s*,\s*body|body\s*,\s*html)$/i.test(selector.trim()) &&
    typeof replacement === "string" &&
    /(?:^|})\s*(?:@(?:media|supports|layer)\b|[^{}]+)\s*\{[\s\S]*\}\s*$/i.test(
      replacement.trim(),
    )
  ) {
    return "style";
  }

  return selector;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
