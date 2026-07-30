import { renderModelStepPrompts } from "../model-step-prompts";

/** 加载并渲染 Visual Brief Model Step 的版本化 Prompt。 */
export async function buildVisualDirectorPrompts(input: {
  courseIntent: unknown;
  coursePlan: unknown;
  pageCount: number;
  pedagogyPlan: unknown;
  storyArc: unknown;
  styleTemplate: unknown;
}) {
  return renderModelStepPrompts("visual", {
    courseIntentJson: JSON.stringify(input.courseIntent),
    coursePlanJson: JSON.stringify(input.coursePlan),
    pageCount: JSON.stringify(input.pageCount),
    pedagogyPlanJson: JSON.stringify(input.pedagogyPlan),
    storyArcJson: JSON.stringify(input.storyArc),
    styleTemplateJson: JSON.stringify(input.styleTemplate),
  });
}
