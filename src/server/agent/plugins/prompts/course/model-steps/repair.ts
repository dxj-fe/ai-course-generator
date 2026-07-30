import { renderModelStepPrompts } from "../model-step-prompts";

export async function buildRepairPrompts(input: unknown) {
  return renderModelStepPrompts("repair", {
    repairInputJson: JSON.stringify(input),
  });
}
