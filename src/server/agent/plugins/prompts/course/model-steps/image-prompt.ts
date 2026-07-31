import { renderModelStepPrompts } from "../model-step-prompts";

export async function buildImagePromptPrompts(input: unknown) {
  return renderModelStepPrompts("image-prompt", {
    imagePromptInputJson: JSON.stringify(input),
  });
}
