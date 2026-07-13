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
    generationPrompt: z.string().min(1).max(1_000).optional(),
    mimeType: z.string().min(1).max(100).optional(),
    dimensions: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .optional(),
    usedByPageIds: z.array(z.string().min(1).max(80)).max(30),
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

export type AssetType = z.infer<typeof AssetTypeSchema>;
export type AssetSource = z.infer<typeof AssetSourceSchema>;
export type AssetStatus = z.infer<typeof AssetStatusSchema>;
export type AssetRole = z.infer<typeof AssetRoleSchema>;
export type Asset = z.infer<typeof AssetSchema>;
