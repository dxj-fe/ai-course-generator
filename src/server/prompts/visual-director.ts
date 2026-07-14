import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const systemDefinition: PromptTemplateDefinition = {
  name: "visual-director-system",
  version: "1.0.1",
  role: "system",
  inputContract: [
    "接收 CourseIntent、CoursePlan、PedagogyPlan、StoryArc 和一个真实 StyleTemplate。",
  ],
  outputContract: ["只返回 VisualBrief 内容草稿 JSON。"],
  fileName: "visual-director.system.v1.md",
};

const userDefinition: PromptTemplateDefinition = {
  name: "visual-director-user",
  version: "1.0.1",
  role: "user",
  inputContract: ["所有输入变量必须是 JSON 值。"],
  outputContract: [
    "pageGuidance 按页面顺序输出，不包含 pageId；不输出 styleTemplateId。",
  ],
  fileName: "visual-director.user.v1.md",
};

/** 加载并渲染 VisualDirectorAgent 的版本化 Prompt。 */
export async function buildVisualDirectorPrompts(input: {
  courseIntent: unknown;
  coursePlan: unknown;
  pageCount: number;
  pedagogyPlan: unknown;
  storyArc: unknown;
  styleTemplate: unknown;
}) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(systemDefinition),
    loadPromptTemplate(userDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      courseIntentJson: JSON.stringify(input.courseIntent),
      coursePlanJson: JSON.stringify(input.coursePlan),
      pageCount: JSON.stringify(input.pageCount),
      pedagogyPlanJson: JSON.stringify(input.pedagogyPlan),
      storyArcJson: JSON.stringify(input.storyArc),
      styleTemplateJson: JSON.stringify(input.styleTemplate),
    }),
  };
}
