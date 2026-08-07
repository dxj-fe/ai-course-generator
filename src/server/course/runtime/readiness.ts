import { DOUBAO_SEED_2_PRO_MODEL_ID } from "@/config/env";
import { getCourseBrowser } from "@/server/infra/browser/browser-pool";
import { BrowserHarnessUnavailableError } from "@/server/infra/browser/error";
import { getLanguageModelIdentity } from "@/server/infra/ai/model-provider";

export type CourseGenerationRuntimeReadiness = {
  browserVersion: string;
  modelIdentity: string;
};

/**
 * 在任何昂贵 Agent 工作之前验证文本模型与 Browser Harness。
 * 预检失败时 Worker 不领取任务，已有 queued/checkpoint 保持可恢复。
 */
export async function ensureCourseGenerationRuntimeReady(): Promise<CourseGenerationRuntimeReadiness> {
  const modelIdentity = getLanguageModelIdentity("strong");
  const expectedIdentity = `volcengine-ark/${DOUBAO_SEED_2_PRO_MODEL_ID}`;
  if (modelIdentity !== expectedIdentity) {
    throw new Error(
      `生课文本模型必须是 ${expectedIdentity}，当前为 ${modelIdentity}。`,
    );
  }

  const browser = await getCourseBrowser();
  if (!browser.isConnected()) {
    throw new BrowserHarnessUnavailableError(
      new Error("Browser Harness 预检未建立 Chromium 连接。"),
    );
  }
  return {
    browserVersion: browser.version(),
    modelIdentity,
  };
}
