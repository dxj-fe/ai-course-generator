import { createHash } from "node:crypto";

import { getAgentSystem } from "@/server/setup/agent";

import {
  type ModelStepPromptId,
} from "./model-step-catalog";
import { MODEL_STEP_PROMPT_IDS } from "./model-step-prompt-ids";

/**
 * Model Step 与顶层 Agent 共用 Prompt Registry。
 * 这里仅维护 system/user 配对，并以实际 Prompt 内容指纹作为缓存失效依据。
 */
export async function renderModelStepPrompts(
  id: ModelStepPromptId,
  variables: Readonly<Record<string, string>>,
) {
  const promptIds = MODEL_STEP_PROMPT_IDS[id];
  const agentSystem = await getAgentSystem();
  const [systemPrompt, userPrompt] = await Promise.all([
    agentSystem.prompts.render(promptIds.system, {}),
    agentSystem.prompts.render(promptIds.user, variables),
  ]);

  return {
    fingerprint: createHash("sha256")
      .update(systemPrompt)
      .update("\0")
      .update(userPrompt)
      .digest("hex"),
    systemPrompt,
    userPrompt,
  };
}
