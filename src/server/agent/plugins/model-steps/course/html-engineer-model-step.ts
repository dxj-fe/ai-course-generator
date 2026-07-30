import type { UIMessage } from "ai";

import { getHtmlEngineerTimeoutMs } from "@/config/env";
import { generateTextSafe } from "@/server/infra/ai/client";
import {
  AiSchemaValidationError,
  serializeErrorForLog,
} from "@/server/infra/ai/error";
import { renderDeterministicPageFallback } from "@/server/course/page/deterministic-fallback";
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
  getFunctionalTemplate,
  type FunctionalTemplate,
} from "@/shared/templates/functional";
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
  normalizeRevealCardInteraction,
  normalizeTrustedDslMarkup,
  normalizeVisualPrimitiveMarker,
  removeAttribute,
  setAttributeValue,
} from "./html-engineer-normalizers";
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
  /**
   * 默认优先保留模型的高级构图；QA 已证明整页布局无法经局部修复收敛时，
   * 可直接使用平台确定性紧凑渲染器重建干净页面。
   */
  renderMode?: "model" | "deterministic";
};

export type HtmlEngineerValidationFeedback = {
  code: string;
  issues: string[];
};

export type HtmlEngineerResolvedInput = HtmlEngineerInput & {
  functionalTemplate: FunctionalTemplate;
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

/** 创建只负责一次 PageContentDSL 到静态 HTML 的模型步骤。 */
export function createHtmlEngineerModelStep(
  dependencies: HtmlEngineerModelStepDependencies = defaultDependencies,
): ModelStep<HtmlEngineerModelStepState> {
  return createModelStep({
    name: "html-engineer-model-step",
    isComplete: (state) => Boolean(state.htmlOutput),
    step: async (state, context, emit) => {
      const resolved = resolveHtmlEngineerInput(state.task);
      const forceDeterministic = state.task.renderMode === "deterministic";
      let normalized: unknown;
      if (forceDeterministic) {
        normalized = renderDeterministicPageFallback({
          assets: resolved.assets,
          content: resolved.content,
          styleTemplate: resolved.styleTemplate,
        });
      } else {
        const generated = await dependencies.generateHtml({
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

        normalized = normalizeGeneratedCanvasRoot(generated);
        normalized = normalizeTrustedDslMarkup(normalized, state.task);
        normalized = normalizeNativeInteractionMarker(normalized, state.task);
        normalized = normalizeRevealCardInteraction(normalized, state.task);
        normalized = normalizeChoiceInteractionRoot(normalized, state.task);
        normalized = normalizeChoiceRuntimeMarkers(normalized, state.task);
        normalized = normalizeVisualPrimitiveMarker(normalized, state.task);
        normalized = normalizeReadyCssBackgroundAccessibility(
          normalized,
          state.task,
        );
      }
      let fallbackApplied = forceDeterministic;
      let validated: ReturnType<typeof validateHtmlEngineerOutput>;
      try {
        validated = validateHtmlEngineerOutput(normalized, state.task);
      } catch (error) {
        if (!(error instanceof AiSchemaValidationError)) throw error;
        if (forceDeterministic) throw error;
        console.error("[html-engineer]", {
          event: "model-html:validation-failed",
          traceId: context.traceId,
          pageId: state.task.content.pageId,
          stage: "html",
          errorCode: error.code,
          ...serializeErrorForLog(error),
          recovery: "deterministic-fallback",
        });

        const fallbackHtml = renderDeterministicPageFallback({
          assets: resolved.assets,
          content: resolved.content,
          styleTemplate: resolved.styleTemplate,
        });
        validated = validateHtmlEngineerOutput(fallbackHtml, state.task);
        fallbackApplied = true;
      }
      const { html, validation } = validated;
      const htmlOutput = HtmlOutputSchema.parse({
        html,
        generatedAt: new Date().toISOString(),
        version: 1,
      });

      emit({
        type: "validation",
        summary: forceDeterministic
          ? "QA 布局无法经局部修复收敛，已使用可信课程数据重建紧凑页面。"
          : fallbackApplied
            ? "模型 HTML 未通过合同校验，已使用可信课程数据生成安全回退页面。"
          : "HTML 合同、内容标记与安全预检已通过。",
        data: {
          blockCount: state.task.content.blocks.length,
          fallbackApplied,
          ...(forceDeterministic
            ? { fallbackReason: "quality-stalled" }
            : {}),
          pageId: state.task.content.pageId,
          safetyIssueCount: validation.safety.issues.length,
        },
      });

      return { ...state, htmlOutput, validation };
    },
  });
}

/**
 * 新生成页面使用平台流式画布合同。运行时据此只覆盖根画布尺寸，
 * 旧课程没有此标记，仍按其原始固定尺寸做 contain-fit。
 */
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
  const functionalTemplate = getFunctionalTemplate(
    input.content.functionalTemplateId,
  );
  const styleTemplate = getStyleTemplate(input.visualBrief.styleTemplateId);
  const pageGuidance = input.visualBrief.pageGuidance.find(
    ({ pageId }) => pageId === input.content.pageId,
  );
  const issues: string[] = [];

  if (!functionalTemplate) {
    issues.push(`找不到功能模板 ${input.content.functionalTemplateId}`);
  }
  if (!styleTemplate) {
    issues.push(`找不到样式模板 ${input.visualBrief.styleTemplateId}`);
  }
  if (!pageGuidance) {
    issues.push(`VisualBrief 缺少页面 ${input.content.pageId} 的视觉指导`);
  }

  if (issues.length > 0 || !functionalTemplate || !styleTemplate || !pageGuidance) {
    throw new AiSchemaValidationError(
      `HTML Engineer 输入校验失败：${issues.join("；")}`,
    );
  }

  return {
    ...input,
    assets: input.assets ?? [],
    validationFeedback: input.validationFeedback,
    functionalTemplate,
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
    functionalTemplate: input.functionalTemplate,
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
  const result = await generateTextSafe({
    abortSignal: input.abortSignal,
    capability: "html",
    maxTokens: 8_000,
    messages,
    promptVersion: prompts.version,
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    timeoutMs: getHtmlEngineerTimeoutMs(),
    traceId: input.traceId,
  });

  return result.text;
}


export { validateHtmlEngineerOutput } from "./html-engineer-contract";
export {
  normalizeChoiceInteractionRoot,
  normalizeChoiceRuntimeMarkers,
  normalizeNativeInteractionMarker,
  normalizeRevealCardInteraction,
  normalizeTrustedDslMarkup,
  normalizeVisualPrimitiveMarker,
  removeRedundantRestoredDslMarkup,
} from "./html-engineer-normalizers";
