import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  CourseGenerationStateSchema,
  CourseTaskRecordSchema,
} from "@/shared/course-schema";

const DEFAULT_DATABASE_PATH = path.join(
  process.cwd(),
  ".data",
  "keya.sqlite",
);
const LEGACY_DATABASE_NAME = ["sea", "ca.sqlite"].join("");

const globalDatabase = globalThis as typeof globalThis & {
  __keyaDatabase?: DatabaseSync;
};

export function getAppDatabase(databasePath = DEFAULT_DATABASE_PATH) {
  const resolvedPath = path.resolve(databasePath);
  if (resolvedPath === path.resolve(DEFAULT_DATABASE_PATH)) {
    globalDatabase.__keyaDatabase ??= openDatabase(resolvedPath, true);
    return globalDatabase.__keyaDatabase;
  }
  return openDatabase(resolvedPath, false);
}

export function databasePathForRoot(rootDir: string) {
  return path.join(path.resolve(rootDir), "keya.sqlite");
}

export function runInTransaction<Result>(
  database: DatabaseSync,
  operation: () => Result,
) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function openDatabase(databasePath: string, migrateLegacy: boolean) {
  if (migrateLegacy) migrateLegacyDatabaseFile(databasePath);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS courses_updated_at_idx
      ON courses(updated_at DESC);

    CREATE TABLE IF NOT EXISTS course_tasks (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS course_tasks_course_id_idx
      ON course_tasks(course_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS course_tasks_updated_at_idx
      ON course_tasks(updated_at DESC);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      course_id TEXT,
      task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS conversations_updated_at_idx
      ON conversations(updated_at DESC);

    CREATE INDEX IF NOT EXISTS conversations_course_id_idx
      ON conversations(course_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      duration TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS messages_conversation_created_at_idx
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS html_previews (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS html_previews_expires_at_idx
      ON html_previews(expires_at);

    CREATE TABLE IF NOT EXISTS asset_cache_entries (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_request_sets (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  if (migrateLegacy) {
    migrateLegacyDatabaseRows(database, databasePath);
    migrateLegacyJson(database);
  }
  return database;
}

function migrateLegacyDatabaseFile(databasePath: string) {
  if (existsSync(databasePath)) return;

  const legacyPath = path.join(
    path.dirname(databasePath),
    LEGACY_DATABASE_NAME,
  );
  if (!existsSync(legacyPath)) return;

  mkdirSync(path.dirname(databasePath), { recursive: true });
  const legacyDatabase = new DatabaseSync(legacyPath);
  try {
    legacyDatabase.exec("PRAGMA busy_timeout = 5000");
    legacyDatabase.exec(
      `VACUUM INTO '${databasePath.replaceAll("'", "''")}'`,
    );
  } finally {
    legacyDatabase.close();
  }
}

function migrateLegacyDatabaseRows(
  database: DatabaseSync,
  databasePath: string,
) {
  const migrationKey = "legacy-brand-database-merge-v1";
  const completed = database
    .prepare("SELECT value FROM app_metadata WHERE key = ?")
    .get(migrationKey);
  if (completed) return;

  const legacyPath = path.join(
    path.dirname(databasePath),
    LEGACY_DATABASE_NAME,
  );
  if (!existsSync(legacyPath)) {
    database
      .prepare(
        "INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?, ?)",
      )
      .run(migrationKey, new Date().toISOString());
    return;
  }

  database.exec(
    `ATTACH DATABASE '${legacyPath.replaceAll("'", "''")}' AS legacy_brand`,
  );
  try {
    runInTransaction(database, () => {
      database.exec(`
        INSERT INTO courses (id, payload, updated_at)
        SELECT id, payload, updated_at FROM legacy_brand.courses WHERE true
        ON CONFLICT(id) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > courses.updated_at;

        INSERT INTO course_tasks (
          id, course_id, payload, created_at, updated_at
        )
        SELECT id, course_id, payload, created_at, updated_at
        FROM legacy_brand.course_tasks WHERE true
        ON CONFLICT(id) DO UPDATE SET
          course_id = excluded.course_id,
          payload = excluded.payload,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > course_tasks.updated_at;

        INSERT INTO conversations (
          id, title, pinned, course_id, task_id, created_at, updated_at
        )
        SELECT
          id, title, pinned, course_id, task_id, created_at, updated_at
        FROM legacy_brand.conversations WHERE true
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          pinned = excluded.pinned,
          course_id = excluded.course_id,
          task_id = excluded.task_id,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > conversations.updated_at;

        INSERT OR IGNORE INTO messages (
          id, conversation_id, role, content, duration, created_at
        )
        SELECT
          id, conversation_id, role, content, duration, created_at
        FROM legacy_brand.messages;

        INSERT INTO html_previews (
          id, payload, created_at, expires_at
        )
        SELECT id, payload, created_at, expires_at
        FROM legacy_brand.html_previews WHERE true
        ON CONFLICT(id) DO UPDATE SET
          payload = excluded.payload,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at
        WHERE excluded.expires_at > html_previews.expires_at;

        INSERT INTO asset_cache_entries (
          cache_key, payload, updated_at
        )
        SELECT cache_key, payload, updated_at
        FROM legacy_brand.asset_cache_entries WHERE true
        ON CONFLICT(cache_key) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > asset_cache_entries.updated_at;

        INSERT INTO asset_request_sets (
          cache_key, payload, updated_at
        )
        SELECT cache_key, payload, updated_at
        FROM legacy_brand.asset_request_sets WHERE true
        ON CONFLICT(cache_key) DO UPDATE SET
          payload = excluded.payload,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at > asset_request_sets.updated_at;
      `);
      database
        .prepare(
          "INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)",
        )
        .run(migrationKey, new Date().toISOString());
    });
  } finally {
    database.exec("DETACH DATABASE legacy_brand");
  }
}

function migrateLegacyJson(database: DatabaseSync) {
  const migrationKey = "legacy-json-import-v2";
  const completed = database
    .prepare("SELECT value FROM app_metadata WHERE key = ?")
    .get(migrationKey);
  if (completed) return;

  const insertCourse = database.prepare(`
    INSERT INTO courses (id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const insertTask = database.prepare(`
    INSERT INTO course_tasks (id, course_id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  runInTransaction(database, () => {
    for (const payload of readLegacyPayloads(
      path.join(process.cwd(), ".data", "courses"),
      "course.json",
    )) {
      const parsed = CourseGenerationStateSchema.safeParse(payload);
      if (!parsed.success) continue;
      insertCourse.run(
        parsed.data.courseId,
        JSON.stringify(parsed.data),
        parsed.data.updatedAt,
      );
    }

    for (const payload of readLegacyPayloads(
      path.join(process.cwd(), ".data", "course-tasks"),
      "task.json",
    )) {
      const parsed = CourseTaskRecordSchema.safeParse(payload);
      if (!parsed.success) continue;
      insertTask.run(
        parsed.data.taskId,
        parsed.data.courseId,
        JSON.stringify(parsed.data),
        parsed.data.createdAt,
        parsed.data.updatedAt,
      );
    }

    importLegacyAssetCache(database);

    database
      .prepare(
        "INSERT OR IGNORE INTO app_metadata (key, value) VALUES (?, ?)",
      )
      .run(migrationKey, new Date().toISOString());
  });
}

function importLegacyAssetCache(database: DatabaseSync) {
  try {
    const value = JSON.parse(
      readFileSync(
        path.join(process.cwd(), ".data", "asset-cache.json"),
        "utf8",
      ),
    ) as {
      entries?: Record<string, unknown>;
      requestSets?: Record<string, unknown>;
    };
    const timestamp = new Date().toISOString();
    const insertEntry = database.prepare(`
      INSERT INTO asset_cache_entries (cache_key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO NOTHING
    `);
    const insertRequestSet = database.prepare(`
      INSERT INTO asset_request_sets (cache_key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO NOTHING
    `);
    for (const [key, payload] of Object.entries(value.entries ?? {})) {
      insertEntry.run(key, JSON.stringify(payload), timestamp);
    }
    for (const [key, payload] of Object.entries(value.requestSets ?? {})) {
      insertRequestSet.run(key, JSON.stringify(payload), timestamp);
    }
  } catch {
    // 旧缓存缺失或损坏不影响真实历史迁移。
  }
}

function readLegacyPayloads(rootDir: string, fileName: string) {
  const payloads: unknown[] = [];
  let entries: string[];
  try {
    entries = readdirSync(rootDir);
  } catch {
    return payloads;
  }

  for (const entry of entries) {
    const filePath = path.join(rootDir, entry, fileName);
    try {
      if (!statSync(filePath).isFile()) continue;
      payloads.push(JSON.parse(readFileSync(filePath, "utf8")));
    } catch {
      // 旧记录损坏时跳过，避免阻塞数据库初始化。
    }
  }
  return payloads;
}
