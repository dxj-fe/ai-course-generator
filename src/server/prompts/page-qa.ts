import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const systemDefinition: PromptTemplateDefinition = {
  name: "page-qa-system",
  version: "1.0.1",
  role: "system",
  inputContract: [
    "接收 PagePlan、PageContentDSL、HTML、VisualBrief、相邻页面摘要和确定性启发式结果。",
  ],
  outputContract: [
    "只返回六维评分、可定位问题和修复建议，不修改 HTML。",
  ],
  fileName: "page-qa.system.v1.md",
};

const userDefinition: PromptTemplateDefinition = {
  name: "page-qa-user",
  version: "1.0.0",
  role: "user",
  inputContract: ["pageQaInputJson 必须是完整 JSON 值。"],
  outputContract: ["返回 Page QA 语义评估 JSON object 本身。"],
  fileName: "page-qa.user.v1.md",
};

/** 加载只读页面评估 Prompt；最终分数和 shouldRepair 仍由代码计算。 */
export async function buildPageQAPrompts(input: unknown) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(systemDefinition),
    loadPromptTemplate(userDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      pageQaInputJson: JSON.stringify(input),
    }),
  };
}
