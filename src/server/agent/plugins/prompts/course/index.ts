import { PromptIds } from "@/server/agent/ids";
import type { PromptDefinition } from "@/server/agent/types/prompt";

import { MODEL_STEP_PROMPT_CATALOG } from "./model-step-catalog";
import { MODEL_STEP_PROMPT_IDS } from "./model-step-prompt-ids";

const agentPromptDefinitions = [
  {
    id: PromptIds.CourseArchitectSystemV1,
    version: 4,
    description: "课程架构师的职责、Skill 使用方式与课程架构合同。",
    templatePath: "course/architect.system.v1.md",
    variables: ["availableSkills", "skillInstructions"],
  },
  {
    id: PromptIds.CourseDirectorSystemV2,
    version: 4,
    description: "课程主 Agent 在关键语义决策点使用的系统指令。",
    templatePath: "course/director.system.v2.md",
    variables: [],
  },
  {
    id: PromptIds.CoursePageBuilderSystemV1,
    version: 1,
    description: "单页生成 Agent 的职责、自由度与持久化边界。",
    templatePath: "course/page-builder.system.v1.md",
    variables: [
      "availableSkills",
      "pageId",
      "skillInstructions",
    ],
  },
  {
    id: PromptIds.CourseReviewerSystemV1,
    version: 4,
    description: "整课审查 Agent 的证据读取与课程质量判断指令。",
    templatePath: "course/reviewer.system.v1.md",
    variables: [],
  },
] satisfies readonly PromptDefinition[];

const modelStepPromptDefinitions =
  MODEL_STEP_PROMPT_CATALOG.flatMap((entry) => {
    const ids = MODEL_STEP_PROMPT_IDS[entry.id];
    return [
      {
        id: ids.system,
        version: majorVersion(entry.system.version),
        description: `${entry.modelStepName} 的系统 Prompt。`,
        templatePath: `course/model-steps/${entry.system.fileName}`,
        variables: [],
      },
      {
        id: ids.user,
        version: majorVersion(entry.user.version),
        description: `${entry.modelStepName} 的用户 Prompt。`,
        templatePath: `course/model-steps/${entry.user.fileName}`,
        variables: entry.templateVariables,
      },
    ] satisfies readonly PromptDefinition[];
  });

export const coursePromptDefinitions = Object.freeze([
  ...agentPromptDefinitions,
  ...modelStepPromptDefinitions,
] satisfies readonly PromptDefinition[]);

function majorVersion(version: string) {
  const value = Number(version.split(".")[0]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Prompt 版本无效：${version}`);
  }
  return value;
}
