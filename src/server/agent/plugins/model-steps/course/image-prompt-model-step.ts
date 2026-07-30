import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/infra/ai/client";
import { AiSchemaValidationError } from "@/server/infra/ai/error";
import { buildImagePromptPrompts } from "@/server/agent/plugins/prompts/course/model-steps/image-prompt";
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

import { createModelStep } from "./model-step";
import type {
  ModelStep,
  ModelStepContext,
  ModelStepStateBase,
} from "./types";

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

export type ImagePromptModelStepState = ModelStepStateBase & {
  task: ImagePromptInput;
  requests?: AssetRequest[];
};

export type ImagePromptModelStepDependencies = {
  generateDirections(input: ResolvedImagePromptInput & {
    abortSignal?: AbortSignal;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: ImagePromptModelStepDependencies = {
  generateDirections,
};

/** 把一页素材槽编译为可执行 AssetRequest；没有槽位时不调用模型。 */
export function createImagePromptModelStep(
  dependencies: ImagePromptModelStepDependencies = defaultDependencies,
): ModelStep<ImagePromptModelStepState> {
  return createModelStep({
    name: "image-prompt-model-step",
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
        summary: "图片 Prompt 模型步骤已返回页面素材创意方向。",
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

export function createImagePromptModelStepState(
  input: ImagePromptInput,
): ImagePromptModelStepState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: input,
  };
}

export function runImagePromptModelStep(
  input: ImagePromptInput,
  context: ModelStepContext,
) {
  return createImagePromptModelStep().run(
    createImagePromptModelStepState(input),
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
  if (
    slot.type === "illustration" &&
    (/(?:头像|肖像|吉祥物|表情|贴纸)/u.test(slot.purpose) ||
      (/(?:角色|人物|单人形象|单个形象)/u.test(slot.purpose) &&
        !/(?:场景|过程|流程|时间线|地图|关系|结构|对比|情节|概念|图示|总结|全景|环境|实验|示意)/u.test(
          slot.purpose,
        )))
  ) {
    return "character_sticker";
  }
  return "background";
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
    ? "Use a real transparent background with a clean complete silhouette. If alpha transparency is unavailable, use one clean low-detail solid backdrop from the course palette; never draw a checkerboard, transparency grid, cutout preview, or fake alpha pattern into the pixels."
    : "Opaque image background suitable for HTML composition.";
  const safeArea =
    kind === "background"
      ? [
          `Reserve the ${safeAreaPosition} 40% as calm, low-detail negative space that is a natural, continuous part of the scene.`,
          "Do not draw a panel, card, sheet of paper, label, sign, frame, text box, placeholder, or UI container in that negative space; HTML content will be overlaid separately.",
        ].join(" ")
      : "Create only the isolated visual subject; do not add a presentation frame or surrounding layout.";
  const composition =
    kind === "background"
      ? "Create a wide editorial scene illustration with one unmistakable focal subject. Inside the non-safe portion, the focal subject and its immediate context must fill 65–85% of that region; avoid a tiny, distant, icon-like, or isolated subject surrounded by unused canvas."
      : kind === "character_sticker"
        ? "Use a medium or medium-close composition. The single complete subject must fill 75–90% of the canvas, with only a narrow even margin; do not reserve blank space for HTML text and do not render the subject as a tiny distant sticker."
        : kind === "icon"
          ? "The icon must fill 75–90% of the square canvas with a clean, immediately recognizable silhouette."
          : "Fill the canvas edge to edge with a seamless, low-contrast texture; do not leave an empty central area.";
  const visualContinuity = [
    "Keep strict visual continuity with the rest of this course:",
    `use the same ${input.styleTemplate.name} rendering technique, line weight, shape language, lighting, material treatment, and controlled palette.`,
    "Keep recurring characters and environments consistent in proportions, facial design, costume, and color; do not introduce a new art style or unrelated palette for this page.",
  ].join(" ");

  return [
    "Generate artwork only, never a course slide or designed page.",
    promptCore.trim(),
    `Asset type: ${kind}. Semantic usage only—do not render this wording: ${slot.purpose}.`,
    `Conceptual visual direction only—do not render this wording: ${input.visualBrief.visualConcept}. Conceptual page focus: ${input.pageGuidance.focalPoint}.`,
    `Style: ${input.styleTemplate.name}; ${input.styleTemplate.goal}.`,
    `Course visual bible: ${input.visualBrief.assetDirection.medium}. Course composition baseline: ${input.visualBrief.assetDirection.composition}.`,
    `This page's composition: ${input.pageGuidance.composition}. Learning purpose of the artwork: ${input.pageGuidance.assetPurpose}.`,
    `Course-specific exclusions: ${input.visualBrief.assetDirection.negativeConstraints.join("; ")}.`,
    visualContinuity,
    composition,
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
