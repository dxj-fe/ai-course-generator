import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/infra/ai/client";
import { buildRepairPrompts } from "@/server/agent/plugins/prompts/course/model-steps/repair";
import { validateAndApplyRepairResult } from "@/server/course/page/repair-candidate";
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

import { createModelStep } from "./model-step";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepStateBase,
} from "./types";

/** 结构化模型调用使用根对象，结果随后按 kind 进入严格 RepairResult 校验。 */
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

export type RepairModelStepState = ModelStepStateBase & {
  task: RepairRequest;
  result?: RepairResult;
  repairedContent?: PageContentDSL;
  repairedHtml?: string;
};

export type RepairModelStepDependencies = {
  generateCandidate(input: RepairRequest & {
    abortSignal?: AbortSignal;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: RepairModelStepDependencies = { generateCandidate };

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

export function createRepairModelStep(
  dependencies: RepairModelStepDependencies = defaultDependencies,
): ModelStep<RepairModelStepState> {
  return createModelStep({
    name: "repair-model-step",
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
          ? "Repair 已应用平台确定性修复，无需等待模型生成。"
          : `修复模型步骤已返回第 ${request.round} 轮${request.targetArtifact === "dsl" ? "内容" : "页面"}修复候选。`,
        data: {
          pageId: request.pageId,
          round: request.round,
          targetArtifact: request.targetArtifact,
        },
      });

      const applied = validateAndApplyRepairResult(
        output,
        request,
      );
      emit({
        type: "validation",
        summary:
          applied.result.kind === "declined"
            ? `修复模型步骤拒绝扩大范围：${applied.result.reasonSummary}`
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
    (request.html.match(/<\/style\s*>/gi) ?? []).length === 0
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
  const currentRanges = findExactTextRanges(
    html,
    TOUCH_TARGET_BASELINE_CSS,
  );
  if (currentRanges.length > 1) {
    const first = currentRanges[0];
    const last = currentRanges.at(-1);
    const onlyWhitespaceBetween =
      first &&
      last &&
      currentRanges.slice(1).every((range, index) =>
        html
          .slice(currentRanges[index]![1], range[0])
          .trim()
          .length === 0,
      );
    if (first && last && onlyWhitespaceBetween) {
      return {
        issueCode,
        operation: "replace" as const,
        search: html.slice(first[0], last[1]),
        replacement: TOUCH_TARGET_BASELINE_CSS,
        summary: "合并重复触控样式，并覆盖运行时生成的互动项。",
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

export function createRepairModelStepState(
  input: RepairRequest,
): RepairModelStepState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: RepairRequestSchema.parse(input),
  };
}

export function runRepairModelStep(
  input: RepairRequest,
  context: ModelStepContext,
) {
  return createRepairModelStep().run(
    createRepairModelStepState(input),
    context,
  );
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
    prompt: prompts.userPrompt,
    promptFingerprint: prompts.fingerprint,
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
