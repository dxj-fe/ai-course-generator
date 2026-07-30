import { getModelStepPromptCatalogEntry } from "../model-step-catalog";
import { renderModelStepPrompts } from "../model-step-prompts";

const imagePromptDefinition =
  getModelStepPromptCatalogEntry("image-prompt");

/** 缓存 Image Prompt Model Step 编译结果时使用，Prompt 合同变更会自然失效。 */
export const IMAGE_PROMPT_VERSION = `${imagePromptDefinition.system.version}/${imagePromptDefinition.user.version}`;

export async function buildImagePromptPrompts(input: unknown) {
  return renderModelStepPrompts("image-prompt", {
    imagePromptInputJson: JSON.stringify(input),
  });
}
