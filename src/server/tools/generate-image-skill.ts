import { generateImage } from "ai";
import { z } from "zod";

import { getImageModelConfig } from "@/config/env";
import { getImageModel } from "@/server/ai/model-provider";
import {
  inspectRasterImage,
  saveGeneratedAsset,
} from "@/server/assets/generated-asset-store";
import {
  AssetGenerationResultSchema,
  AssetRequestSchema,
  type Asset,
  type AssetFallback,
  type AssetGenerationResult,
} from "@/shared/course-schema";

import type { Skill } from "./types";

export const GenerateImageSkillInputSchema = z
  .object({
    pageId: z.string().min(1).max(80),
    altText: z.string().max(300),
    request: AssetRequestSchema,
  })
  .strict();

type GenerateImageSkillInput = z.infer<typeof GenerateImageSkillInputSchema>;

type GenerateImageSkillDependencies = {
  generate(input: GenerateImageSkillInput, abortSignal?: AbortSignal): Promise<{
    bytes: Uint8Array;
    mediaType: string;
    provider: string;
    model: string;
  }>;
  store(bytes: Uint8Array, mediaType: "image/png" | "image/jpeg" | "image/webp"): Promise<{
    id: string;
    uri: string;
  }>;
};

const defaultDependencies: GenerateImageSkillDependencies = {
  generate: generateWithConfiguredModel,
  store: saveGeneratedAsset,
};

/** 创建可注入依赖的生图 Skill；provider 失败会返回确定性 fallback。 */
export function createGenerateImageSkill(
  dependencies: GenerateImageSkillDependencies = defaultDependencies,
): Skill<GenerateImageSkillInput, AssetGenerationResult> {
  return {
    name: "generateImageAsset",
    description:
      "为 HTML 页面生成一张独立视觉素材。输入必须来自 ImagePromptAgent；失败时返回 CSS/SVG fallback，不生成整页 UI 图片。",
    inputSchema: GenerateImageSkillInputSchema,
    outputSchema: AssetGenerationResultSchema,
    async execute(input, context) {
      const startedAt = Date.now();

      try {
        const generated = await dependencies.generate(input, context.abortSignal);
        const info = inspectRasterImage(generated.bytes, generated.mediaType);

        const warnings =
          input.request.transparentBackground &&
          info.supportsTransparency === false
            ? (["TRANSPARENCY_UNAVAILABLE"] as const)
            : undefined;

        const stored = await dependencies.store(generated.bytes, info.mediaType);
        const asset: Asset = {
          id: stored.id,
          type: domainAssetType(input.request.assetType),
          role: domainAssetRole(input.request.assetType),
          source: "generated",
          status: "ready",
          uri: stored.uri,
          altText: input.altText,
          generationPrompt: input.request.prompt,
          mimeType: info.mediaType,
          dimensions:
            info.width && info.height
              ? { width: info.width, height: info.height }
              : undefined,
          usedByPageIds: [input.pageId],
        };

        return AssetGenerationResultSchema.parse({
          request: input.request,
          status: "ready",
          asset,
          provider: generated.provider,
          model: generated.model,
          durationMs: Date.now() - startedAt,
          warnings,
        });
      } catch (error) {
        return AssetGenerationResultSchema.parse({
          request: input.request,
          status: "fallback",
          fallback: fallbackFor(input.request.assetType),
          durationMs: Date.now() - startedAt,
          errorCode: classifyImageError(error),
        });
      }
    },
  };
}

export const generateImageSkill = createGenerateImageSkill();

async function generateWithConfiguredModel(
  input: GenerateImageSkillInput,
  abortSignal?: AbortSignal,
) {
  const config = getImageModelConfig();
  const result = await generateImage({
    model: getImageModel(),
    prompt: input.request.prompt,
    n: 1,
    size: imageSizeFor(input.request.aspectRatio),
    providerOptions:
      config.providerName === "volcengine-ark"
        ? {
            volcengineArk: {
              sequential_image_generation: "disabled",
              watermark: false,
            },
          }
        : undefined,
    abortSignal,
  });

  return {
    bytes: result.image.uint8Array,
    mediaType: result.image.mediaType,
    provider: config.providerName,
    model: config.modelName,
  };
}

function imageSizeFor(
  aspectRatio: GenerateImageSkillInput["request"]["aspectRatio"],
): `${number}x${number}` {
  const sizes = {
    "1:1": "2048x2048",
    "4:3": "2304x1728",
    "3:4": "1728x2304",
    "16:9": "2560x1440",
  } as const;

  return sizes[aspectRatio];
}

function domainAssetType(kind: GenerateImageSkillInput["request"]["assetType"]): Asset["type"] {
  return kind === "icon"
    ? "icon"
    : kind === "character_sticker"
      ? "illustration"
      : "image";
}

function domainAssetRole(kind: GenerateImageSkillInput["request"]["assetType"]): Asset["role"] {
  return kind === "background"
    ? "background"
    : kind === "texture"
      ? "decorative"
      : "inline";
}

function fallbackFor(
  kind: GenerateImageSkillInput["request"]["assetType"],
): AssetFallback {
  if (kind === "background") {
    return {
      kind: "css-gradient",
      description: "使用 StyleTemplate 语义颜色构建低细节渐变背景。",
    };
  }
  if (kind === "texture") {
    return {
      kind: "css-texture",
      description: "使用重复渐变构建低对比度 CSS 纹理。",
    };
  }
  if (kind === "icon") {
    return {
      kind: "inline-svg",
      description: "使用可信的确定性内联 SVG 图标。",
    };
  }
  return {
    kind: "placeholder",
    description: "保留素材安全区和可访问说明，不阻塞页面正文。",
  };
}

function classifyImageError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/IMAGE_(?:API_KEY|BASE_URL|MODEL_ID)|Missing required environment/i.test(message)) {
    return "IMAGE_MODEL_NOT_CONFIGURED";
  }
  if (/abort/i.test(message)) return "IMAGE_GENERATION_ABORTED";
  if (/transparent|透明/i.test(message)) return "TRANSPARENCY_UNAVAILABLE";
  if (/MIME|格式|签名/i.test(message)) return "INVALID_IMAGE_OUTPUT";
  return "IMAGE_GENERATION_FAILED";
}
