import type { DatabaseSync } from "node:sqlite";

import {
  CourseArtifactSchema,
  type ArtifactKind,
  type CourseArtifact,
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

export type CourseArtifactWrite = {
  id?: string;
  taskId: string;
  courseId: string;
  pageId?: string;
  scopeKey: string;
  kind: ArtifactKind;
  createdByWorkOrderId: string;
  payload: unknown;
  createdAt?: string;
};

export type CourseArtifactStore = {
  database: DatabaseSync;
  put(input: CourseArtifactWrite): CourseArtifact;
  /**
   * 只允许在调用方已经通过同一个 DatabaseSync 开启同步事务时使用。
   * Repository 用它把 Artifact、WorkOrder、CourseRun 和 Event 一次提交。
   */
  putInTransaction(input: CourseArtifactWrite): CourseArtifact;
  load(artifactId: string): CourseArtifact | undefined;
  loadByContent(input: {
    taskId: string;
    courseId: string;
    scopeKey: string;
    kind: ArtifactKind;
    contentHash: string;
    createdByWorkOrderId: string;
  }): CourseArtifact | undefined;
  listByTask(taskId: string, kind?: ArtifactKind): CourseArtifact[];
};

type ArtifactRow = {
  id: string;
  task_id: string;
  course_id: string;
  page_id: string | null;
  scope_key: string;
  kind: ArtifactKind;
  revision: number;
  content_hash: string;
  created_by_work_order_id: string;
  payload: string;
  created_at: string;
};

const SELECT_COLUMNS = `
  id, task_id, course_id, page_id, scope_key, kind, revision, content_hash,
  created_by_work_order_id, payload, created_at
`;

export function createCourseArtifactStore(
  options: AppDatabaseOptions = {},
): CourseArtifactStore {
  const database = resolveAppDatabase(options);
  const loadStatement = database.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM course_artifacts
    WHERE id = ?
  `);
  const loadByContentStatement = database.prepare(`
    SELECT ${SELECT_COLUMNS}
    FROM course_artifacts
    WHERE task_id = ?
      AND course_id = ?
      AND scope_key = ?
      AND kind = ?
      AND content_hash = ?
      AND created_by_work_order_id = ?
  `);

  const store: CourseArtifactStore = {
    database,

    put(input) {
      return runInTransaction(database, () => store.putInTransaction(input));
    },

    putInTransaction(input) {
      const createdAt = input.createdAt ?? new Date().toISOString();
      const contentHash = hashStorageValue(input.payload);
      const existing = store.loadByContent({
        taskId: input.taskId,
        courseId: input.courseId,
        scopeKey: input.scopeKey,
        kind: input.kind,
        contentHash,
        createdByWorkOrderId: input.createdByWorkOrderId,
      });
      if (existing) return existing;

      const revisionRow = database
        .prepare(`
          SELECT COALESCE(MAX(revision), 0) AS latest_revision
          FROM course_artifacts
          WHERE task_id = ?
            AND course_id = ?
            AND scope_key = ?
            AND kind = ?
        `)
        .get(
          input.taskId,
          input.courseId,
          input.scopeKey,
          input.kind,
        ) as { latest_revision: number };
      const artifact = CourseArtifactSchema.parse({
        id: input.id ?? createStorageId("artifact"),
        taskId: input.taskId,
        courseId: input.courseId,
        pageId: input.pageId,
        scopeKey: input.scopeKey,
        kind: input.kind,
        revision: revisionRow.latest_revision + 1,
        contentHash,
        createdByWorkOrderId: input.createdByWorkOrderId,
        payload: input.payload,
        createdAt,
      });

      database
        .prepare(`
          INSERT INTO course_artifacts (
            id, task_id, course_id, page_id, scope_key, kind, revision,
            content_hash, created_by_work_order_id, payload, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          artifact.id,
          artifact.taskId,
          artifact.courseId,
          artifact.pageId ?? null,
          artifact.scopeKey,
          artifact.kind,
          artifact.revision,
          artifact.contentHash,
          artifact.createdByWorkOrderId,
          JSON.stringify(artifact.payload),
          artifact.createdAt,
        );
      return artifact;
    },

    load(artifactId) {
      return parseArtifactRow(
        loadStatement.get(artifactId) as ArtifactRow | undefined,
      );
    },

    loadByContent(input) {
      return parseArtifactRow(
        loadByContentStatement.get(
          input.taskId,
          input.courseId,
          input.scopeKey,
          input.kind,
          input.contentHash,
          input.createdByWorkOrderId,
        ) as ArtifactRow | undefined,
      );
    },

    listByTask(taskId, kind) {
      const rows = kind
        ? (database
            .prepare(`
              SELECT ${SELECT_COLUMNS}
              FROM course_artifacts
              WHERE task_id = ? AND kind = ?
              ORDER BY scope_key, revision
            `)
            .all(taskId, kind) as ArtifactRow[])
        : (database
            .prepare(`
              SELECT ${SELECT_COLUMNS}
              FROM course_artifacts
              WHERE task_id = ?
              ORDER BY kind, scope_key, revision
            `)
            .all(taskId) as ArtifactRow[]);
      return rows.map((row) => parseArtifactRow(row)!);
    },
  };

  return store;
}

function parseArtifactRow(row: ArtifactRow | undefined) {
  if (!row) return undefined;
  return CourseArtifactSchema.parse({
    id: row.id,
    taskId: row.task_id,
    courseId: row.course_id,
    pageId: row.page_id ?? undefined,
    scopeKey: row.scope_key,
    kind: row.kind,
    revision: row.revision,
    contentHash: row.content_hash,
    createdByWorkOrderId: row.created_by_work_order_id,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  });
}
