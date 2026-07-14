import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const systemDefinition: PromptTemplateDefinition = {
  name: "image-prompt-system",
  version: "1.0.0",
  role: "system",
  inputContract: [
    "接收 PageContentDSL、当前页视觉指导与服务端 StyleTemplate。",
  ],
  outputContract: [
    "每个 assetSlot 只返回一条创意方向；技术参数和禁止项由代码补齐。",
  ],
  fileName: "image-prompt.system.v1.md",
};

const userDefinition: PromptTemplateDefinition = {
  name: "image-prompt-user",
  version: "1.0.0",
  role: "user",
  inputContract: ["imagePromptInputJson 必须是完整 JSON 值。"],
  outputContract: ["返回与 assetSlots 一一对应的 directions JSON object。"],
  fileName: "image-prompt.user.v1.md",
};

export async function buildImagePromptPrompts(input: unknown) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(systemDefinition),
    loadPromptTemplate(userDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      imagePromptInputJson: JSON.stringify(input),
    }),
  };
}
