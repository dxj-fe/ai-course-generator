import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const coursePlannerSystemPromptDefinition: PromptTemplateDefinition = {
  name: "course-planner-system",
  version: "1.0.0",
  role: "system",
  inputContract: [
    "接收已通过 CourseIntentSchema 的课程意图、功能模板清单和唯一选定的样式模板。",
  ],
  outputContract: [
    "只返回课程概述、学习目标和页面教学语义字段，技术字段由确定性代码补齐。",
  ],
  fileName: "course-planner.system.v1.md",
};

const coursePlannerUserPromptDefinition: PromptTemplateDefinition = {
  name: "course-planner-user",
  version: "1.0.0",
  role: "user",
  inputContract: [
    "courseIntentJson、functionalTemplatesJson 和 styleTemplateJson 必须是 JSON 值。",
  ],
  outputContract: ["返回 Planner 内容草稿 JSON object 本身。"],
  fileName: "course-planner.user.v1.md",
};

export type BuildCoursePlannerPromptsInput = {
  courseIntent: unknown;
  functionalTemplates: unknown;
  styleTemplate: unknown;
};

/** 加载并渲染 CoursePlannerAgent 的版本化 Prompt。 */
export async function buildCoursePlannerPrompts(
  input: BuildCoursePlannerPromptsInput,
) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(coursePlannerSystemPromptDefinition),
    loadPromptTemplate(coursePlannerUserPromptDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      courseIntentJson: JSON.stringify(input.courseIntent),
      functionalTemplatesJson: JSON.stringify(input.functionalTemplates),
      styleTemplateJson: JSON.stringify(input.styleTemplate),
    }),
  };
}
