import { renderModelStepPrompts } from "../model-step-prompts";

/** 加载并渲染只负责单页内容语义的版本化 Prompt。 */
export async function buildPageWriterPrompts(input: {
  courseIntent: unknown;
  courseArchitectureContext?: unknown;
  pagePlan: unknown;
  pageWorkerBrief: unknown;
  functionalTemplate: unknown;
  referenceContext?: unknown;
  validationFeedback?: unknown;
}) {
  return renderModelStepPrompts("page-writer", {
    courseIntentJson: JSON.stringify(input.courseIntent),
    courseArchitectureContextJson: JSON.stringify(
      input.courseArchitectureContext ?? null,
    ),
    pagePlanJson: JSON.stringify(input.pagePlan),
    pageWorkerBriefJson: JSON.stringify(input.pageWorkerBrief),
    functionalTemplateJson: JSON.stringify(input.functionalTemplate),
    referenceContextJson: JSON.stringify(input.referenceContext ?? []),
    validationFeedbackJson: JSON.stringify(
      input.validationFeedback ?? null,
    ),
  });
}
