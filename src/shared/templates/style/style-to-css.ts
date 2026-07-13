import { ThemeSchema, type Theme } from "@/shared/course-schema";

import type { StyleTemplate } from "./schema";

export type CourseCssVariableName = `--course-${string}`;
export type CourseCssVariables = Record<CourseCssVariableName, string>;

/**
 * 把结构化样式 Token 转成稳定的 CSS Variables。
 * 所有模板执行同一段映射，保证变量集合和输出顺序完全一致。
 */
export function styleTemplateToCssVariables(
  template: StyleTemplate,
): CourseCssVariables {
  return {
    "--course-color-background": template.colorTokens.background,
    "--course-color-surface": template.colorTokens.surface,
    "--course-color-surface-alt": template.colorTokens.surfaceAlt,
    "--course-color-text": template.colorTokens.text,
    "--course-color-muted": template.colorTokens.mutedText,
    "--course-color-primary": template.colorTokens.primary,
    "--course-color-accent": template.colorTokens.accent,
    "--course-color-border": template.colorTokens.border,
    "--course-color-success": template.colorTokens.success,
    "--course-color-warning": template.colorTokens.warning,
    "--course-color-danger": template.colorTokens.danger,
    "--course-font-heading": template.typography.headingFont,
    "--course-font-body": template.typography.bodyFont,
    "--course-font-weight-heading": String(template.typography.headingWeight),
    "--course-font-weight-body": String(template.typography.bodyWeight),
    "--course-font-size-base": template.typography.baseFontSize,
    "--course-line-height-body": String(template.typography.bodyLineHeight),
    "--course-spacing-unit": template.spacing.unit,
    "--course-spacing-section": template.spacing.sectionGap,
    "--course-spacing-card": template.spacing.cardGap,
    "--course-content-max-width": template.spacing.contentMaxWidth,
    "--course-radius-card": template.surface.cardRadius,
    "--course-radius-control": template.surface.controlRadius,
    "--course-border-width-card": template.surface.cardBorderWidth,
    "--course-shadow-card": template.surface.cardShadow,
    "--course-decoration-background": template.decoration.backgroundImage,
    "--course-decoration-intensity": template.decoration.intensity,
    "--course-motion-duration-fast": template.motion.durationFast,
    "--course-motion-duration-normal": template.motion.durationNormal,
    "--course-motion-easing": template.motion.easing,
    "--course-motion-intensity": template.motion.intensity,
    "--course-motion-reduced-duration": template.motion.reducedMotionDuration,
    "--course-layout-density": template.layoutDensity,
  };
}

/** 把变量对象序列化为可直接注入预览或生成 HTML 的 CSS 文本。 */
export function styleTemplateToCssText(
  template: StyleTemplate,
  selector = ":root",
) {
  const declarations = Object.entries(styleTemplateToCssVariables(template))
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");

  return `${selector} {\n${declarations}\n}`;
}

/**
 * 将完整 StyleTemplate 映射为 Day 07 CourseSchema 使用的精简 Theme。
 * 映射集中在适配器中，避免 Agent 自行猜测两套协议如何对应。
 */
export function styleTemplateToTheme(template: StyleTemplate): Theme {
  return ThemeSchema.parse({
    id: `theme-${template.id}`,
    name: template.name,
    styleTemplateId: template.id,
    visualDirection: `${template.goal} 素材建议：${template.assetGuidance.visualStyle}`,
    tokens: {
      colors: {
        primary: template.colorTokens.primary,
        accent: template.colorTokens.accent,
        background: template.colorTokens.background,
        surface: template.colorTokens.surface,
        text: template.colorTokens.text,
        mutedText: template.colorTokens.mutedText,
      },
      typography: {
        headingFont: template.typography.headingFont,
        bodyFont: template.typography.bodyFont,
      },
      density: template.layoutDensity,
      radius: template.surface.cardRadius,
    },
  });
}
