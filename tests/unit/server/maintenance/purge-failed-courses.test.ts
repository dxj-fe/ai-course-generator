import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { purgeFailedCourses } from "../../../../src/server/course/maintenance/purge-failed-courses";
import { resolveAppDatabase } from "../../../../src/server/infra/database/connection";

const FAILED_COURSE_ID = "course-failed";
const KEPT_COURSE_ID = "course-completed";
const FAILED_TASK_ID = "task-failed";
const FAILED_WORK_ORDER_ID = "work-order-failed";
const EXCLUSIVE_ASSET_ID = "asset-11111111-1111-4111-8111-111111111111";
const SHARED_ASSET_ID = "asset-22222222-2222-4222-8222-222222222222";
const SCREENSHOT_ID = "page-failed-desktop";

describe("purgeFailedCourses", () => {
  it("只清理 failed 课程，并备份数据库和独占文件", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "keya-purge-failed-"));
    const database = resolveAppDatabase({ rootDir });
    seedDatabase(database);
    await seedFiles(rootDir);

    const preview = await purgeFailedCourses({
      rootDir,
      database,
      dryRun: true,
    });
    expect(preview.failedCourseIds).toEqual([FAILED_COURSE_ID]);
    expect(preview.exclusiveAssetIds).toEqual([EXCLUSIVE_ASSET_ID]);
    expect(preview.databaseRows).toMatchObject({
      courses: 1,
      course_tasks: 1,
      course_artifacts: 2,
      course_tool_operations: 1,
      messages: 1,
    });

    const report = await purgeFailedCourses({
      rootDir,
      database,
      dryRun: false,
      now: () => new Date("2026-08-07T10:00:00.000Z"),
    });

    expect(report.archivedFiles).toEqual({
      workspaces: 1,
      screenshots: 1,
      assets: 1,
    });
    expect(report.databaseBackupPath).toBeDefined();
    await expect(readFile(report.databaseBackupPath!)).resolves.not.toHaveLength(0);
    expect(
      database.prepare("SELECT id FROM courses ORDER BY id").all(),
    ).toEqual([{ id: KEPT_COURSE_ID }]);
    expect(
      database.prepare("SELECT count(*) AS count FROM course_tasks").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT count(*) AS count FROM messages").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT count(*) AS count FROM asset_cache_entries").get(),
    ).toEqual({ count: 1 });

    await expect(
      stat(path.join(rootDir, "generated-assets", `${EXCLUSIVE_ASSET_ID}.jpg`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(
        path.join(
          report.backupDirectory!,
          "generated-assets",
          `${EXCLUSIVE_ASSET_ID}.jpg`,
        ),
      ),
    ).resolves.toBeDefined();
    await expect(
      stat(path.join(rootDir, "generated-assets", `${SHARED_ASSET_ID}.jpg`)),
    ).resolves.toBeDefined();

    database.close();
  });
});

function seedDatabase(database: ReturnType<typeof resolveAppDatabase>) {
  const now = "2026-08-07T09:00:00.000Z";
  database
    .prepare("INSERT INTO courses (id, payload, updated_at) VALUES (?, ?, ?)")
    .run(
      FAILED_COURSE_ID,
      JSON.stringify({
        courseId: FAILED_COURSE_ID,
        status: "failed",
        assets: [{ id: EXCLUSIVE_ASSET_ID }, { id: SHARED_ASSET_ID }],
      }),
      now,
    );
  database
    .prepare("INSERT INTO courses (id, payload, updated_at) VALUES (?, ?, ?)")
    .run(
      KEPT_COURSE_ID,
      JSON.stringify({
        courseId: KEPT_COURSE_ID,
        status: "completed",
        assets: [{ id: SHARED_ASSET_ID }],
      }),
      now,
    );
  database
    .prepare(
      "INSERT INTO course_tasks (id, course_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      FAILED_TASK_ID,
      FAILED_COURSE_ID,
      JSON.stringify({ taskId: FAILED_TASK_ID, status: "failed" }),
      now,
      now,
    );
  database
    .prepare(
      "INSERT INTO course_execution_claims (course_id, task_id, claimed_at, updated_at) VALUES (?, ?, ?, ?)",
    )
    .run(FAILED_COURSE_ID, FAILED_TASK_ID, now, now);
  database
    .prepare(
      "INSERT INTO course_task_control_intents (task_id, course_id, action, trace_id, requested_at) VALUES (?, ?, 'cancel', ?, ?)",
    )
    .run(FAILED_TASK_ID, FAILED_COURSE_ID, "trace-failed", now);
  database
    .prepare(
      "INSERT INTO conversations (id, title, course_id, task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("conversation-failed", "失败课程", FAILED_COURSE_ID, FAILED_TASK_ID, now, now);
  database
    .prepare(
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
    )
    .run("message-failed", "conversation-failed", "生成失败", now);
  database
    .prepare(
      "INSERT INTO html_previews (id, payload, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .run(
      "preview-failed",
      JSON.stringify({ courseId: FAILED_COURSE_ID }),
      now,
      "2026-08-08T09:00:00.000Z",
    );
  database
    .prepare(
      "INSERT INTO course_runs (id, task_id, course_id, phase, trace_id, lock_version, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
    )
    .run(
      "run-failed",
      FAILED_TASK_ID,
      FAILED_COURSE_ID,
      "failed",
      "trace-failed",
      "{}",
      now,
      now,
    );
  database
    .prepare(
      "INSERT INTO course_work_orders (id, task_id, course_id, kind, scope_key, status, lock_version, idempotency_key, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
    )
    .run(
      FAILED_WORK_ORDER_ID,
      FAILED_TASK_ID,
      FAILED_COURSE_ID,
      "page_build",
      "page-01",
      "failed",
      "purge-test-work-order",
      "{}",
      now,
      now,
    );
  insertArtifact(database, {
    id: "artifact-assets",
    kind: "page_assets",
    payload: JSON.stringify([
      { asset: { id: EXCLUSIVE_ASSET_ID } },
      { asset: { id: SHARED_ASSET_ID } },
    ]),
    revision: 1,
  });
  insertArtifact(database, {
    id: "artifact-quality",
    kind: "page_quality",
    payload: JSON.stringify({
      screenshotEvidence: { captures: [{ artifactId: SCREENSHOT_ID }] },
    }),
    revision: 1,
  });
  insertArtifact(database, {
    id: "artifact-kept-assets",
    courseId: KEPT_COURSE_ID,
    taskId: "task-kept",
    workOrderId: "work-order-kept",
    kind: "page_assets",
    payload: JSON.stringify([{ asset: { id: SHARED_ASSET_ID } }]),
    revision: 1,
  });
  database
    .prepare(
      "INSERT INTO course_tool_operations (id, work_order_id, execution_attempt, agent_step_number, tool_ordinal, tool_name, input_hash, status, output_artifact_refs, started_at) VALUES (?, ?, 1, 1, 1, 'write', 'hash', 'failed', '[]', ?)",
    )
    .run("operation-failed", FAILED_WORK_ORDER_ID, now);
  database
    .prepare(
      "INSERT INTO course_run_events (id, task_id, sequence, trace_id, type, safe_summary, payload, created_at) VALUES (?, ?, 1, ?, 'failed', '失败', '{}', ?)",
    )
    .run("event-failed", FAILED_TASK_ID, "trace-failed", now);
  database
    .prepare(
      "INSERT INTO asset_cache_entries (cache_key, payload, updated_at) VALUES (?, ?, ?), (?, ?, ?)",
    )
    .run(
      "cache-exclusive",
      JSON.stringify({ asset: { id: EXCLUSIVE_ASSET_ID } }),
      now,
      "cache-shared",
      JSON.stringify({ asset: { id: SHARED_ASSET_ID } }),
      now,
    );
}

function insertArtifact(
  database: ReturnType<typeof resolveAppDatabase>,
  input: {
    id: string;
    kind: string;
    payload: string;
    revision: number;
    courseId?: string;
    taskId?: string;
    workOrderId?: string;
  },
) {
  database
    .prepare(
      "INSERT INTO course_artifacts (id, task_id, course_id, page_id, scope_key, kind, revision, content_hash, created_by_work_order_id, payload, created_at) VALUES (?, ?, ?, 'page-01', 'page-01', ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.id,
      input.taskId ?? FAILED_TASK_ID,
      input.courseId ?? FAILED_COURSE_ID,
      input.kind,
      input.revision,
      `hash-${input.id}`,
      input.workOrderId ?? FAILED_WORK_ORDER_ID,
      input.payload,
      "2026-08-07T09:00:00.000Z",
    );
}

async function seedFiles(rootDir: string) {
  const workspace = path.join(rootDir, "agent-workspaces", FAILED_TASK_ID);
  const screenshots = path.join(rootDir, "quality-screenshots");
  const assets = path.join(rootDir, "generated-assets");
  await Promise.all([
    mkdir(workspace, { recursive: true }),
    mkdir(screenshots, { recursive: true }),
    mkdir(assets, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(workspace, "TASK.md"), "failed"),
    writeFile(path.join(screenshots, `${SCREENSHOT_ID}.png`), "png"),
    writeFile(path.join(assets, `${EXCLUSIVE_ASSET_ID}.jpg`), "exclusive"),
    writeFile(path.join(assets, `${SHARED_ASSET_ID}.jpg`), "shared"),
  ]);
}
