import type {
  CourseArchitecture,
  CourseCreationBrief,
} from "@/shared/course-schema";
import {
  getStyleTemplate,
  searchStyleTemplates,
  type StyleTemplateMatch,
} from "@/shared/templates/style";

export const COURSE_SLIDE_CANVAS = Object.freeze({
  width: 1920,
  height: 1080,
  aspectRatio: "16:9",
});

/**
 * 为所有 Page Creator 确定同一组课程级视觉参考。只预加载紧凑 token；
 * 完整 frontend-slides 配方由 Agent 按精确路径渐进读取。
 */
export function buildCourseVisualReferences(input: {
  architecture: CourseArchitecture;
  creationBrief: CourseCreationBrief;
}) {
  const { blueprint, coursePack } = input.architecture;
  const query = [
    coursePack.topic,
    blueprint.title,
    blueprint.courseRules.tone,
    blueprint.courseRules.visualDirection,
  ].join("；");
  const matches = searchStyleTemplates({
    query,
    audience: input.creationBrief.audience,
    visualStyle: blueprint.courseRules.visualStyle,
    limit: 3,
  });
  const explicit = getStyleTemplate(
    blueprint.courseRules.styleTemplateId,
  );
  const ordered = explicit
    ? [
        {
          template: explicit,
          reason: "Course Lead 已明确选择该课程级视觉参考。",
        } as Pick<StyleTemplateMatch, "template" | "reason">,
        ...matches.filter(({ template }) => template.id !== explicit.id),
      ]
    : matches;
  const [primary, ...alternatives] = ordered.slice(0, 3);

  return {
    canvas: COURSE_SLIDE_CANVAS,
    courseVisualThesis: blueprint.courseRules.visualDirection,
    primary: primary ? summarize(primary) : undefined,
    alternatives: alternatives.map(summarize),
    usage:
      "主参考只约束整课的字体气质、色彩关系、形状语言和节奏，不是 DSL 或布局模板。首次编辑可直接使用紧凑 token；只有需要更深的构图语法时才读取 recipePath。每页仍应围绕自己的 visualDesign 自主构图，不复制示例内容。",
  };
}

function summarize(
  match: Pick<StyleTemplateMatch, "template" | "reason">,
) {
  const { template } = match;
  return {
    id: template.id,
    name: template.name,
    reason: match.reason,
    recipePath: template.profile.recipePath,
    goal: template.goal,
    density: template.layoutDensity,
    colors: template.colorTokens,
    typography: template.typography,
    shapeLanguage: template.decoration.shapeLanguage,
    motion: template.motion,
    assetGuidance: template.assetGuidance,
    avoid: template.avoidFor,
  };
}
