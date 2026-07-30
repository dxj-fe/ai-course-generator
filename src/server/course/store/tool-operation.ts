import type { DatabaseSync } from "node:sqlite";

import {
  ArtifactRefSchema,
  type ArtifactRef,
} from "@/shared/course-schema/course-artifact";
import {
  type AppDatabaseOptions,
  resolveAppDatabase,
  runInTransaction,
} from "@/server/infra/database/connection";
import {
  createStorageId,
  hashStorageValue,
} from "@/server/infra/database/codec";

export type CourseToolOperationStatus = "running" | "completed" | "failed";

export type CourseToolOperation = {
  id: string;
  workOrderId: string;
  executionAttempt: number;
  agentStepNumber: number;
  toolOrdinal: number;
  toolCallId?: string;
  toolName: string;
  inputHash: string;
  logicalOperationKey?: string;
  status: CourseToolOperationStatus;
  outputArtifactRefs: ArtifactRef[];
  safeSummary?: string;
  usage?: unknown;
  startedAt: string;
  completedAt?: string;
};

export type BeginCourseToolOperationInput = {
  id?: string;
  workOrderId: string;
  executionAttempt: number;
  agentStepNumber: number;
  toolOrdinal: number;
  toolCallId?: string;
  toolName: string;
  input: unknown;
  logicalOperationKey?: string;
  startedAt?: string;
};

export type CourseToolOperationStore = {
  database: DatabaseSync;
  begin(input: BeginCourseToolOperationInput): CourseToolOperation;
  beginInTransaction(
    input: BeginCourseToolOperationInput,
  ): CourseToolOperation;
  complete(input: {
    operationId: string;
    outputArtifactRefs: ArtifactRef[];
    safeSummary?: string;
    usage?: unknown;
    completedAt?: string;
  }): CourseToolOperation;
  fail(input: {
    operationId: string;
    safeSummary: string;
    usage?: unknown;
    completedAt?: string;
  }): CourseToolOperation;
  load(operationId: string): CourseToolOperation | undefined;
  loadByLogicalKey(logicalOperationKey: string): CourseToolOperation | undefined;
  listByWorkOrder(workOrderId: string): CourseToolOperation[];
};

type OperationRow = {
  id: string;
  work_order_id: string;
  execution_attempt: number;
  agent_step_number: number;
  tool_ordinal: number;
  tool_call_id: string | null;
  tool_name: string;
  input_hash: string;
  logical_operation_key: string | null;
  status: CourseToolOperationStatus;
  output_artifact_refs: string;
  safe_summary: string | null;
  usage: string | null;
  started_at: string;
  completed_at: string | null;
};

const SELECT_COLUMNS = `
  id, work_order_id, execution_attempt, agent_step_number, tool_ordinal,
  tool_call_id, tool_name, input_hash, logical_operation_key, status,
  output_artifact_refs, safe_summary, usage, started_at, completed_at
`;

export function createLogicalOperationKey(input: {
  workOrderId: string;
  toolName: string;
  inputArtifactRefs?: ArtifactRef[];
  businessParameters?: unknown;
}) {
  const refs = [...(input.inputArtifactRefs ?? [])]
    .map((ref) => ArtifactRefSchema.parse(ref))
    .sort((left, right) => left.id.localeCompare(right.id));
  return `operation-${hashStorageValue({
    workOrderId: input.workOrderId,
    toolName: input.toolName,
    inputArtifactRefs: refs,
    businessParameters: input.businessParameters ?? null,
  })}`;
}

export function createCourseToolOperationStore(
  options: AppDatabaseOptions = {},
): CourseToolOperationStore {
  const database = resolveAppDatabase(options);
  const loadStatement = database.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM course_tool_operations
    WHERE id = ?
  `);
  const loadByLogicalKeyStatement = database.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM course_tool_operations
    WHERE logical_operation_key = ?
  `);

  const store: CourseToolOperationStore = {
    database,

    begin(input) {
      return runInTransaction(database, () => store.beginInTransaction(input));
    },

    beginInTransaction(input) {
      assertPositiveInteger(input.executionAttempt, "executionAttempt");
      assertPositiveInteger(input.agentStepNumber, "agentStepNumber");
      assertPositiveInteger(input.toolOrdinal, "toolOrdinal");
      if (!input.workOrderId || !input.toolName) {
        throw new Error("Tool operation 缺少 workOrderId 或 toolName");
      }
      const inputHash = hashStorageValue(input.input);
      const existingByLogicalKey = input.logicalOperationKey
        ? store.loadByLogicalKey(input.logicalOperationKey)
        : undefined;
      if (existingByLogicalKey) {
        assertSameLogicalOperation(existingByLogicalKey, {
          ...input,
          inputHash,
        });
        return existingByLogicalKey;
      }

      const existingByPosition = database
        .prepare(`
          SELECT ${SELECT_COLUMNS}
          FROM course_tool_operations
          WHERE work_order_id = ?
            AND execution_attempt = ?
            AND agent_step_number = ?
            AND tool_ordinal = ?
        `)
        .get(
          input.workOrderId,
          input.executionAttempt,
          input.agentStepNumber,
          input.toolOrdinal,
        ) as OperationRow | undefined;
      if (existingByPosition) {
        const existing = parseOperationRow(existingByPosition);
        assertSameLogicalOperation(existing, { ...input, inputHash });
        return existing;
      }

      const operation: CourseToolOperation = {
        id: input.id ?? createStorageId("tool-operation"),
        workOrderId: input.workOrderId,
        executionAttempt: input.executionAttempt,
        agentStepNumber: input.agentStepNumber,
        toolOrdinal: input.toolOrdinal,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        inputHash,
        logicalOperationKey: input.logicalOperationKey,
        status: "running",
        outputArtifactRefs: [],
        startedAt: input.startedAt ?? new Date().toISOString(),
      };
      database
        .prepare(`
          INSERT INTO course_tool_operations (
            id, work_order_id, execution_attempt, agent_step_number,
            tool_ordinal, tool_call_id, tool_name, input_hash,
            logical_operation_key, status, output_artifact_refs,
            safe_summary, usage, started_at, completed_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          operation.id,
          operation.workOrderId,
          operation.executionAttempt,
          operation.agentStepNumber,
          operation.toolOrdinal,
          operation.toolCallId ?? null,
          operation.toolName,
          operation.inputHash,
          operation.logicalOperationKey ?? null,
          operation.status,
          "[]",
          null,
          null,
          operation.startedAt,
          null,
        );
      return operation;
    },

    complete(input) {
      return finishOperation(database, store, {
        ...input,
        status: "completed",
      });
    },

    fail(input) {
      return finishOperation(database, store, {
        ...input,
        outputArtifactRefs: [],
        status: "failed",
      });
    },

    load(operationId) {
      const row = loadStatement.get(operationId) as OperationRow | undefined;
      return row ? parseOperationRow(row) : undefined;
    },

    loadByLogicalKey(logicalOperationKey) {
      const row = loadByLogicalKeyStatement.get(
        logicalOperationKey,
      ) as OperationRow | undefined;
      return row ? parseOperationRow(row) : undefined;
    },

    listByWorkOrder(workOrderId) {
      const rows = database
        .prepare(`
          SELECT ${SELECT_COLUMNS}
          FROM course_tool_operations
          WHERE work_order_id = ?
          ORDER BY execution_attempt, agent_step_number, tool_ordinal
        `)
        .all(workOrderId) as OperationRow[];
      return rows.map(parseOperationRow);
    },
  };

  return store;
}

function finishOperation(
  database: DatabaseSync,
  store: CourseToolOperationStore,
  input: {
    operationId: string;
    status: "completed" | "failed";
    outputArtifactRefs: ArtifactRef[];
    safeSummary?: string;
    usage?: unknown;
    completedAt?: string;
  },
) {
  return runInTransaction(database, () => {
    const current = store.load(input.operationId);
    if (!current) throw new Error("Tool operation 不存在");
    const refs = input.outputArtifactRefs.map((ref) =>
      ArtifactRefSchema.parse(ref),
    );
    if (current.status !== "running") {
      if (
        current.status === input.status &&
        hashStorageValue(current.outputArtifactRefs) === hashStorageValue(refs)
      ) {
        return current;
      }
      throw new Error("Tool operation 已经结束，不能重复改写结果");
    }

    const completedAt = input.completedAt ?? new Date().toISOString();
    const result = database
      .prepare(`
        UPDATE course_tool_operations
        SET status = ?,
            output_artifact_refs = ?,
            safe_summary = ?,
            usage = ?,
            completed_at = ?
        WHERE id = ? AND status = 'running'
      `)
      .run(
        input.status,
        JSON.stringify(refs),
        input.safeSummary ?? null,
        input.usage === undefined ? null : JSON.stringify(input.usage),
        completedAt,
        current.id,
      );
    if (result.changes !== 1) {
      throw new Error("Tool operation 结果提交发生并发冲突");
    }
    return {
      ...current,
      status: input.status,
      outputArtifactRefs: refs,
      safeSummary: input.safeSummary,
      usage: input.usage,
      completedAt,
    };
  });
}

function parseOperationRow(row: OperationRow): CourseToolOperation {
  return {
    id: row.id,
    workOrderId: row.work_order_id,
    executionAttempt: row.execution_attempt,
    agentStepNumber: row.agent_step_number,
    toolOrdinal: row.tool_ordinal,
    toolCallId: row.tool_call_id ?? undefined,
    toolName: row.tool_name,
    inputHash: row.input_hash,
    logicalOperationKey: row.logical_operation_key ?? undefined,
    status: row.status,
    outputArtifactRefs: (JSON.parse(
      row.output_artifact_refs,
    ) as unknown[]).map((ref) => ArtifactRefSchema.parse(ref)),
    safeSummary: row.safe_summary ?? undefined,
    usage: row.usage ? JSON.parse(row.usage) : undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function assertSameLogicalOperation(
  existing: CourseToolOperation,
  input: BeginCourseToolOperationInput & { inputHash: string },
) {
  if (
    existing.workOrderId !== input.workOrderId ||
    existing.toolName !== input.toolName ||
    existing.inputHash !== input.inputHash
  ) {
    throw new Error("logicalOperationKey 已绑定到不同工具操作");
  }
}

function assertPositiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} 必须是正整数`);
  }
}
