import { describe, expect, it } from "vitest";

import {
  boundAgentToolResult,
  isCommittedTerminalToolResult,
} from "../../../../../src/server/agent/runtime/tool-result";

describe("AgentToolResult", () => {
  it("压缩大结果但保留 committed terminal 标志", () => {
    const result = boundAgentToolResult(
      {
        artifactRefs: Array.from({ length: 100 }, (_, index) => ({
          id: `artifact-${index}`,
        })),
        committed: true,
        data: { html: "课".repeat(10_000) },
        ok: true,
        summary: "已写入页面 Artifact。",
        terminal: true,
      },
      1_024,
    );

    expect(isCommittedTerminalToolResult(result)).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      1_024,
    );
    expect(result).toMatchObject({
      committed: true,
      data: { truncated: true },
      ok: true,
      terminal: true,
    });
  });

  it("非标准工具输出只返回可修正的安全反馈", () => {
    expect(boundAgentToolResult("raw html", 512)).toEqual({
      code: "INVALID_TOOL_RESULT",
      committed: false,
      feedback: ["工具必须返回标准 AgentToolResult。"],
      message: "工具返回格式无效。",
      ok: false,
      retryable: true,
      terminal: false,
    });
  });
});
