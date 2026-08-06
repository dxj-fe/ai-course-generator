import {
  styleTemplateToCssVariables,
  type CourseCssVariableName,
} from "@/shared/templates/style";
import type { LoadedLocalResource } from "@/server/agent/skill";
import {
  DesignDirectionSchema,
  type AssetGenerationResult,
  type PageContentDSL,
  type VisualBrief,
  type VisualPageGuidance,
} from "@/shared/course-schema";
import type { StyleTemplate } from "@/shared/templates/style";

import { renderModelStepPrompts } from "../model-step-prompts";
import { loadStyleRecipeInspiration } from "./style-recipe-inspiration";

const MAX_INSPIRATION_CHARS = 2_400;
const GENERIC_LAYOUT_NEGATIVE_CONSTRAINT =
  "避免通用后台面板、等权白卡网格和组件展示页";
const HTML_STYLE_TOKEN_NAMES = [
  "--course-color-background",
  "--course-color-text",
  "--course-color-muted",
  "--course-color-primary",
  "--course-color-accent",
  "--course-color-success",
  "--course-color-warning",
  "--course-color-danger",
  "--course-font-heading",
  "--course-font-body",
  "--course-font-weight-heading",
  "--course-font-weight-body",
  "--course-font-size-base",
  "--course-line-height-body",
  "--course-spacing-unit",
  "--course-radius-control",
  "--course-decoration-background",
  "--course-decoration-intensity",
  "--course-motion-duration-fast",
  "--course-motion-duration-normal",
  "--course-motion-easing",
  "--course-motion-intensity",
  "--course-motion-reduced-duration",
] as const satisfies readonly CourseCssVariableName[];

/**
 * HTML 模型只接收当前页真正会用到的内容与设计方向。模板 Registry、整课
 * VisualBrief 和 Skill 原文不再重复注入，避免模型在冲突合同之间寻找最低公分母。
 */
export async function buildHtmlEngineerPrompts(input: {
  pageContentDsl: PageContentDSL;
  styleTemplate: StyleTemplate;
  visualBrief: VisualBrief;
  pageGuidance: VisualPageGuidance;
  assets?: AssetGenerationResult[];
  pageDesignGuidance?: LoadedLocalResource[];
  validationFeedback?: unknown;
}) {
  const styleRecipeInspiration = await loadStyleRecipeInspiration(
    input.styleTemplate,
  );
  const inspirationResources = [
    ...(styleRecipeInspiration ? [styleRecipeInspiration] : []),
    ...(input.pageDesignGuidance ?? []),
  ];

  return renderModelStepPrompts("html-engineer", {
    pageBriefJson: JSON.stringify(toPageBrief(input.pageContentDsl)),
    designDirectionJson: JSON.stringify(
      toDesignDirection({
        ...input,
        pageDesignGuidance: inspirationResources,
      }),
    ),
    styleCssText: styleTemplateToHtmlPromptCssText(input.styleTemplate),
    assetsJson: JSON.stringify(compactAssets(input.assets ?? [])),
    validationFeedbackJson: JSON.stringify(
      input.validationFeedback ?? null,
    ),
  });
}

/**
 * HTML 只需要槽位、可用 URI 与无障碍信息。生图 prompt、Provider、耗时和
 * 缓存元数据会重复数千字符，并把图片构图指令误当成页面布局指令。
 */
function compactAssets(results: AssetGenerationResult[]) {
  return results.map((result) => ({
    assetSlotId: result.request.assetSlotId,
    status: result.status,
    aspectRatio: result.request.aspectRatio,
    safeArea: result.request.safeArea,
    ...(result.asset
      ? {
          asset: {
            uri: result.asset.uri,
            altText: result.asset.altText,
            type: result.asset.type,
            role: result.asset.role,
            mimeType: result.asset.mimeType,
            dimensions: result.asset.dimensions,
          },
        }
      : {}),
    ...(result.fallback ? { fallback: result.fallback } : {}),
  }));
}

function toPageBrief(content: PageContentDSL) {
  return {
    pageId: content.pageId,
    title: content.title,
    narration: content.narration,
    blocks: content.blocks,
    interaction: content.interaction,
    assetSlots: content.assetSlots,
  };
}

function toDesignDirection(input: {
  styleTemplate: StyleTemplate;
  visualBrief: VisualBrief;
  pageGuidance: VisualPageGuidance;
  pageDesignGuidance?: LoadedLocalResource[];
}) {
  const style = input.styleTemplate;
  return DesignDirectionSchema.parse({
    courseThesis: input.visualBrief.visualConcept,
    globalGuardrails: {
      layoutPrinciples: input.visualBrief.layoutPrinciples.slice(0, 3),
      typographyGuidance: input.visualBrief.typographyGuidance,
      colorUsage: input.visualBrief.colorUsage,
      assetDirection: {
        medium: input.visualBrief.assetDirection.medium,
        composition: input.visualBrief.assetDirection.composition,
      },
      motionGuidance: input.visualBrief.motionGuidance,
      accessibilityRules: input.visualBrief.accessibilityRules.slice(0, 4),
      negativeConstraints: [
        GENERIC_LAYOUT_NEGATIVE_CONSTRAINT,
        ...input.visualBrief.assetDirection.negativeConstraints,
      ]
        .filter((constraint, index, constraints) =>
          constraints.indexOf(constraint) === index,
        )
        .slice(0, 6),
    },
    page: {
      theme: input.pageGuidance.theme,
      proofGoal: input.pageGuidance.focalPoint,
      composition: input.pageGuidance.composition,
      graphicMotif: input.pageGuidance.graphicMotif,
      assetPurpose: input.pageGuidance.assetPurpose,
    },
    styleReference: {
      goal: style.goal,
      motif: style.decoration.shapeLanguage,
    },
    inspirationNotes: compactInspiration(
      input.pageDesignGuidance ?? [],
    ),
  });
}

/**
 * HTML 创作只接收视觉角色与基础节奏，不注入卡片表面或页面密度实现 Token。
 * 完整 StyleTemplate CSS 合同仍由共享 Registry 保留给其他消费者。
 */
function styleTemplateToHtmlPromptCssText(style: StyleTemplate) {
  const variables = styleTemplateToCssVariables(style);
  const declarations = HTML_STYLE_TOKEN_NAMES.map(
    (name) => `  ${name}: ${variables[name]};`,
  ).join("\n");

  return `:root {\n${declarations}\n}`;
}

function compactInspiration(resources: LoadedLocalResource[]) {
  let remaining = MAX_INSPIRATION_CHARS;
  return resources.flatMap(({ logicalPath, content }) => {
    if (remaining <= 0) return [];
    const normalized = content.replace(/\s+/g, " ").trim();
    if (!normalized) return [];
    const excerpt = normalized.slice(0, remaining);
    remaining -= excerpt.length;
    return [{ source: logicalPath, note: excerpt }];
  });
}
