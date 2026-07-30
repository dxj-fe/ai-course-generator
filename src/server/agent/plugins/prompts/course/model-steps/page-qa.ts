import { renderModelStepPrompts } from "../model-step-prompts";

/** 加载只读页面评估 Prompt；最终分数和 shouldRepair 仍由代码计算。 */
export async function buildPageQAPrompts(input: unknown) {
  return renderModelStepPrompts("qa", {
    pageQaInputJson: JSON.stringify(input),
  });
}
