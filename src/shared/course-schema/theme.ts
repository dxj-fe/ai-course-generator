import { z } from "zod";

/** 用有限枚举表达全局信息密度，不约束具体组件间距。 */
export const ThemeDensitySchema = z.enum(["compact", "comfortable", "spacious"]);

/**
 * 跨页面共享的最小 design token 集合。
 * 这里只约束视觉一致性所需语义，不描述组件树或像素坐标。
 */
export const ThemeTokensSchema = z.object({
  colors: z.object({
    primary: z.string().min(1).max(80),
    accent: z.string().min(1).max(80),
    background: z.string().min(1).max(80),
    surface: z.string().min(1).max(80),
    text: z.string().min(1).max(80),
    mutedText: z.string().min(1).max(80),
  }),
  typography: z.object({
    headingFont: z.string().min(1).max(120),
    bodyFont: z.string().min(1).max(120),
  }),
  density: ThemeDensitySchema,
  radius: z.string().min(1).max(40),
});

/** 将样式模板、视觉方向和运行时 tokens 组合成课程主题。 */
export const ThemeSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  styleTemplateId: z.string().min(1).max(80),
  visualDirection: z.string().min(5).max(500),
  tokens: ThemeTokensSchema,
});

export type ThemeDensity = z.infer<typeof ThemeDensitySchema>;
export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
