import {
  ArtifactRefSchema,
  type ArtifactRef,
  type WorkOrder,
} from "@/shared/course-schema";
import {
  classifyPublicAgentError,
  sanitizePublicDiagnosticText,
} from "@/server/course/projection/public-error";
import type {
  CourseToolOperation,
  CourseToolOperationStore,
} from "@/server/course/store/tool-operation";
import {
  isAgentToolResult,
  type AgentToolLedger,
} from "@/server/agent/runtime";

/**
 * 把 ToolLoopAgent 的真实工具调用写入持久化台账。HTML、图片等大结果只记录
 * ArtifactRef 和公开摘要，不把原始内容复制进 ledger。
 */
export function createCourseToolLedger(
  store: CourseToolOperationStore,
  workOrder: WorkOrder,
): AgentToolLedger {
  const existing = store
    .listByWorkOrder(workOrder.id)
    .filter(
      ({ executionAttempt }) =>
        executionAttempt === workOrder.executionAttempt,
    );
  const ordinalOffset = Math.max(
    0,
    ...existing.map(({ toolOrdinal }) => toolOrdinal),
  );
  let nextToolOrdinal = ordinalOffset;

  return {
    begin(input) {
      nextToolOrdinal += 1;
      return store.begin({
        workOrderId: workOrder.id,
        executionAttempt: workOrder.executionAttempt,
        agentStepNumber: Math.max(
          1,
          input.agentStepNumber + ordinalOffset,
        ),
        // Runner 与 Harness 都可能在同一 Agent Run 内执行工具，统一由
        // 持久化 ledger 分配序号，不能分别从 1 开始造成冲突。
        toolOrdinal: nextToolOrdinal,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.input,
      });
    },

    complete({ handle, output }) {
      const operation = requiredOperation(handle);
      const result = unwrapToolOutput(output);
      store.complete({
        operationId: operation.id,
        outputArtifactRefs: extractArtifactRefs(result),
        safeSummary: toolSummary(result),
      });
    },

    fail({ error, handle }) {
      const operation = requiredOperation(handle);
      const publicError = classifyPublicAgentError({ error });
      store.fail({
        operationId: operation.id,
        safeSummary: `${publicError.code}: ${publicError.message}`,
      });
    },
  };
}

function unwrapToolOutput(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "output" in value
  ) {
    return (value as { output?: unknown }).output;
  }
  return value;
}

function extractArtifactRefs(value: unknown): ArtifactRef[] {
  if (!isAgentToolResult(value) || !value.ok || !value.artifactRefs) {
    return [];
  }
  return value.artifactRefs.flatMap((candidate) => {
    const parsed = ArtifactRefSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

function toolSummary(value: unknown) {
  if (!isAgentToolResult(value)) return "工具调用已完成";
  return sanitizePublicDiagnosticText(
    value.ok ? value.summary : `${value.code}: ${value.message}`,
    {
      fallback: value.ok ? "工具调用已完成。" : "工具调用失败。",
      maxLength: 1_000,
    },
  );
}

function requiredOperation(value: unknown): CourseToolOperation {
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    typeof value.id !== "string"
  ) {
    throw new Error("工具执行台账 handle 无效");
  }
  return value as CourseToolOperation;
}
