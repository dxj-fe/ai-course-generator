import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const systemDefinition: PromptTemplateDefinition = {
  name: "pedagogy-system",
  version: "1.0.0",
  role: "system",
  inputContract: ["接收 CourseIntent 和已校验 CoursePlan。"],
  outputContract: ["只返回 PedagogyPlan 内容草稿 JSON。"],
  fileName: "pedagogy.system.v1.md",
};

const userDefinition: PromptTemplateDefinition = {
  name: "pedagogy-user",
  version: "1.0.0",
  role: "user",
  inputContract: ["courseIntentJson 和 coursePlanJson 必须是 JSON 值。"],
  outputContract: ["pageGuidance 按页面顺序输出，不包含 pageId。"],
  fileName: "pedagogy.user.v1.md",
};

/** 加载并渲染 PedagogyAgent 的版本化 Prompt。 */
export async function buildPedagogyPrompts(input: {
  courseIntent: unknown;
  coursePlan: unknown;
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
    }),
  };
}
