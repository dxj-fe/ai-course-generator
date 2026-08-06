import { renderModelStepPrompts } from "../model-step-prompts";

/** 加载并渲染只负责单页内容语义的版本化 Prompt。 */
export async function buildPageWriterPrompts(input: {
  pageBrief: unknown;
  referenceContext?: unknown;
  validationFeedback?: unknown;
}) {
  return renderModelStepPrompts("page-writer", {
    pageBriefJson: JSON.stringify(input.pageBrief),
    referenceContextJson: JSON.stringify(input.referenceContext ?? []),
    validationFeedbackJson: JSON.stringify(
      input.validationFeedback ?? null,
    ),
  });
}
