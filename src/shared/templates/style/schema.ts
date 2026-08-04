import { z } from "zod";

import { ThemeDensitySchema } from "@/shared/course-schema";

/** 当前支持的核心视觉方向。 */
export const CoreVisualStyleSchema = z.enum([
  "sci-fi",
  "editorial-night",
  "broadside",
  "kids-playful",
  "minimal",
  "nature",
  "blackboard",
  "game-quest",
]);

const HexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "颜色必须使用六位十六进制格式");
const CssValueSchema = z.string().min(1).max(240);

/** 页面背景、表面、文字、品牌色和反馈状态使用的语义颜色。 */
export const StyleColorTokensSchema = z.object({
  background: HexColorSchema,
  surface: HexColorSchema,
  surfaceAlt: HexColorSchema,
  text: HexColorSchema,
  mutedText: HexColorSchema,
  primary: HexColorSchema,
  accent: HexColorSchema,
  border: HexColorSchema,
  success: HexColorSchema,
  warning: HexColorSchema,
  danger: HexColorSchema,
});

/** 跨页面共享的字体、字重、基础字号和正文节奏。 */
export const StyleTypographySchema = z.object({
  headingFont: CssValueSchema,
  bodyFont: CssValueSchema,
  headingWeight: z.number().int().min(400).max(900),
  bodyWeight: z.number().int().min(300).max(700),
  baseFontSize: CssValueSchema,
  bodyLineHeight: z.number().min(1).max(2.5),
});

/** 控制全局间距基线、区块距离和内容最大宽度。 */
export const StyleSpacingSchema = z.object({
  unit: CssValueSchema,
  sectionGap: CssValueSchema,
  cardGap: CssValueSchema,
  contentMaxWidth: CssValueSchema,
});

/** 描述卡片与控件表面的圆角、边框和阴影。 */
export const StyleSurfaceSchema = z.object({
  cardRadius: CssValueSchema,
  controlRadius: CssValueSchema,
  cardBorderWidth: CssValueSchema,
  cardShadow: CssValueSchema,
});

export const DecorationPatternSchema = z.enum([
  "stars",
  "editorial-glow",
  "broadside-grid",
  "bubbles",
  "none",
  "botanical",
  "chalk",
  "quest-grid",
]);
export const DecorationIntensitySchema = z.enum([
  "subtle",
  "moderate",
  "bold",
]);

/** 结构化表达背景纹理、形状语言和装饰强度。 */
export const StyleDecorationSchema = z.object({
  pattern: DecorationPatternSchema,
  backgroundImage: CssValueSchema,
  intensity: DecorationIntensitySchema,
  shapeLanguage: z.string().min(2).max(200),
});

export const MotionIntensitySchema = z.enum(["none", "subtle", "dynamic"]);

/** 动效 Token 包含标准时长、缓动和 reduced-motion 降级值。 */
export const StyleMotionSchema = z.object({
  durationFast: CssValueSchema,
  durationNormal: CssValueSchema,
  easing: CssValueSchema,
  intensity: MotionIntensitySchema,
  reducedMotionDuration: CssValueSchema,
});

/** 为后续图片 Agent 提供风格、构图、背景和负向约束。 */
export const StyleAssetGuidanceSchema = z.object({
  visualStyle: z.string().min(2).max(240),
  composition: z.string().min(2).max(240),
  background: z.string().min(2).max(240),
  avoid: z.array(z.string().min(2).max(160)).min(1).max(10),
});

/**
 * 样式模板是 Theme、搜索 Skill、CSS 转换器和 Gallery 共享的视觉协议。
 * 它只包含视觉语义，不包含具体课程主题或功能模板结构。
 */
export const StyleTemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  name: z.string().min(2).max(80),
  visualStyle: CoreVisualStyleSchema,
  goal: z.string().min(5).max(300),
  colorTokens: StyleColorTokensSchema,
  typography: StyleTypographySchema,
  spacing: StyleSpacingSchema,
  surface: StyleSurfaceSchema,
  decoration: StyleDecorationSchema,
  motion: StyleMotionSchema,
  layoutDensity: ThemeDensitySchema,
  assetGuidance: StyleAssetGuidanceSchema,
  bestFor: z.array(z.string().min(2).max(160)).min(1).max(12),
  avoidFor: z.array(z.string().min(2).max(160)).min(1).max(12),
  keywords: z.array(z.string().min(1).max(40)).min(2).max(20),
});

export type CoreVisualStyle = z.infer<typeof CoreVisualStyleSchema>;
export type StyleColorTokens = z.infer<typeof StyleColorTokensSchema>;
export type StyleTypography = z.infer<typeof StyleTypographySchema>;
export type StyleSpacing = z.infer<typeof StyleSpacingSchema>;
export type StyleSurface = z.infer<typeof StyleSurfaceSchema>;
export type StyleDecoration = z.infer<typeof StyleDecorationSchema>;
export type StyleMotion = z.infer<typeof StyleMotionSchema>;
export type StyleAssetGuidance = z.infer<typeof StyleAssetGuidanceSchema>;
export type StyleTemplate = z.infer<typeof StyleTemplateSchema>;
