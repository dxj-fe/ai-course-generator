import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const plannerPromptDefinition = getSpecialistPromptDefinition("planner");
const coursePlannerSystemPromptDefinition = plannerPromptDefinition.system;
const coursePlannerUserPromptDefinition = plannerPromptDefinition.user;

export type BuildCoursePlannerPromptsInput = {
  courseIntent: unknown;
  allowedFunctionalTemplates: unknown;
  templateCards: unknown;
  styleTemplateCard: unknown;
  referenceHits?: unknown;
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
      allowedFunctionalTemplatesJson: JSON.stringify(
        input.allowedFunctionalTemplates,
      ),
      templateCardsJson: JSON.stringify(input.templateCards),
      styleTemplateCardJson: JSON.stringify(input.styleTemplateCard),
      referenceHitsJson: JSON.stringify(input.referenceHits ?? []),
    }),
  };
}
