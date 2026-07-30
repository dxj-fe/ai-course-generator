import { renderModelStepPrompts } from "../model-step-prompts";

/** 加载并渲染 Story Model Step 的版本化 Prompt。 */
export async function buildStoryPrompts(input: {
  courseIntent: unknown;
  coursePlan: unknown;
  pedagogyPlan: unknown;
}) {
  return renderModelStepPrompts("story", {
    courseIntentJson: JSON.stringify(input.courseIntent),
    coursePlanJson: JSON.stringify(input.coursePlan),
    pedagogyPlanJson: JSON.stringify(input.pedagogyPlan),
  });
}
