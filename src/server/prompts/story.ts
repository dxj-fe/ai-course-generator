import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const storyPromptDefinition = getSpecialistPromptDefinition("story");
const systemDefinition = storyPromptDefinition.system;
const userDefinition = storyPromptDefinition.user;

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
