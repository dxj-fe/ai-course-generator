import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const qaPromptDefinition = getSpecialistPromptDefinition("qa");
const systemDefinition = qaPromptDefinition.system;
const userDefinition = qaPromptDefinition.user;

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
