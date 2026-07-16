import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const pageWriterPromptDefinition =
  getSpecialistPromptDefinition("page-writer");
const systemDefinition = pageWriterPromptDefinition.system;
const userDefinition = pageWriterPromptDefinition.user;

/** 加载并渲染只负责单页内容语义的版本化 Prompt。 */
export async function buildPageWriterPrompts(input: {
  courseIntent: unknown;
  pagePlan: unknown;
  pageWorkerBrief: unknown;
  functionalTemplate: unknown;
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
      pagePlanJson: JSON.stringify(input.pagePlan),
      pageWorkerBriefJson: JSON.stringify(input.pageWorkerBrief),
      functionalTemplateJson: JSON.stringify(input.functionalTemplate),
    }),
  };
}
