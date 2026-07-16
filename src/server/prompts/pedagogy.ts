import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const pedagogyPromptDefinition = getSpecialistPromptDefinition("pedagogy");
const systemDefinition = pedagogyPromptDefinition.system;
const userDefinition = pedagogyPromptDefinition.user;

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
