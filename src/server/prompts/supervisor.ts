import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const supervisorSystemPromptDefinition: PromptTemplateDefinition = {
  name: "course-supervisor-system",
  version: "1.0.0",
  role: "system",
  inputContract: [
    "接收压缩后的课程状态、可用节点、最近失败和持久化执行预算。",
  ],
  outputContract: [
    "只返回满足 SupervisorDecision schema 的 JSON object。",
    "不生成课程正文、HTML、Prompt 或私有推理过程。",
  ],
  fileName: "supervisor.system.v1.md",
};

const supervisorUserPromptDefinition: PromptTemplateDefinition = {
  name: "course-supervisor-user",
  version: "1.0.0",
  role: "user",
  inputContract: ["supervisorInputJson 必须是经过压缩和清洗的 JSON string。"],
  outputContract: ["返回 SupervisorDecision JSON object 本身。"],
  fileName: "supervisor.user.v1.md",
};

export async function buildSupervisorPrompts(input: unknown) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(supervisorSystemPromptDefinition),
    loadPromptTemplate(supervisorUserPromptDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      supervisorInputJson: JSON.stringify(input),
    }),
  };
}
