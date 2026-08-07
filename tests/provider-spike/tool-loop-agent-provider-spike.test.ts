import { tool } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { getLanguageModel } from "../../src/server/infra/ai/model-provider";
import {
  AgentRunner,
  type PersistedAgentTerminal,
} from "../../src/server/agent/runtime/runner";

const providerConfigured = Boolean(process.env.ARK_API_KEY);
const spikeEnabled =
  process.env.RUN_AGENT_PROVIDER_SPIKE === "1" &&
  providerConfigured;

describe.runIf(spikeEnabled)("ToolLoopAgent Provider Spike", () => {
  it(
    "真实 Provider 能完成六次工具调用、一次可恢复错误和引用式大产物交接",
    async () => {
      let inspected = false;
      let probeAttempts = 0;
      let artifactLoaded = false;
      let contractVerified = false;
      let persisted:
        | PersistedAgentTerminal<{ artifactId: string }>
        | null = null;
      const callOrder: string[] = [];
      const tools = {
        inspect_brief: tool({
          description: "读取并确认测试任务，只传入一句简短观察。",
          inputSchema: z.object({
            observation: z.string().min(1).max(120),
          }),
          execute: ({ observation }) => {
            callOrder.push("inspect_brief");
            inspected = true;
            return {
              committed: false,
              data: { observation },
              ok: true as const,
              summary: "已检查测试任务。",
              terminal: false,
            };
          },
        }),
        unstable_probe: tool({
          description:
            "模拟一次可恢复工具错误；第一次会失败，收到反馈后必须再调用一次。",
          inputSchema: z.object({
            attempt: z.number().int().min(1).max(2),
          }),
          execute: ({ attempt }) => {
            callOrder.push(`unstable_probe:${attempt}`);
            probeAttempts += 1;
            if (probeAttempts === 1) {
              return {
                code: "PROBE_TEMPORARY_FAILURE",
                committed: false as const,
                feedback: ["把 attempt 改为 2，再调用 unstable_probe。"],
                message: "模拟的临时工具错误。",
                ok: false as const,
                retryable: true,
                terminal: false as const,
              };
            }
            return {
              committed: false,
              data: { recovered: true },
              ok: true as const,
              summary: "临时工具错误已恢复。",
              terminal: false,
            };
          },
        }),
        load_large_artifact_ref: tool({
          description:
            "读取大产物的引用和摘要，不把 HTML 正文放进模型上下文。",
          inputSchema: z.object({
            artifactId: z.literal("provider-spike-large-artifact"),
          }),
          execute: ({ artifactId }) => {
            callOrder.push("load_large_artifact_ref");
            artifactLoaded = true;
            return {
              committed: false,
              data: {
                artifactId,
                contentHash: "a".repeat(64),
                summary: "已读取 180KB HTML 的受控摘要。",
              },
              ok: true as const,
              summary: "大产物引用已读取。",
              terminal: false,
            };
          },
        }),
        verify_contract: tool({
          description: "确认前面的检查、错误恢复和 Artifact 引用都已完成。",
          inputSchema: z.object({
            ready: z.literal(true),
          }),
          execute: () => {
            callOrder.push("verify_contract");
            if (!inspected || probeAttempts < 2 || !artifactLoaded) {
              return {
                code: "SPIKE_STEPS_INCOMPLETE",
                committed: false as const,
                feedback: ["按顺序完成尚未执行的工具。"],
                message: "Provider spike 步骤尚未完成。",
                ok: false as const,
                retryable: true,
                terminal: false as const,
              };
            }
            contractVerified = true;
            return {
              committed: false,
              ok: true as const,
              summary: "多步工具合同已确认。",
              terminal: false,
            };
          },
        }),
        submit_spike: tool({
          description: "检查完成后提交测试 Artifact 引用。",
          inputSchema: z.object({
            artifactId: z.literal("provider-spike-artifact"),
          }),
          execute: ({ artifactId }) => {
            callOrder.push("submit_spike");
            if (!contractVerified) {
              return {
                code: "INSPECTION_REQUIRED",
                committed: false as const,
                feedback: ["先完成 verify_contract。"],
                message: "尚未完成多步合同检查。",
                ok: false as const,
                retryable: true,
                terminal: false as const,
              };
            }

            persisted = {
              status: "submitted",
              submission: { artifactId },
            };
            return {
              committed: true as const,
              data: { artifactId },
              ok: true as const,
              summary: "Provider spike 已提交。",
              terminal: true as const,
            };
          },
        }),
      };
      const runner = new AgentRunner<
        typeof tools,
        { artifactId: string }
      >({
        terminalStateLoader: {
          load: async () => persisted,
          parse: (value) =>
            isPersistedSpikeTerminal(value) ? value : null,
        },
      });

      const result = await runner.run({
        authorizeToolCall: ({ toolName }) => toolName in tools,
        budget: {
          maxOutputTokens: 600,
          maxSteps: 8,
          maxToolCalls: 8,
          timeout: {
            stepMs: 30_000,
            toolMs: 10_000,
            totalMs: 60_000,
          },
        },
        instructions: [
          "你正在做工具调用协议测试。",
          "严格按当前唯一可用工具推进。",
          "unstable_probe 第一次会返回可恢复错误，收到反馈后用 attempt=2 重试。",
          "大 HTML 只能通过 Artifact 引用交接，不能要求原文。",
          "不得只返回普通文本。",
        ].join("\n"),
        model: getLanguageModel("strong"),
        prepareStep: () => ({
          activeTools: !inspected
            ? ["inspect_brief"]
            : probeAttempts < 2
              ? ["unstable_probe"]
              : !artifactLoaded
                ? ["load_large_artifact_ref"]
                : !contractVerified
                  ? ["verify_contract"]
                  : ["submit_spike"],
        }),
        prompt:
          "依次检查任务、验证错误恢复、读取大产物引用、确认合同，最后提交固定 Artifact 引用。",
        terminalToolNames: ["submit_spike"],
        tools,
        traceId: "provider-spike-trace",
        workOrderId: "provider-spike-work-order",
      });

      expect(result).toMatchObject({
        status: "submitted",
        submission: { artifactId: "provider-spike-artifact" },
      });
      expect(callOrder).toEqual([
        "inspect_brief",
        "unstable_probe:1",
        "unstable_probe:2",
        "load_large_artifact_ref",
        "verify_contract",
        "submit_spike",
      ]);
    },
    90_000,
  );
});

function isPersistedSpikeTerminal(
  value: unknown,
): value is PersistedAgentTerminal<{ artifactId: string }> {
  if (!value || typeof value !== "object") return false;

  const terminal = value as {
    status?: unknown;
    submission?: { artifactId?: unknown };
  };
  return (
    terminal.status === "submitted" &&
    terminal.submission?.artifactId === "provider-spike-artifact"
  );
}
