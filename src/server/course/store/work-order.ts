import type { DatabaseSync } from "node:sqlite";

import {
  WorkOrderSchema,
  type WorkOrder,
  type WorkOrderKind,
  type WorkOrderStatus,
} from "@/shared/course-schema/work-order";
import {
  type AppDatabaseOptions,
  resolveAppDatabase,
  runInTransaction,
} from "@/server/infra/database/connection";
import { addMilliseconds } from "@/server/infra/database/codec";

export type WorkOrderFence = {
  expectedLockVersion: number;
  expectedStatus: WorkOrderStatus;
  expectedLeaseOwner?: string;
};

export type WorkOrderClaimInput = {
  owner: string;
  now: string;
  durationMs: number;
  /** 在同一个 BEGIN IMMEDIATE 事务内核对上层 Task/Run 执行权。 */
  authorize?(): void;
};

export type WorkOrderStore = {
  database: DatabaseSync;
  insert(workOrder: WorkOrder): WorkOrder;
  load(workOrderId: string): WorkOrder | undefined;
  loadByIdempotencyKey(idempotencyKey: string): WorkOrder | undefined;
  listByTask(taskId: string, statuses?: WorkOrderStatus[]): WorkOrder[];
  claim(workOrderId: string, input: WorkOrderClaimInput): WorkOrder | undefined;
  claimNext(
    taskId: string,
    input: WorkOrderClaimInput & { kind?: WorkOrderKind },
  ): WorkOrder | undefined;
  renewLease(input: {
    workOrderId: string;
    owner: string;
    expectedLockVersion: number;
    now: string;
    durationMs: number;
    authorize?(): void;
  }): WorkOrder | undefined;
  release(input: {
    workOrderId: string;
    owner: string;
    expectedLockVersion: number;
    now: string;
  }): WorkOrder | undefined;
  compareAndSet(next: WorkOrder, fence: WorkOrderFence): boolean;
};

type PayloadRow = { payload: string };

export function createWorkOrderStore(
  options: AppDatabaseOptions = {},
): WorkOrderStore {
  const database = resolveAppDatabase(options);
  const loadStatement = database.prepare(
    "SELECT payload FROM course_work_orders WHERE id = ?",
  );
  const loadIdempotentStatement = database.prepare(
    "SELECT payload FROM course_work_orders WHERE idempotency_key = ?",
  );

  const store: WorkOrderStore = {
    database,

    insert(workOrder) {
      const parsed = WorkOrderSchema.parse(workOrder);
      database
        .prepare(`
          INSERT INTO course_work_orders (
            id, task_id, course_id, parent_work_order_id,
            supersedes_work_order_id, kind, scope_key, status, lock_version,
            idempotency_key, payload, lease_owner, lease_expires_at,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(idempotency_key) DO NOTHING
        `)
        .run(
          parsed.id,
          parsed.taskId,
          parsed.courseId,
          parsed.parentWorkOrderId ?? null,
          parsed.supersedesWorkOrderId ?? null,
          parsed.kind,
          scopeKeyOf(parsed),
          parsed.status,
          parsed.lockVersion,
          parsed.idempotencyKey,
          JSON.stringify(parsed),
          parsed.leaseOwner ?? null,
          parsed.leaseExpiresAt ?? null,
          parsed.createdAt,
          parsed.updatedAt,
        );

      const stored = store.loadByIdempotencyKey(parsed.idempotencyKey);
      if (!stored) {
        throw new Error("WorkOrder 写入后无法读取");
      }
      if (
        stored.id !== parsed.id ||
        stored.taskId !== parsed.taskId ||
        stored.courseId !== parsed.courseId ||
        stored.kind !== parsed.kind ||
        scopeKeyOf(stored) !== scopeKeyOf(parsed)
      ) {
        throw new Error("idempotencyKey 已绑定到另一个 WorkOrder");
      }
      return stored;
    },

    load(workOrderId) {
      return parsePayloadRow(
        loadStatement.get(workOrderId) as PayloadRow | undefined,
      );
    },

    loadByIdempotencyKey(idempotencyKey) {
      return parsePayloadRow(
        loadIdempotentStatement.get(idempotencyKey) as PayloadRow | undefined,
      );
    },

    listByTask(taskId, statuses) {
      if (statuses && statuses.length === 0) return [];
      const rows = statuses
        ? (database
            .prepare(`
              SELECT payload
              FROM course_work_orders
              WHERE task_id = ?
                AND status IN (${statuses.map(() => "?").join(", ")})
              ORDER BY created_at ASC
            `)
            .all(taskId, ...statuses) as PayloadRow[])
        : (database
            .prepare(`
              SELECT payload
              FROM course_work_orders
              WHERE task_id = ?
              ORDER BY created_at ASC
            `)
            .all(taskId) as PayloadRow[]);
      return rows.map((row) => WorkOrderSchema.parse(JSON.parse(row.payload)));
    },

    claim(workOrderId, input) {
      return runInTransaction(database, () => {
        input.authorize?.();
        return claimInsideTransaction(store, workOrderId, input);
      });
    },

    claimNext(taskId, input) {
      return runInTransaction(database, () => {
        input.authorize?.();
        const row = input.kind
          ? (database
              .prepare(`
                SELECT id
                FROM course_work_orders
                WHERE task_id = ?
                  AND kind = ?
                  AND (
                    status = 'queued'
                    OR (
                      status = 'running'
                      AND lease_expires_at IS NOT NULL
                      AND lease_expires_at <= ?
                    )
                  )
                ORDER BY
                  CASE status WHEN 'queued' THEN 0 ELSE 1 END,
                  updated_at ASC
                LIMIT 1
              `)
              .get(taskId, input.kind, input.now) as
              | { id: string }
              | undefined)
          : (database
              .prepare(`
                SELECT id
                FROM course_work_orders
                WHERE task_id = ?
                  AND (
                    status = 'queued'
                    OR (
                      status = 'running'
                      AND lease_expires_at IS NOT NULL
                      AND lease_expires_at <= ?
                    )
                  )
                ORDER BY
                  CASE status WHEN 'queued' THEN 0 ELSE 1 END,
                  updated_at ASC
                LIMIT 1
              `)
              .get(taskId, input.now) as { id: string } | undefined);
        return row ? claimInsideTransaction(store, row.id, input) : undefined;
      });
    },

    renewLease(input) {
      return runInTransaction(database, () => {
        input.authorize?.();
        const current = store.load(input.workOrderId);
        if (
          !current ||
          current.status !== "running" ||
          current.lockVersion !== input.expectedLockVersion ||
          current.leaseOwner !== input.owner
        ) {
          return undefined;
        }
        const next = WorkOrderSchema.parse({
          ...current,
          lockVersion: current.lockVersion + 1,
          leaseExpiresAt: addMilliseconds(input.now, input.durationMs),
          updatedAt: input.now,
        });
        return store.compareAndSet(next, {
          expectedLockVersion: current.lockVersion,
          expectedStatus: "running",
          expectedLeaseOwner: input.owner,
        })
          ? next
          : undefined;
      });
    },

    release(input) {
      return runInTransaction(database, () => {
        const current = store.load(input.workOrderId);
        if (
          !current ||
          current.status !== "running" ||
          current.lockVersion !== input.expectedLockVersion ||
          current.leaseOwner !== input.owner
        ) {
          return undefined;
        }
        const next = WorkOrderSchema.parse({
          ...current,
          status: "queued",
          lockVersion: current.lockVersion + 1,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
          updatedAt: input.now,
        });
        return store.compareAndSet(next, {
          expectedLockVersion: current.lockVersion,
          expectedStatus: "running",
          expectedLeaseOwner: input.owner,
        })
          ? next
          : undefined;
      });
    },

    compareAndSet(next, fence) {
      const parsed = WorkOrderSchema.parse(next);
      if (parsed.lockVersion !== fence.expectedLockVersion + 1) {
        throw new Error("WorkOrder CAS 必须把 lockVersion 恰好增加 1");
      }
      const result = database
        .prepare(`
          UPDATE course_work_orders
          SET parent_work_order_id = ?,
              supersedes_work_order_id = ?,
              kind = ?,
              scope_key = ?,
              status = ?,
              lock_version = ?,
              payload = ?,
              lease_owner = ?,
              lease_expires_at = ?,
              updated_at = ?
          WHERE id = ?
            AND lock_version = ?
            AND status = ?
            AND (
              lease_owner = ?
              OR (lease_owner IS NULL AND ? IS NULL)
            )
        `)
        .run(
          parsed.parentWorkOrderId ?? null,
          parsed.supersedesWorkOrderId ?? null,
          parsed.kind,
          scopeKeyOf(parsed),
          parsed.status,
          parsed.lockVersion,
          JSON.stringify(parsed),
          parsed.leaseOwner ?? null,
          parsed.leaseExpiresAt ?? null,
          parsed.updatedAt,
          parsed.id,
          fence.expectedLockVersion,
          fence.expectedStatus,
          fence.expectedLeaseOwner ?? null,
          fence.expectedLeaseOwner ?? null,
        );
      return result.changes === 1;
    },
  };

  return store;
}

function claimInsideTransaction(
  store: WorkOrderStore,
  workOrderId: string,
  input: WorkOrderClaimInput,
) {
  const current = store.load(workOrderId);
  if (!current) return undefined;

  const canClaimQueued = current.status === "queued";
  const canReclaimExpired =
    current.status === "running" &&
    current.leaseExpiresAt !== undefined &&
    current.leaseExpiresAt <= input.now;
  if (!canClaimQueued && !canReclaimExpired) return undefined;

  const next = WorkOrderSchema.parse({
    ...current,
    status: "running",
    lockVersion: current.lockVersion + 1,
    executionAttempt: current.executionAttempt + 1,
    leaseOwner: input.owner,
    leaseExpiresAt: addMilliseconds(input.now, input.durationMs),
    updatedAt: input.now,
  });
  return store.compareAndSet(next, {
    expectedLockVersion: current.lockVersion,
    expectedStatus: current.status,
    expectedLeaseOwner: current.leaseOwner,
  })
    ? next
    : undefined;
}

function scopeKeyOf(workOrder: WorkOrder) {
  return workOrder.scope.type === "course"
    ? "course"
    : `page:${workOrder.scope.pageId}`;
}

function parsePayloadRow(row: PayloadRow | undefined) {
  if (!row) return undefined;
  return WorkOrderSchema.parse(JSON.parse(row.payload));
}
