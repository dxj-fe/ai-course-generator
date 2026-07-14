import {
  runImagePromptAgent,
  type ImagePromptAgentState,
} from "@/server/agents/image-prompt-agent";
import { createAgentEvent } from "@/server/agents/core/events";
import type {
  AgentEvent,
  AgentRuntimeContext,
} from "@/server/agents/core/types";
import { SkillRegistry } from "@/server/tools/skill-registry";
import {
  generateImageSkill,
  type createGenerateImageSkill,
} from "@/server/tools/generate-image-skill";
import type {
  AssetGenerationResult,
  PageContentDSL,
  VisualBrief,
} from "@/shared/course-schema";

type GenerateImageSkill = ReturnType<typeof createGenerateImageSkill>;

export type ImageAssetWorkflowState = {
  status: "completed" | "failed";
  events: AgentEvent[];
  requests?: NonNullable<ImagePromptAgentState["requests"]>;
  results?: AssetGenerationResult[];
  error?: { code: string; message: string };
};

type ImageAssetWorkflowDependencies = {
  runImagePrompt: typeof runImagePromptAgent;
  imageSkill: GenerateImageSkill;
};

const defaultDependencies: ImageAssetWorkflowDependencies = {
  runImagePrompt: runImagePromptAgent,
  imageSkill: generateImageSkill,
};

/** 先生成结构化请求，再逐项调用生图 Skill；业务 fallback 仍视为页面可继续。 */
export async function runImageAssetWorkflow(
  input: { content: PageContentDSL; visualBrief: VisualBrief },
  context: AgentRuntimeContext,
  dependencies: ImageAssetWorkflowDependencies = defaultDependencies,
): Promise<ImageAssetWorkflowState> {
  const promptState = await dependencies.runImagePrompt(input, context);
  const events = [...promptState.events];

  if (promptState.status !== "completed" || !promptState.requests) {
    return {
      status: "failed",
      events,
      error: {
        code: promptState.error?.code ?? "IMAGE_PROMPT_FAILED",
        message: promptState.error?.message ?? "Image Prompt Agent 未生成有效请求。",
      },
    };
  }

  const registry = new SkillRegistry().register(dependencies.imageSkill);
  const results: AssetGenerationResult[] = [];

  for (const request of promptState.requests) {
    const slot = input.content.assetSlots.find(
      ({ id }) => id === request.assetSlotId,
    );
    if (!slot) {
      return {
        status: "failed",
        events,
        requests: promptState.requests,
        error: {
          code: "ASSET_SLOT_NOT_FOUND",
          message: `素材请求引用了不存在的槽位 ${request.assetSlotId}。`,
        },
      };
    }

    const result = await registry.execute<AssetGenerationResult>(
      dependencies.imageSkill.name,
      {
        pageId: input.content.pageId,
        altText: slot.role === "decorative" ? "" : slot.altTextGuidance,
        request,
      },
      context,
    );
    results.push(result);
    events.push(
      createAgentEvent(
        {
          type: "tool_call",
          summary:
            result.status === "ready"
              ? `${request.assetSlotId} 图片素材已生成。`
              : `${request.assetSlotId} 生图失败，已启用 ${result.fallback?.kind}。`,
          data: {
            assetSlotId: request.assetSlotId,
            assetType: request.assetType,
            resultStatus: result.status,
            resultUri: result.asset?.uri ?? null,
            errorCode: result.errorCode ?? null,
          },
        },
        context,
        events.length + 1,
        2,
      ),
    );
  }

  return {
    status: "completed",
    events,
    requests: promptState.requests,
    results,
  };
}
