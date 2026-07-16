import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const visualPromptDefinition = getSpecialistPromptDefinition("visual");
const systemDefinition = visualPromptDefinition.system;
const userDefinition = visualPromptDefinition.user;

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
