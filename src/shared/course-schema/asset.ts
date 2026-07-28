import { z } from "zod";

/** 限定当前课程系统支持的视觉素材类型。 */
export const AssetTypeSchema = z.enum(["image", "illustration", "icon"]);

/** 记录素材来源，以便复现、授权检查和缓存策略选择。 */
export const AssetSourceSchema = z.enum(["generated", "uploaded", "library"]);

/** 描述素材是否仍在规划、已经可用或生成失败。 */
export const AssetStatusSchema = z.enum(["planned", "ready", "failed"]);

/** 表达素材在页面中的语义角色，而不是具体 CSS 布局。 */
export const AssetRoleSchema = z.enum([
  "hero",
  "background",
  "inline",
  "decorative",
]);

/** ImagePromptAgent 使用的四类生产素材，不与领域层的媒介 type 混用。 */
export const GeneratedAssetKindSchema = z.enum([
  "background",
  "character_sticker",
  "icon",
  "texture",
]);

export const AssetAspectRatioSchema = z.enum(["1:1", "4:3", "3:4", "16:9"]);

export const AssetSafeAreaSchema = z
  .object({
    position: z.enum(["left", "right", "top", "bottom", "center", "none"]),
    coveragePercent: z.number().int().min(0).max(80),
    description: z.string().min(2).max(240),
  })
  .strict();

/** 从一个 DSL assetSlot 编译出的可执行生图请求。 */
export const AssetRequestSchema = z
  .object({
    assetSlotId: z.string().regex(/^asset-slot-[0-9]{2}$/),
    assetType: GeneratedAssetKindSchema,
    usage: z.string().min(2).max(300),
    prompt: z.string().min(20).max(1_800),
    transparentBackground: z.boolean(),
    safeArea: AssetSafeAreaSchema,
    aspectRatio: AssetAspectRatioSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (
      ["character_sticker", "icon"].includes(request.assetType) &&
      !request.transparentBackground
    ) {
      context.addIssue({
        code: "custom",
        message: "角色贴纸和图标必须请求透明背景",
        path: ["transparentBackground"],
      });
    }

    if (
      request.assetType === "background" &&
      request.safeArea.position === "none"
    ) {
      context.addIssue({
        code: "custom",
        message: "背景素材必须声明 HTML 文本安全区",
        path: ["safeArea", "position"],
      });
    }
  });

export const AssetFallbackSchema = z
  .object({
    kind: z.enum([
      "css-gradient",
      "css-texture",
      "inline-svg",
      "placeholder",
    ]),
    description: z.string().min(2).max(300),
  })
  .strict();

export const AssetGenerationWarningSchema = z.enum([
  "TRANSPARENCY_UNAVAILABLE",
]);

/**
 * 可被多个页面复用的视觉素材协议。
 * 页面只保存 assetId，素材地址和生成元数据由这里集中管理。
 */
export const AssetSchema = z
  .object({
    id: z.string().min(1).max(80),
    type: AssetTypeSchema,
    role: AssetRoleSchema,
    source: AssetSourceSchema,
    status: AssetStatusSchema,
    uri: z.string().min(1).max(2_000).optional(),
    altText: z.string().max(300).optional(),
    generationPrompt: z.string().min(1).max(1_800).optional(),
    mimeType: z.string().min(1).max(100).optional(),
    dimensions: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .optional(),
    usedByPageIds: z.array(z.string().min(1).max(80)),
  })
  .superRefine((asset, context) => {
    // usedByPageIds 是反向索引，重复项没有业务意义。
    if (new Set(asset.usedByPageIds).size !== asset.usedByPageIds.length) {
      context.addIssue({
        code: "custom",
        message: "usedByPageIds 不能包含重复 ID",
        path: ["usedByPageIds"],
      });
    }

    // ready 素材必须已经有可被 HTML 使用的资源地址。
    if (asset.status === "ready" && !asset.uri) {
      context.addIssue({
        code: "custom",
        message: "ready 素材必须包含 uri",
        path: ["uri"],
      });
    }

    // 即使是装饰性素材也要显式提供空 altText，避免遗漏 alt 属性。
    if (asset.status === "ready" && asset.altText === undefined) {
      context.addIssue({
        code: "custom",
        message: "ready 素材必须包含 altText；装饰性素材使用空字符串",
        path: ["altText"],
      });
    }

    // 非装饰性素材需要有实际含义的替代文本，满足无障碍要求。
    if (
      asset.status === "ready" &&
      asset.role !== "decorative" &&
      !asset.altText?.trim()
    ) {
      context.addIssue({
        code: "custom",
        message: "非装饰性 ready 素材必须包含非空 altText",
        path: ["altText"],
      });
    }
  });

/** 生图 Skill 的业务结果；provider 失败通过 fallback 返回，不阻塞 HTML。 */
export const AssetGenerationResultSchema = z
  .object({
    request: AssetRequestSchema,
    status: z.enum(["ready", "fallback"]),
    asset: AssetSchema.optional(),
    fallback: AssetFallbackSchema.optional(),
    provider: z.string().min(1).max(80).optional(),
    model: z.string().min(1).max(160).optional(),
    durationMs: z.number().int().nonnegative(),
    warnings: z.array(AssetGenerationWarningSchema).max(4).optional(),
    errorCode: z.string().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "ready" && !result.asset) {
      context.addIssue({
        code: "custom",
        message: "ready 结果必须包含 Asset",
        path: ["asset"],
      });
    }

    if (result.status === "ready" && result.fallback) {
      context.addIssue({
        code: "custom",
        message: "ready 结果不能同时包含 fallback",
        path: ["fallback"],
      });
    }

    if (result.status === "fallback" && !result.fallback) {
      context.addIssue({
        code: "custom",
        message: "fallback 结果必须包含降级方案",
        path: ["fallback"],
      });
    }


    if (result.status === "fallback" && result.asset) {
      context.addIssue({
        code: "custom",
        message: "fallback 结果不能同时包含 Asset",
        path: ["asset"],
      });
    }
  });

export type AssetType = z.infer<typeof AssetTypeSchema>;
export type AssetSource = z.infer<typeof AssetSourceSchema>;
export type AssetStatus = z.infer<typeof AssetStatusSchema>;
export type AssetRole = z.infer<typeof AssetRoleSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type GeneratedAssetKind = z.infer<typeof GeneratedAssetKindSchema>;
export type AssetAspectRatio = z.infer<typeof AssetAspectRatioSchema>;
export type AssetSafeArea = z.infer<typeof AssetSafeAreaSchema>;
export type AssetRequest = z.infer<typeof AssetRequestSchema>;
export type AssetFallback = z.infer<typeof AssetFallbackSchema>;
export type AssetGenerationWarning = z.infer<
  typeof AssetGenerationWarningSchema
>;
export type AssetGenerationResult = z.infer<typeof AssetGenerationResultSchema>;
