import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import { buildImagePromptPrompts } from "@/server/prompts/image-prompt";
import {
  AssetRequestSchema,
  type AssetAspectRatio,
  type AssetRequest,
  type GeneratedAssetKind,
  type PageContentAssetSlot,
  type PageContentDSL,
  type VisualBrief,
} from "@/shared/course-schema";
import {
  getStyleTemplate,
  type StyleTemplate,
} from "@/shared/templates/style";

import { createMinimalAgent } from "./core/minimal-agent";
import type {
  Agent,
  AgentRuntimeContext,
  AgentStateBase,
} from "./core/types";

const ImagePromptModelOutputSchema = z
  .object({
    directions: z
      .array(
        z
          .object({
            assetSlotId: z.string().min(1).max(80),
            promptCore: z.string().min(10).max(900),
            safeAreaPosition: z.enum([
              "left",
              "right",
              "top",
              "bottom",
              "center",
              "none",
            ]),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

export type ImagePromptInput = {
  content: PageContentDSL;
  visualBrief: VisualBrief;
};

type ResolvedImagePromptInput = ImagePromptInput & {
  styleTemplate: StyleTemplate;
  pageGuidance: VisualBrief["pageGuidance"][number];
};

export type ImagePromptAgentState = AgentStateBase & {
  task: ImagePromptInput;
  requests?: AssetRequest[];
};

export type ImagePromptAgentDependencies = {
  generateDirections(input: ResolvedImagePromptInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: ImagePromptAgentDependencies = {
  generateDirections,
};

/** 把一页素材槽编译为可执行 AssetRequest；没有槽位时不调用模型。 */
export function createImagePromptAgent(
  dependencies: ImagePromptAgentDependencies = defaultDependencies,
): Agent<ImagePromptAgentState> {
  return createMinimalAgent({
    isComplete: (state) => Boolean(state.requests),
    step: async (state, context, emit) => {
      const resolved = resolveImagePromptInput(state.task);

      if (resolved.content.assetSlots.length === 0) {
        emit({
          type: "validation",
          summary: "当前页面没有素材槽，跳过图片 Prompt 生成。",
          data: { pageId: resolved.content.pageId, requestCount: 0 },
        });
        return { ...state, requests: [] };
      }

      const generated = await dependencies.generateDirections({
        ...resolved,
        abortSignal: context.abortSignal,
        traceId: context.traceId,
      });
      emit({
        type: "model_call",
        summary: "Image Prompt Agent 已返回页面素材创意方向。",
        data: {
          pageId: resolved.content.pageId,
          purpose: "image-prompt-generation",
        },
      });

      const requests = validateImagePromptOutput(generated, resolved);
      emit({
        type: "validation",
        summary: `已生成 ${requests.length} 条无文字页面素材请求。`,
        data: { pageId: resolved.content.pageId, requestCount: requests.length },
      });

      return { ...state, requests };
    },
  });
}

export function createImagePromptAgentState(
  input: ImagePromptInput,
): ImagePromptAgentState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

export function runImagePromptAgent(
  input: ImagePromptInput,
  context: AgentRuntimeContext,
) {
  return createImagePromptAgent().run(
    createImagePromptAgentState(input),
    context,
  );
}

export function resolveImagePromptInput(
  input: ImagePromptInput,
): ResolvedImagePromptInput {
  const styleTemplate = getStyleTemplate(input.visualBrief.styleTemplateId);
  const pageGuidance = input.visualBrief.pageGuidance.find(
    ({ pageId }) => pageId === input.content.pageId,
  );

  if (!styleTemplate || !pageGuidance) {
    throw new AiSchemaValidationError(
      "Image Prompt 输入必须引用真实 StyleTemplate 和当前页面视觉指导。",
    );
  }

  return { ...input, styleTemplate, pageGuidance };
}

export function validateImagePromptOutput(
  output: unknown,
  input: ResolvedImagePromptInput,
) {
  const parsed = ImagePromptModelOutputSchema.safeParse(output);

  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `Image Prompt 输出校验失败：${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const directions = new Map(
    parsed.data.directions.map((direction) => [
      direction.assetSlotId,
      direction,
    ]),
  );
  const slotIds = input.content.assetSlots.map(({ id }) => id);

  if (
    directions.size !== input.content.assetSlots.length ||
    parsed.data.directions.length !== directions.size ||
    [...directions.keys()].some((id) => !slotIds.includes(id))
  ) {
    throw new AiSchemaValidationError(
      "Image Prompt directions 必须无重复地覆盖当前页面全部 assetSlots。",
    );
  }

  return input.content.assetSlots.map((slot) => {
    const direction = directions.get(slot.id);
    if (!direction) {
      throw new AiSchemaValidationError(`缺少素材槽 ${slot.id} 的创意方向。`);
    }

    const assetType = assetKindForSlot(slot);
    const safeAreaPosition =
      assetType === "background"
        ? direction.safeAreaPosition === "none"
          ? "left"
          : direction.safeAreaPosition
        : "none";

    return AssetRequestSchema.parse({
      assetSlotId: slot.id,
      assetType,
      usage: slot.purpose,
      prompt: buildProductionPrompt(
        direction.promptCore,
        assetType,
        safeAreaPosition,
        slot,
        input,
      ),
      transparentBackground: ["character_sticker", "icon"].includes(assetType),
      safeArea: {
        position: safeAreaPosition,
        coveragePercent: assetType === "background" ? 40 : 0,
        description:
          assetType === "background"
            ? `为 HTML 标题和正文保留${safeAreaPosition}侧低细节区域。`
            : "该独立素材不承载 HTML 文本。",
      },
      aspectRatio: aspectRatioForKind(assetType),
    });
  });
}

function assetKindForSlot(slot: PageContentAssetSlot): GeneratedAssetKind {
  if (slot.type === "icon") return "icon";
  if (slot.role === "background" || slot.role === "hero") return "background";
  if (slot.role === "decorative") return "texture";
  return slot.type === "illustration" ? "character_sticker" : "texture";
}

function aspectRatioForKind(kind: GeneratedAssetKind): AssetAspectRatio {
  return kind === "background"
    ? "16:9"
    : kind === "character_sticker"
      ? "3:4"
      : "1:1";
}

function buildProductionPrompt(
  promptCore: string,
  kind: GeneratedAssetKind,
  safeAreaPosition: AssetRequest["safeArea"]["position"],
  slot: PageContentAssetSlot,
  input: ResolvedImagePromptInput,
) {
  const transparency = ["character_sticker", "icon"].includes(kind)
    ? "Transparent background with a clean complete silhouette."
    : "Opaque image background suitable for HTML composition.";
  const safeArea =
    kind === "background"
      ? [
          `Reserve the ${safeAreaPosition} 40% as calm, low-detail negative space that is a natural, continuous part of the scene.`,
          "Do not draw a panel, card, sheet of paper, label, sign, frame, text box, placeholder, or UI container in that negative space; HTML content will be overlaid separately.",
        ].join(" ")
      : "Create only the isolated visual subject; do not add a presentation frame or surrounding layout.";

  return [
    "Generate artwork only, never a course slide or designed page.",
    promptCore.trim(),
    `Asset type: ${kind}. Semantic usage only—do not render this wording: ${slot.purpose}.`,
    `Conceptual visual direction only—do not render this wording: ${input.visualBrief.visualConcept}. Conceptual page focus: ${input.pageGuidance.focalPoint}.`,
    `Style: ${input.styleTemplate.name}; ${input.styleTemplate.goal}.`,
    transparency,
    safeArea,
    "No text or text-like marks may appear in the pixels: no Chinese characters, letters, numbers, formulas, captions, labels, fake writing, gibberish glyphs, logos, watermarks, buttons, cards, navigation, or complete UI layouts.",
  ].join(" ");
}

async function generateDirections(
  input: ResolvedImagePromptInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  },
) {
  const prompts = await buildImagePromptPrompts({
    pageContentDsl: input.content,
    pageGuidance: input.pageGuidance,
    visualBrief: input.visualBrief,
    styleTemplate: input.styleTemplate,
  });

  return generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "image-prompt",
    maxTokens: 2_500,
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: ImagePromptModelOutputSchema,
    schemaDescription:
      "One concise visual direction per HTML asset slot; no whole-page UI image.",
    schemaName: "image_prompt_directions",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    traceId: input.traceId,
  });
}
