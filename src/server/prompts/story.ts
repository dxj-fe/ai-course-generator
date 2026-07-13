import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const systemDefinition: PromptTemplateDefinition = {
  name: "story-system",
  version: "1.0.0",
  role: "system",
  inputContract: ["接收 CourseIntent、CoursePlan 和 PedagogyPlan。"],
  outputContract: ["只返回 StoryArc 内容草稿 JSON。"],
  fileName: "story.system.v1.md",
};

const userDefinition: PromptTemplateDefinition = {
  name: "story-user",
  version: "1.0.0",
  role: "user",
  inputContract: [
    "courseIntentJson、coursePlanJson 和 pedagogyPlanJson 必须是 JSON 值。",
  ],
  outputContract: ["pageBeats 按页面顺序输出，不包含 pageId。"],
  fileName: "story.user.v1.md",
};

/** 加载并渲染 StoryAgent 的版本化 Prompt。 */
export async function buildStoryPrompts(input: {
  courseIntent: unknown;
  coursePlan: unknown;
  pedagogyPlan: unknown;
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
      pedagogyPlanJson: JSON.stringify(input.pedagogyPlan),
    }),
  };
}
