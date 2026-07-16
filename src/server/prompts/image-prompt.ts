import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const imagePromptDefinition = getSpecialistPromptDefinition("image-prompt");
const systemDefinition = imagePromptDefinition.system;
const userDefinition = imagePromptDefinition.user;

/** 缓存 ImagePromptAgent 编译结果时使用，Prompt 合同变更会自然失效。 */
export const IMAGE_PROMPT_VERSION = `${systemDefinition.version}/${userDefinition.version}`;

export async function buildImagePromptPrompts(input: unknown) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(systemDefinition),
    loadPromptTemplate(userDefinition),
  ]);

  return {
    version: IMAGE_PROMPT_VERSION,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      imagePromptInputJson: JSON.stringify(input),
    }),
  };
}
