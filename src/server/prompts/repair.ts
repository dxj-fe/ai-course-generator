import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const repairPromptDefinition = getSpecialistPromptDefinition("repair");

export async function buildRepairPrompts(input: unknown) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(repairPromptDefinition.system),
    loadPromptTemplate(repairPromptDefinition.user),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      repairInputJson: JSON.stringify(input),
    }),
  };
}
