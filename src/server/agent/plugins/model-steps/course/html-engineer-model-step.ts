import type { UIMessage } from "ai";

import { getHtmlEngineerTimeoutMs } from "@/config/env";
import { generateTextSafe } from "@/server/infra/ai/client";
import {
  AiSchemaValidationError,
  serializeErrorForLog,
} from "@/server/infra/ai/error";
import { buildHtmlEngineerPrompts } from "@/server/agent/plugins/prompts/course/model-steps/html-engineer";
import type { LoadedLocalResource } from "@/server/agent/skill";
import {
  HtmlOutputSchema,
  type AssetGenerationResult,
  type HtmlOutput,
  type PageContentDSL,
  type VisualBrief,
  type VisualPageGuidance,
} from "@/shared/course-schema";
import {
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "@/shared/html-preview";
import {
  getStyleTemplate,
  type StyleTemplate,
} from "@/shared/templates/style";

import { validateHtmlEngineerOutput } from "./html-engineer-contract";
import {
  normalizeChoiceInteractionRoot,
  normalizeChoiceRuntimeMarkers,
  normalizeNativeInteractionMarker,
  normalizeReadyCssBackgroundAccessibility,
  normalizeRevealRuntimeMarkers,
  normalizeTrustedPlayerLayout,
  normalizeWideSingleColumnBreakpoints,
  normalizeUniqueReadyAssetSlotRoots,
  removeAttribute,
  setAttributeValue,
} from "./html-engineer-normalizers";
import {
  normalizeGeneratedActiveContent,
  normalizeGeneratedHtmlEnvelope,
} from "./html-engineer-safety-normalizer";
import {
  normalizeConditionalFeedbackVisibility,
  normalizeSubmissionRuntimeMarker,
} from "./html-engineer-interaction-normalizers";
import { createModelStep } from "./model-step";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepStateBase,
} from "./types";

export type HtmlEngineerInput = {
  content: PageContentDSL;
  visualBrief: VisualBrief;
  assets?: AssetGenerationResult[];
  pageDesignGuidance?: LoadedLocalResource[];
  validationFeedback?: HtmlEngineerValidationFeedback;
};

export type HtmlEngineerValidationFeedback = {
  code: string;
  issues: string[];
};

export type HtmlEngineerResolvedInput = HtmlEngineerInput & {
  pageGuidance: VisualPageGuidance;
  styleTemplate: StyleTemplate;
};

export type HtmlEngineerValidation = {
  contract: ReturnType<typeof validateGeneratedHtmlContract>;
  safety: ReturnType<typeof sanitizeHtmlLite>;
};

export type HtmlEngineerModelStepState = ModelStepStateBase & {
  task: HtmlEngineerInput;
  htmlOutput?: HtmlOutput;
  validation?: HtmlEngineerValidation;
};

export type HtmlEngineerModelStepDependencies = {
  generateHtml(
    input: HtmlEngineerResolvedInput & {
      abortSignal?: AbortSignal;
      traceId: string;
    },
  ): Promise<unknown>;
};

const defaultDependencies: HtmlEngineerModelStepDependencies = {
  generateHtml,
};

/**
 * 创建 PageContentDSL 到静态 HTML 的模型步骤。模型首稿若只违反确定性 HTML
 * 合同，可携带精确问题做一次同阶段纠正；这不是 QA Repair，也不改变页面语义。
 */
export function createHtmlEngineerModelStep(
  dependencies: HtmlEngineerModelStepDependencies = defaultDependencies,
): ModelStep<HtmlEngineerModelStepState> {
  return createModelStep({
    name: "html-engineer-model-step",
    isComplete: (state) => Boolean(state.htmlOutput),
    step: async (state, context, emit) => {
      const resolved = resolveHtmlEngineerInput(state.task);
      let generated = await dependencies.generateHtml({
        ...resolved,
        abortSignal: context.abortSignal,
        traceId: context.traceId,
      });

      emit({
        type: "model_call",
        summary: "HTML Engineer 已返回单页 HTML 文档。",
        data: {
          pageId: state.task.content.pageId,
          purpose: "page-html-generation",
          styleTemplateId: resolved.styleTemplate.id,
        },
      });

      let contractRetryApplied = false;
      let validated: ReturnType<typeof validateHtmlEngineerOutput>;
      try {
        validated = normalizeAndValidateHtmlEngineerOutput(
          generated,
          state.task,
        );
      } catch (firstError) {
        if (!(firstError instanceof AiSchemaValidationError)) {
          throw firstError;
        }
        console.error("[html-engineer]", {
          event: "model-html:validation-failed",
          traceId: context.traceId,
          pageId: state.task.content.pageId,
          stage: "html",
          errorCode: firstError.code,
          ...serializeErrorForLog(firstError),
          recovery: "contract-retry",
        });

        generated = await dependencies.generateHtml({
          ...resolved,
          validationFeedback: {
            code: "HTML_CONTRACT_RETRY",
            issues: extractHtmlContractIssues(firstError),
          },
          abortSignal: context.abortSignal,
          traceId: context.traceId,
        });
        contractRetryApplied = true;
        emit({
          type: "model_call",
          summary: "HTML Engineer 已依据确定性合同问题返回修正版文档。",
          data: {
            pageId: state.task.content.pageId,
            purpose: "page-html-contract-retry",
            styleTemplateId: resolved.styleTemplate.id,
          },
        });

        validated = normalizeAndValidateHtmlEngineerOutput(
          generated,
          state.task,
        );
      }
      const { html, validation } = validated;
      const htmlOutput = HtmlOutputSchema.parse({
        html,
        generatedAt: new Date().toISOString(),
        revision: 1,
      });

      emit({
        type: "validation",
        summary: "HTML 合同、内容标记与安全预检已通过。",
        data: {
          blockCount: state.task.content.blocks.length,
          contractRetryApplied,
          pageId: state.task.content.pageId,
          safetyIssueCount: validation.safety.issues.length,
        },
      });

      return { ...state, htmlOutput, validation };
    },
  });
}

function normalizeAndValidateHtmlEngineerOutput(
  generated: unknown,
  input: HtmlEngineerInput,
) {
  let normalized: unknown = normalizeGeneratedHtmlEnvelope(generated);
  normalized = normalizeGeneratedActiveContent(normalized);
  normalized = normalizeGeneratedCanvasRoot(normalized);
  normalized = normalizeWideSingleColumnBreakpoints(normalized);
  normalized = normalizeTrustedPlayerLayout(normalized);
  // 运行层只补安全与稳定 runtime 属性，不重写模型的内容层级、互动结构或图形。
  normalized = normalizeNativeInteractionMarker(normalized, input);
  normalized = normalizeRevealRuntimeMarkers(normalized, input);
  normalized = normalizeSubmissionRuntimeMarker(
    normalized,
    input.content,
  );
  normalized = normalizeConditionalFeedbackVisibility(
    normalized,
    input.content,
  );
  normalized = normalizeChoiceInteractionRoot(normalized, input);
  normalized = normalizeChoiceRuntimeMarkers(normalized, input);
  normalized = normalizeUniqueReadyAssetSlotRoots(normalized, input);
  normalized = normalizeReadyCssBackgroundAccessibility(
    normalized,
    input,
  );
  return validateHtmlEngineerOutput(normalized, input);
}

function extractHtmlContractIssues(error: AiSchemaValidationError) {
  const prefix = "生成 HTML 校验失败：";
  const message = error.message.startsWith(prefix)
    ? error.message.slice(prefix.length)
    : error.message;
  const issues = [
    ...new Set(
      message
        .split("；")
        .map((issue) => issue.trim())
        .filter(Boolean),
    ),
  ];
  return (issues.length > 0 ? issues : [message])
    .slice(0, 12)
    .map((issue) => issue.slice(0, 500));
}

/** 生成页面统一声明平台流式画布合同。 */
export function normalizeGeneratedCanvasRoot(output: unknown) {
  if (typeof output !== "string") return output;

  const htmlTag = output.match(/<html(?:\s[^>]*)?>/i)?.[0];
  if (!htmlTag) return output;

  const normalizedTag = setAttributeValue(
    removeAttribute(htmlTag, "data-keya-canvas-mode"),
    "data-keya-canvas-mode",
    "fluid",
  );
  return output.replace(htmlTag, normalizedTag);
}

/** 创建 HTML Engineer 模型步骤的可序列化初始状态。 */
export function createHtmlEngineerModelStepState(
  input: HtmlEngineerInput,
): HtmlEngineerModelStepState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

/** 使用服务端 Registry 和默认模型依赖生成一个页面的 HTML。 */
export function runHtmlEngineerModelStep(
  input: HtmlEngineerInput,
  context: ModelStepContext,
) {
  return createHtmlEngineerModelStep().run(
    createHtmlEngineerModelStepState(input),
    context,
  );
}

/** 解析唯一允许使用的模板和本页视觉指导，不接受客户端复制模板正文。 */
export function resolveHtmlEngineerInput(
  input: HtmlEngineerInput,
): HtmlEngineerResolvedInput {
  const styleTemplate = getStyleTemplate(input.visualBrief.styleTemplateId);
  const pageGuidance = input.visualBrief.pageGuidance.find(
    ({ pageId }) => pageId === input.content.pageId,
  );
  const issues: string[] = [];

  if (!styleTemplate) {
    issues.push(`找不到样式模板 ${input.visualBrief.styleTemplateId}`);
  }
  if (!pageGuidance) {
    issues.push(`VisualBrief 缺少页面 ${input.content.pageId} 的视觉指导`);
  }

  if (issues.length > 0 || !styleTemplate || !pageGuidance) {
    throw new AiSchemaValidationError(
      `HTML Engineer 输入校验失败：${issues.join("；")}`,
    );
  }

  return {
    ...input,
    assets: input.assets ?? [],
    validationFeedback: input.validationFeedback,
    styleTemplate,
    pageGuidance,
  };
}

/** 调用文本模型生成原始 HTML 文档，避免再套一层 JSON 转义。 */
async function generateHtml(
  input: HtmlEngineerResolvedInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  },
) {
  const prompts = await buildHtmlEngineerPrompts({
    pageContentDsl: input.content,
    styleTemplate: input.styleTemplate,
    visualBrief: input.visualBrief,
    pageGuidance: input.pageGuidance,
    assets: input.assets ?? [],
    pageDesignGuidance: input.pageDesignGuidance ?? [],
    validationFeedback: input.validationFeedback,
  });
  const messages = [
    {
      id: "html-engineer-request",
      role: "user",
      parts: [{ type: "text", text: prompts.userPrompt }],
    },
  ] satisfies UIMessage[];
  const isRepair = Boolean(input.validationFeedback);
  const result = await generateTextSafe({
    abortSignal: input.abortSignal,
    capability: isRepair ? "html-repair" : "html",
    fallbackTimeoutMs: isRepair ? undefined : 150_000,
    maxTokens: 10_000,
    messages,
    promptFingerprint: prompts.fingerprint,
    systemPrompt: prompts.systemPrompt,
    temperature: input.validationFeedback ? 0.3 : 0.55,
    timeoutMs: isRepair ? 150_000 : getHtmlEngineerTimeoutMs(),
    traceId: input.traceId,
  });

  return result.text;
}


export { validateHtmlEngineerOutput } from "./html-engineer-contract";
export {
  normalizeChoiceInteractionRoot,
  normalizeChoiceRuntimeMarkers,
  normalizeMergedInteractiveBlocks,
  normalizeNativeInteractionMarker,
  normalizeTrustedPageTitle,
  normalizeRevealCardInteraction,
  normalizeRevealRuntimeMarkers,
  normalizeTrustedDslMarkup,
  normalizeTrustedPlayerLayout,
  normalizeWideSingleColumnBreakpoints,
  normalizeUniqueReadyAssetSlotRoots,
  normalizeVisualPrimitiveMarker,
  removeRedundantRestoredDslMarkup,
} from "./html-engineer-normalizers";
export {
  normalizeGeneratedActiveContent,
  normalizeGeneratedHtmlEnvelope,
} from "./html-engineer-safety-normalizer";
export {
  normalizeConditionalFeedbackVisibility,
  normalizeExploreCardInteraction,
  normalizeSortCardInteraction,
  normalizeSubmissionRuntimeMarker,
} from "./html-engineer-interaction-normalizers";
