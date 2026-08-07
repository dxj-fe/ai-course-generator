import { mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import {
  databasePathForRoot,
  resolveAppDatabase,
  runInTransaction,
} from "@/server/infra/database/connection";

const ASSET_ID_PATTERN = /asset-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const SCREENSHOT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
const IMAGE_EXTENSIONS = ["png", "jpg", "webp"] as const;

type PurgeOptions = {
  rootDir?: string;
  database?: DatabaseSync;
  dryRun?: boolean;
  backup?: boolean;
  now?: () => Date;
};

type TextRow = { id: string; payload: string };

export type FailedCoursePurgeReport = {
  dryRun: boolean;
  failedCourseIds: string[];
  failedTaskIds: string[];
  exclusiveAssetIds: string[];
  screenshotIds: string[];
  databaseRows: Record<string, number>;
  archivedFiles: {
    workspaces: number;
    screenshots: number;
    assets: number;
  };
  backupDirectory?: string;
  databaseBackupPath?: string;
};

/**
 * 删除所有 failed 课程的关系数据，并把其独占本地文件移入可恢复备份。
 * completed 与 cancelled 课程，以及仍被它们引用的共享素材均不会被触碰。
 */
export async function purgeFailedCourses(
  options: PurgeOptions = {},
): Promise<FailedCoursePurgeReport> {
  const rootDir = path.resolve(
    options.rootDir ?? path.join(process.cwd(), ".data"),
  );
  const databasePath = databasePathForRoot(rootDir);
  const database =
    options.database ?? resolveAppDatabase({ databasePath });
  const dryRun = options.dryRun ?? true;
  const now = options.now?.() ?? new Date();
  const stamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");

  const courses = database
    .prepare("SELECT id, payload FROM courses ORDER BY updated_at DESC")
    .all() as TextRow[];
  const failedCourseIds = courses
    .filter(({ payload }) => readStatus(payload) === "failed")
    .map(({ id }) => id);
  const keptCourseIds = courses
    .filter(({ payload }) => readStatus(payload) !== "failed")
    .map(({ id }) => id);
  const failedTasks = selectRowsByIds(
    database,
    "course_tasks",
    "course_id",
    failedCourseIds,
  );
  const failedTaskIds = failedTasks.map(({ id }) => id);
  const failedArtifacts = selectRowsByIds(
    database,
    "course_artifacts",
    "course_id",
    failedCourseIds,
  );
  const keptArtifacts = selectRowsByIds(
    database,
    "course_artifacts",
    "course_id",
    keptCourseIds,
  );
  const failedAssetIds = collectAssetIds([
    ...failedArtifacts.map(({ payload }) => payload),
    ...courses
      .filter(({ id }) => failedCourseIds.includes(id))
      .map(({ payload }) => payload),
  ]);
  const keptAssetIds = collectAssetIds([
    ...keptArtifacts.map(({ payload }) => payload),
    ...courses
      .filter(({ id }) => keptCourseIds.includes(id))
      .map(({ payload }) => payload),
  ]);
  const exclusiveAssetIds = [...failedAssetIds].filter(
    (assetId) => !keptAssetIds.has(assetId),
  );
  const screenshotIds = collectScreenshotIds(failedArtifacts);
  const workOrderIds = selectIdsByIds(
    database,
    "course_work_orders",
    "course_id",
    failedCourseIds,
  );
  const conversationIds = selectIdsByIds(
    database,
    "conversations",
    "course_id",
    failedCourseIds,
  );
  const previewIds = (database
    .prepare("SELECT id, payload FROM html_previews")
    .all() as TextRow[])
    .filter(({ payload }) =>
      [...failedCourseIds, ...failedTaskIds].some((id) => payload.includes(id)),
    )
    .map(({ id }) => id);
  const cacheKeys = (database
    .prepare("SELECT cache_key AS id, payload FROM asset_cache_entries")
    .all() as TextRow[])
    .filter(({ payload }) =>
      exclusiveAssetIds.some((assetId) => payload.includes(assetId)),
    )
    .map(({ id }) => id);

  const databaseRows = {
    courses: failedCourseIds.length,
    course_tasks: failedTaskIds.length,
    course_execution_claims: countByIds(
      database,
      "course_execution_claims",
      "course_id",
      failedCourseIds,
    ),
    course_task_control_intents: countByIds(
      database,
      "course_task_control_intents",
      "course_id",
      failedCourseIds,
    ),
    conversations: conversationIds.length,
    messages: countByIds(
      database,
      "messages",
      "conversation_id",
      conversationIds,
    ),
    html_previews: previewIds.length,
    course_runs: countByIds(
      database,
      "course_runs",
      "course_id",
      failedCourseIds,
    ),
    course_work_orders: workOrderIds.length,
    course_artifacts: failedArtifacts.length,
    course_tool_operations: countByIds(
      database,
      "course_tool_operations",
      "work_order_id",
      workOrderIds,
    ),
    course_run_events: countByIds(
      database,
      "course_run_events",
      "task_id",
      failedTaskIds,
    ),
    asset_cache_entries: cacheKeys.length,
  };

  const report: FailedCoursePurgeReport = {
    dryRun,
    failedCourseIds,
    failedTaskIds,
    exclusiveAssetIds,
    screenshotIds,
    databaseRows,
    archivedFiles: { workspaces: 0, screenshots: 0, assets: 0 },
  };
  if (dryRun || failedCourseIds.length === 0) return report;

  const backupDirectory = path.join(
    rootDir,
    "backups",
    `failed-courses-${stamp}`,
  );
  await mkdir(backupDirectory, { recursive: true });
  report.backupDirectory = backupDirectory;

  if (options.backup ?? true) {
    const databaseBackupPath = path.join(backupDirectory, "keya.sqlite");
    database.exec("PRAGMA wal_checkpoint(FULL)");
    database.exec(
      `VACUUM INTO '${databaseBackupPath.replaceAll("'", "''")}'`,
    );
    report.databaseBackupPath = databaseBackupPath;
  }

  runInTransaction(database, () => {
    deleteByIds(database, "course_tool_operations", "work_order_id", workOrderIds);
    deleteByIds(database, "course_run_events", "task_id", failedTaskIds);
    deleteByIds(database, "course_artifacts", "course_id", failedCourseIds);
    deleteByIds(database, "course_work_orders", "course_id", failedCourseIds);
    deleteByIds(database, "course_runs", "course_id", failedCourseIds);
    deleteByIds(database, "course_execution_claims", "course_id", failedCourseIds);
    deleteByIds(database, "course_task_control_intents", "course_id", failedCourseIds);
    deleteByIds(database, "messages", "conversation_id", conversationIds);
    deleteByIds(database, "conversations", "id", conversationIds);
    deleteByIds(database, "html_previews", "id", previewIds);
    deleteByIds(database, "asset_cache_entries", "cache_key", cacheKeys);
    deleteByIds(database, "course_tasks", "id", failedTaskIds);
    deleteByIds(database, "courses", "id", failedCourseIds);
  });

  for (const taskId of failedTaskIds) {
    if (
      await archivePath(
        path.join(rootDir, "agent-workspaces", taskId),
        path.join(backupDirectory, "agent-workspaces", taskId),
      )
    ) {
      report.archivedFiles.workspaces += 1;
    }
  }
  for (const screenshotId of screenshotIds) {
    if (
      await archivePath(
        path.join(rootDir, "quality-screenshots", `${screenshotId}.png`),
        path.join(backupDirectory, "quality-screenshots", `${screenshotId}.png`),
      )
    ) {
      report.archivedFiles.screenshots += 1;
    }
  }
  for (const assetId of exclusiveAssetIds) {
    for (const extension of IMAGE_EXTENSIONS) {
      if (
        await archivePath(
          path.join(rootDir, "generated-assets", `${assetId}.${extension}`),
          path.join(
            backupDirectory,
            "generated-assets",
            `${assetId}.${extension}`,
          ),
        )
      ) {
        report.archivedFiles.assets += 1;
      }
    }
  }

  return report;
}

function readStatus(payload: string) {
  try {
    const parsed = JSON.parse(payload) as { status?: unknown };
    return typeof parsed.status === "string" ? parsed.status : undefined;
  } catch {
    return undefined;
  }
}

function collectAssetIds(payloads: string[]) {
  const ids = new Set<string>();
  for (const payload of payloads) {
    for (const match of payload.matchAll(ASSET_ID_PATTERN)) ids.add(match[0]);
  }
  return ids;
}

function collectScreenshotIds(artifacts: TextRow[]) {
  const ids = new Set<string>();
  for (const artifact of artifacts) {
    try {
      visitJson(JSON.parse(artifact.payload), (key, value) => {
        if (
          key === "artifactId" &&
          typeof value === "string" &&
          SCREENSHOT_ID_PATTERN.test(value)
        ) {
          ids.add(value);
        }
      });
    } catch {
      continue;
    }
  }
  return [...ids];
}

function visitJson(
  value: unknown,
  visitor: (key: string, value: unknown) => void,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => visitJson(item, visitor));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child);
    visitJson(child, visitor);
  }
}

function selectRowsByIds(
  database: DatabaseSync,
  table: string,
  column: string,
  ids: string[],
) {
  if (ids.length === 0) return [];
  return database
    .prepare(
      `SELECT id, payload FROM ${table} WHERE ${column} IN (${placeholders(ids)})`,
    )
    .all(...ids) as TextRow[];
}

function selectIdsByIds(
  database: DatabaseSync,
  table: string,
  column: string,
  ids: string[],
) {
  if (ids.length === 0) return [];
  return (
    database
      .prepare(
        `SELECT id FROM ${table} WHERE ${column} IN (${placeholders(ids)})`,
      )
      .all(...ids) as Array<{ id: string }>
  ).map(({ id }) => id);
}

function countByIds(
  database: DatabaseSync,
  table: string,
  column: string,
  ids: string[],
) {
  if (ids.length === 0) return 0;
  const row = database
    .prepare(
      `SELECT count(*) AS count FROM ${table} WHERE ${column} IN (${placeholders(ids)})`,
    )
    .get(...ids) as { count: number };
  return row.count;
}

function deleteByIds(
  database: DatabaseSync,
  table: string,
  column: string,
  ids: string[],
) {
  if (ids.length === 0) return;
  database
    .prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders(ids)})`)
    .run(...ids);
}

function placeholders(ids: string[]) {
  return ids.map(() => "?").join(", ");
}

async function archivePath(source: string, destination: string) {
  try {
    const fileStat = await stat(source);
    if (!fileStat.isFile() && !fileStat.isDirectory()) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
  return true;
}
