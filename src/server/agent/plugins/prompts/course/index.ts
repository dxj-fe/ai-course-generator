import { PromptIds } from "@/server/agent/ids";
import type { PromptDefinition } from "@/server/agent/types/prompt";

import { MODEL_STEP_PROMPT_CATALOG } from "./model-step-catalog";
import { MODEL_STEP_PROMPT_IDS } from "./model-step-prompt-ids";

const agentPromptDefinitions = [
  {
    id: PromptIds.CourseArchitectSystem,
    description: "课程架构师的职责、Skill 使用方式与课程架构合同。",
    templatePath: "course/architect.system.md",
    variables: ["availableSkills", "skillInstructions"],
  },
  {
    id: PromptIds.CourseDirectorSystem,
    description: "课程主 Agent 在关键语义决策点使用的系统指令。",
    templatePath: "course/director.system.md",
    variables: [],
  },
  {
    id: PromptIds.CoursePageBuilderSystem,
    description: "单页生成 Agent 的职责、自由度与持久化边界。",
    templatePath: "course/page-builder.system.md",
    variables: [
      "availableSkills",
      "pageId",
      "skillInstructions",
    ],
  },
  {
    id: PromptIds.CourseReviewerSystem,
    description: "整课审查 Agent 的证据读取与课程质量判断指令。",
    templatePath: "course/reviewer.system.md",
    variables: [],
  },
] satisfies readonly PromptDefinition[];

const modelStepPromptDefinitions =
  MODEL_STEP_PROMPT_CATALOG.flatMap((entry) => {
    const ids = MODEL_STEP_PROMPT_IDS[entry.id];
    return [
      {
        id: ids.system,
        description: `${entry.modelStepName} 的系统 Prompt。`,
        templatePath: `course/model-steps/${entry.system.fileName}`,
        variables: [],
      },
      {
        id: ids.user,
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
