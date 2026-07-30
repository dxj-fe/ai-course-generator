import { z } from "zod";

export const DEFAULT_MAX_TOOL_RESULT_BYTES = 16 * 1024;
const MAX_RETURNED_ARTIFACT_REFS = 24;

export type AgentToolResult<T, ArtifactRef = unknown> =
  | {
      artifactRefs?: ArtifactRef[];
      committed: boolean;
      data: T;
      ok: true;
      summary: string;
      terminal: boolean;
    }
  | {
      code: string;
      committed: false;
      feedback?: string[];
      message: string;
      ok: false;
      retryable: boolean;
      terminal: false;
    };

export type BoundedToolResultData = {
  originalBytes: number;
  preview: string;
  truncated: true;
};

const successToolResultSchema = z.object({
  artifactRefs: z.array(z.unknown()).optional(),
  committed: z.boolean(),
  data: z.unknown(),
  ok: z.literal(true),
  summary: z.string(),
  terminal: z.boolean(),
});

const failureToolResultSchema = z.object({
  code: z.string().min(1),
  committed: z.literal(false),
  feedback: z.array(z.string()).optional(),
  message: z.string(),
  ok: z.literal(false),
  retryable: z.boolean(),
  terminal: z.literal(false),
});

const agentToolResultSchema = z.union([
  successToolResultSchema,
  failureToolResultSchema,
]);

export function isAgentToolResult(
  value: unknown,
): value is AgentToolResult<unknown> {
  return agentToolResultSchema.safeParse(value).success;
}

export function isCommittedTerminalToolResult(
  value: unknown,
): value is Extract<
  AgentToolResult<unknown>,
  { committed: true; ok: true; terminal: true }
> {
  const parsed = successToolResultSchema.safeParse(value);

  return (
    parsed.success &&
    parsed.data.committed === true &&
    parsed.data.terminal === true
  );
}

/**
 * 只把可控大小的摘要送回模型。完整 HTML、图片或大 JSON 必须先写 Artifact，
 * ToolResult 只能携带引用。terminal 标志会保留，最终正确性仍由 Repository 重读确认。
 */
export function boundAgentToolResult(
  value: unknown,
  maxBytes = DEFAULT_MAX_TOOL_RESULT_BYTES,
): AgentToolResult<unknown> {
  assertMaxBytes(maxBytes);
  const parsed = agentToolResultSchema.safeParse(value);

  if (!parsed.success) {
    return boundFailureResult(
      {
        code: "INVALID_TOOL_RESULT",
        committed: false,
        feedback: ["工具必须返回标准 AgentToolResult。"],
        message: "工具返回格式无效。",
        ok: false,
        retryable: true,
        terminal: false,
      },
      maxBytes,
    );
  }

  if (utf8Size(parsed.data) <= maxBytes) {
    return parsed.data;
  }

  if (!parsed.data.ok) {
    return boundFailureResult(parsed.data, maxBytes);
  }

  const serializedData = safeSerialize(parsed.data.data);
  const bounded: AgentToolResult<BoundedToolResultData> = {
    artifactRefs: parsed.data.artifactRefs?.slice(
      0,
      MAX_RETURNED_ARTIFACT_REFS,
    ),
    committed: parsed.data.committed,
    data: {
      originalBytes: utf8Size(parsed.data),
      preview: truncateUtf8(serializedData, Math.max(64, maxBytes / 3)),
      truncated: true,
    },
    ok: true,
    summary: truncateUtf8(parsed.data.summary, Math.max(64, maxBytes / 4)),
    terminal: parsed.data.terminal,
  };

  if (utf8Size(bounded) <= maxBytes) {
    return bounded;
  }

  delete bounded.artifactRefs;
  bounded.data.preview = truncateUtf8(
    bounded.data.preview,
    Math.max(16, maxBytes / 8),
  );
  bounded.summary = truncateUtf8(
    bounded.summary,
    Math.max(16, maxBytes / 8),
  );

  if (utf8Size(bounded) > maxBytes) {
    bounded.data.preview = "";
    bounded.summary = "工具结果过大，完整内容已保存为 Artifact。";
  }
  if (utf8Size(bounded) > maxBytes) {
    bounded.summary = "";
  }

  return bounded;
}

function boundFailureResult(
  result: Extract<AgentToolResult<unknown>, { ok: false }>,
  maxBytes: number,
): Extract<AgentToolResult<unknown>, { ok: false }> {
  if (utf8Size(result) <= maxBytes) {
    return result;
  }

  const bounded = {
    ...result,
    feedback: result.feedback
      ?.slice(0, 12)
      .map((item) => truncateUtf8(item, Math.max(32, maxBytes / 12))),
    message: truncateUtf8(result.message, Math.max(48, maxBytes / 4)),
  };

  if (utf8Size(bounded) <= maxBytes) {
    return bounded;
  }

  return {
    code: truncateUtf8(result.code, Math.max(8, maxBytes / 10)),
    committed: false,
    message: truncateUtf8(result.message, Math.max(16, maxBytes / 5)),
    ok: false,
    retryable: result.retryable,
    terminal: false,
  };
}

function safeSerialize(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[无法序列化的工具结果]";
  }
}

function utf8Size(value: unknown) {
  return new TextEncoder().encode(safeSerialize(value)).byteLength;
}

function truncateUtf8(value: string, maxBytes: number) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  if (encoded.byteLength <= maxBytes) return value;

  const suffix = "…";
  const bodyLimit = Math.max(
    0,
    maxBytes - encoder.encode(suffix).byteLength,
  );
  const characters: string[] = [];
  let bodyBytes = 0;

  for (const character of value) {
    const characterBytes = encoder.encode(character).byteLength;
    if (bodyBytes + characterBytes > bodyLimit) break;
    characters.push(character);
    bodyBytes += characterBytes;
  }

  return `${characters.join("")}${suffix}`;
}

function assertMaxBytes(maxBytes: number) {
  if (!Number.isInteger(maxBytes) || maxBytes < 256) {
    throw new TypeError("maxBytes 必须是至少 256 的整数。");
  }
}
