import { renderModelStepPrompts } from "../model-step-prompts";

/** 加载并渲染 Pedagogy Model Step 的版本化 Prompt。 */
export async function buildPedagogyPrompts(input: {
  courseIntent: unknown;
  coursePlan: unknown;
}) {
  return renderModelStepPrompts("pedagogy", {
    courseIntentJson: JSON.stringify(input.courseIntent),
    coursePlanJson: JSON.stringify(input.coursePlan),
  });
}
