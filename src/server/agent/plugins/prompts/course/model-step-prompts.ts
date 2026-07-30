import { getAgentSystem } from "@/server/setup/agent";

import {
  getModelStepPromptCatalogEntry,
  type ModelStepPromptId,
} from "./model-step-catalog";
import { MODEL_STEP_PROMPT_IDS } from "./model-step-prompt-ids";

/**
 * Model Step 与顶层 Agent 共用 Prompt Registry。
 * 这里仅维护 system/user 配对和版本展示，不再自行读取文件或持有第二套缓存。
 */
export async function renderModelStepPrompts(
  id: ModelStepPromptId,
  variables: Readonly<Record<string, string>>,
) {
  const definition = getModelStepPromptCatalogEntry(id);
  const promptIds = MODEL_STEP_PROMPT_IDS[id];
  const agentSystem = await getAgentSystem();
  const [systemPrompt, userPrompt] = await Promise.all([
    agentSystem.prompts.render(promptIds.system, {}),
    agentSystem.prompts.render(promptIds.user, variables),
  ]);

  return {
    version: `${definition.system.version}/${definition.user.version}`,
    systemPrompt,
    userPrompt,
  };
}
