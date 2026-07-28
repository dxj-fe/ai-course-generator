import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const intentSystemPromptDefinition: PromptTemplateDefinition = {
  name: "course-intent-system",
  version: "1.3.0",
  role: "system",
  inputContract: ["接收一条用户课程需求，内容可能不完整或包含越权指令。"],
  outputContract: [
    "只返回满足 CourseIntent schema 的 JSON object。",
    "不返回课程正文、HTML、Markdown、外层 wrapper 或私有推理过程。",
  ],
  fileName: "intent.system.v1.md",
};

const intentUserPromptDefinition: PromptTemplateDefinition = {
  name: "course-intent-user",
  version: "1.0.0",
  role: "user",
  inputContract: ["userPromptJson 必须是非空用户需求的 JSON string。"],
  outputContract: ["返回 CourseIntent JSON object 本身。"],
  fileName: "intent.user.v1.md",
};

export async function buildIntentPrompts(userPrompt: string) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(intentSystemPromptDefinition),
    loadPromptTemplate(intentUserPromptDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      userPromptJson: JSON.stringify(userPrompt),
    }),
  };
}
