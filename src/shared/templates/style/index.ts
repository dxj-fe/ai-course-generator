export {
  CoreVisualStyleSchema,
  DecorationIntensitySchema,
  DecorationPatternSchema,
  MotionIntensitySchema,
  StyleAssetGuidanceSchema,
  StyleColorTokensSchema,
  StyleDecorationSchema,
  StyleMotionSchema,
  StyleSpacingSchema,
  StyleSurfaceSchema,
  StyleTemplateSchema,
  StyleTypographySchema,
  type CoreVisualStyle,
  type StyleAssetGuidance,
  type StyleColorTokens,
  type StyleDecoration,
  type StyleMotion,
  type StyleSpacing,
  type StyleSurface,
  type StyleTemplate,
  type StyleTypography,
} from "./schema";
export { styleTemplates } from "./templates";
export {
  getStyleTemplate,
  listStyleTemplates,
  searchStyleTemplates,
  type StyleTemplateMatch,
  type StyleTemplateSearchInput,
} from "./registry";
export {
  styleTemplateToCssText,
  styleTemplateToCssVariables,
  styleTemplateToTheme,
  type CourseCssVariableName,
  type CourseCssVariables,
} from "./style-to-css";
