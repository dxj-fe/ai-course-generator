import type { DatabaseSync } from "node:sqlite";

import {
  CourseRunSchema,
  type CourseRun,
} from "@/shared/course-schema/course-run";
import {
  type AppDatabaseOptions,
  resolveAppDatabase,
  runInTransaction,
} from "@/server/infra/database/connection";
import { addMilliseconds } from "@/server/infra/database/codec";

export type CourseRunLeaseInput = {
  runId: string;
  owner: string;
  now: string;
  durationMs: number;
  expectedTraceId?: string;
  /** 在同一个 BEGIN IMMEDIATE 事务内核对上层 Task/Run 执行权。 */
  authorize?(): void;
};

export type CourseRunFence = {
  expectedLockVersion: number;
  expectedTraceId: string;
  expectedLeaseOwner?: string;
};

export type CourseRunStore = {
  database: DatabaseSync;
  insert(run: CourseRun, createdAt?: string): CourseRun;
  load(runId: string): CourseRun | undefined;
  loadByTaskId(taskId: string): CourseRun | undefined;
  listRunnable(now: string): CourseRun[];
  adoptTrace(input: {
    runId: string;
    previousTraceId: string;
    nextTraceId: string;
    now: string;
    authorize?(): void;
  }): CourseRun | undefined;
  claimLease(input: CourseRunLeaseInput): CourseRun | undefined;
  renewLease(input: CourseRunLeaseInput): CourseRun | undefined;
  cancel(input: {
    runId: string;
    expectedTraceId: string;
    now: string;
  }): CourseRun | undefined;
  releaseLease(input: {
    runId: string;
    owner: string;
    expectedLockVersion: number;
    expectedTraceId: string;
    now: string;
  }): CourseRun | undefined;
  compareAndSet(
    next: CourseRun,
    fence: CourseRunFence,
    updatedAt?: string,
  ): boolean;
};

type PayloadRow = { payload: string };

const TERMINAL_PHASES = new Set(["completed", "failed", "cancelled"]);

export function createCourseRunStore(
  options: AppDatabaseOptions = {},
): CourseRunStore {
  const database = resolveAppDatabase(options);
  const loadStatement = database.prepare(
    "SELECT payload FROM course_runs WHERE id = ?",
  );
  const loadByTaskStatement = database.prepare(
    "SELECT payload FROM course_runs WHERE task_id = ?",
  );

  const store: CourseRunStore = {
    database,

    insert(run, createdAt = new Date().toISOString()) {
      const parsed = CourseRunSchema.parse(run);
      database
        .prepare(`
          INSERT INTO course_runs (
            id, task_id, course_id, phase, trace_id, lock_version, payload,
            lease_owner, lease_expires_at, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(task_id) DO NOTHING
        `)
        .run(
          parsed.id,
          parsed.taskId,
          parsed.courseId,
          parsed.phase,
          parsed.traceId,
          parsed.lockVersion,
          JSON.stringify(parsed),
          parsed.leaseOwner ?? null,
          parsed.leaseExpiresAt ?? null,
          createdAt,
          createdAt,
        );

      const stored = store.loadByTaskId(parsed.taskId);
      if (!stored) {
        throw new Error("CourseRun 写入后无法读取");
      }
      if (stored.id !== parsed.id || stored.courseId !== parsed.courseId) {
        throw new Error("taskId 已绑定到另一个 CourseRun");
      }
      return stored;
    },

    load(runId) {
      return parsePayloadRow(loadStatement.get(runId) as PayloadRow | undefined);
    },

    loadByTaskId(taskId) {
      return parsePayloadRow(
        loadByTaskStatement.get(taskId) as PayloadRow | undefined,
      );
    },

    listRunnable(now) {
      const rows = database
        .prepare(`
          SELECT payload
          FROM course_runs
          WHERE phase NOT IN ('completed', 'failed', 'cancelled')
            AND (lease_owner IS NULL OR lease_expires_at <= ?)
          ORDER BY updated_at ASC
        `)
        .all(now) as PayloadRow[];
      return rows.map((row) => CourseRunSchema.parse(JSON.parse(row.payload)));
    },

    adoptTrace(input) {
      return runInTransaction(database, () => {
        input.authorize?.();
        const current = store.load(input.runId);
        if (
          !current ||
          TERMINAL_PHASES.has(current.phase) ||
          current.traceId !== input.previousTraceId
        ) {
          return undefined;
        }
        if (current.traceId === input.nextTraceId) return current;

        const leaseIsActive =
          current.leaseOwner !== undefined &&
          current.leaseExpiresAt !== undefined &&
          current.leaseExpiresAt > input.now;
        if (leaseIsActive) return undefined;

        const next = CourseRunSchema.parse({
          ...current,
          traceId: input.nextTraceId,
          lockVersion: current.lockVersion + 1,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
        });
        return store.compareAndSet(
          next,
          {
            expectedLockVersion: current.lockVersion,
            expectedTraceId: current.traceId,
            expectedLeaseOwner: current.leaseOwner,
          },
          input.now,
        )
          ? next
          : undefined;
      });
    },

    claimLease(input) {
      return runInTransaction(database, () => {
        input.authorize?.();
        const current = store.load(input.runId);
        if (!current || TERMINAL_PHASES.has(current.phase)) return undefined;
        if (
          input.expectedTraceId !== undefined &&
          current.traceId !== input.expectedTraceId
        ) {
          return undefined;
        }

        const leaseIsActive =
          current.leaseOwner !== undefined &&
          current.leaseExpiresAt !== undefined &&
          current.leaseExpiresAt > input.now;
        if (leaseIsActive) {
          return current.leaseOwner === input.owner ? current : undefined;
        }

        const next = CourseRunSchema.parse({
          ...current,
          lockVersion: current.lockVersion + 1,
          leaseOwner: input.owner,
          leaseExpiresAt: addMilliseconds(input.now, input.durationMs),
        });
        return store.compareAndSet(
          next,
          {
            expectedLockVersion: current.lockVersion,
            expectedTraceId: current.traceId,
            expectedLeaseOwner: current.leaseOwner,
          },
          input.now,
        )
          ? next
          : undefined;
      });
    },

    renewLease(input) {
      return runInTransaction(database, () => {
        input.authorize?.();
        const current = store.load(input.runId);
        if (
          !current ||
          TERMINAL_PHASES.has(current.phase) ||
          current.traceId !== input.expectedTraceId ||
          current.leaseOwner !== input.owner
        ) {
          return undefined;
        }
        const next = CourseRunSchema.parse({
          ...current,
          lockVersion: current.lockVersion + 1,
          leaseExpiresAt: addMilliseconds(input.now, input.durationMs),
        });
        return store.compareAndSet(
          next,
          {
            expectedLockVersion: current.lockVersion,
            expectedTraceId: current.traceId,
            expectedLeaseOwner: input.owner,
          },
          input.now,
        )
          ? next
          : undefined;
      });
    },

    cancel(input) {
      return runInTransaction(database, () => {
        const current = store.load(input.runId);
        if (!current || current.traceId !== input.expectedTraceId) {
          return undefined;
        }
        if (current.phase === "cancelled") return current;
        if (current.phase === "completed" || current.phase === "failed") {
          return undefined;
        }
        const next = CourseRunSchema.parse({
          ...current,
          phase: "cancelled",
          lockVersion: current.lockVersion + 1,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
        });
        return store.compareAndSet(
          next,
          {
            expectedLockVersion: current.lockVersion,
            expectedTraceId: current.traceId,
            expectedLeaseOwner: current.leaseOwner,
          },
          input.now,
        )
          ? next
          : undefined;
      });
    },

    releaseLease(input) {
      return runInTransaction(database, () => {
        const current = store.load(input.runId);
        if (
          !current ||
          current.lockVersion !== input.expectedLockVersion ||
          current.traceId !== input.expectedTraceId ||
          current.leaseOwner !== input.owner
        ) {
          return undefined;
        }
        const next = CourseRunSchema.parse({
          ...current,
          lockVersion: current.lockVersion + 1,
          leaseOwner: undefined,
          leaseExpiresAt: undefined,
        });
        return store.compareAndSet(
          next,
          {
            expectedLockVersion: current.lockVersion,
            expectedTraceId: current.traceId,
            expectedLeaseOwner: input.owner,
          },
          input.now,
        )
          ? next
          : undefined;
      });
    },

    compareAndSet(next, fence, updatedAt = new Date().toISOString()) {
      const parsed = CourseRunSchema.parse(next);
      if (parsed.lockVersion !== fence.expectedLockVersion + 1) {
        throw new Error("CourseRun CAS 必须把 lockVersion 恰好增加 1");
      }
      const result = database
        .prepare(`
          UPDATE course_runs
          SET phase = ?,
              trace_id = ?,
              lock_version = ?,
              payload = ?,
              lease_owner = ?,
              lease_expires_at = ?,
              updated_at = ?
          WHERE id = ?
            AND lock_version = ?
            AND trace_id = ?
            AND (
              lease_owner = ?
              OR (lease_owner IS NULL AND ? IS NULL)
            )
        `)
        .run(
          parsed.phase,
          parsed.traceId,
          parsed.lockVersion,
          JSON.stringify(parsed),
          parsed.leaseOwner ?? null,
          parsed.leaseExpiresAt ?? null,
          updatedAt,
          parsed.id,
          fence.expectedLockVersion,
          fence.expectedTraceId,
          fence.expectedLeaseOwner ?? null,
          fence.expectedLeaseOwner ?? null,
        );
      return result.changes === 1;
    },
  };

  return store;
}

function parsePayloadRow(row: PayloadRow | undefined) {
  if (!row) return undefined;
  return CourseRunSchema.parse(JSON.parse(row.payload));
}
