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

export function createRepairAgent(
  dependencies: RepairAgentDependencies = defaultDependencies,
): Agent<RepairAgentState> {
  return createMinimalAgent({
    isComplete: (state) => Boolean(state.result),
    step: async (state, context, emit) => {
      const request = RepairRequestSchema.parse(state.task);
      const output = await dependencies.generateCandidate({
        ...request,
        abortSignal: context.abortSignal,
        traceId: context.traceId,
      });
      emit({
        type: "model_call",
        summary: `Repair Agent 已返回第 ${request.round} 轮${request.targetArtifact === "dsl" ? "内容" : "页面"}修复候选。`,
        data: {
          pageId: request.pageId,
          round: request.round,
          targetArtifact: request.targetArtifact,
        },
      });

      const applied = validateAndApplyRepairResult(
        normalizeRepairModelOutput(output),
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
  const prompts = await buildRepairPrompts(input);
  return generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    maxTokens: 8_000,
    normalizeOutput: normalizeRepairModelOutput,
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
 * 只归一化可确定恢复的 Provider 形态偏差：单项公开摘要，以及边界插入时
 * 以安全标签名开头的 CSS selector。归一化后的标签仍须通过请求授权范围、
 * 唯一边界和完整 HTML 合同校验；class/id-only selector 不会被放宽。
 */
export function normalizeRepairModelOutput(output: unknown): unknown {
  if (!isRecord(output)) return output;

  let normalized = output;
  if (typeof output.changeSummary === "string") {
    normalized = {
      ...normalized,
      changeSummary: [output.changeSummary],
    };
  }

  if (!Array.isArray(normalized.patches)) return normalized;

  let patchesChanged = false;
  const patches = normalized.patches.map((patch) => {
    if (
      !isRecord(patch) ||
      (patch.operation !== "insert_after_open_tag" &&
        patch.operation !== "insert_before_close_tag") ||
      typeof patch.selector !== "string"
    ) {
      return patch;
    }

    const selector = normalizeBoundarySelector(patch.selector);
    if (selector === patch.selector) return patch;

    patchesChanged = true;
    return { ...patch, selector };
  });

  if (patchesChanged) {
    normalized = { ...normalized, patches };
  }

  return normalized;
}

function normalizeBoundarySelector(selector: string) {
  if (/^[a-z][a-z0-9-]*$/i.test(selector)) return selector;

  const rootedSelector = selector.match(/^([a-z][a-z0-9-]*)(.*)$/i);
  if (!rootedSelector) return selector;

  const suffix = rootedSelector[2]!;
  const startsCssContinuation =
    /^\s/.test(suffix) ||
    [".", "#", "[", ":", ">", "+", "~"].includes(suffix[0] ?? "");
  return startsCssContinuation ? rootedSelector[1]! : selector;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
