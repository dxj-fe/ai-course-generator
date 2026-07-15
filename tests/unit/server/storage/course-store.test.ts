import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCourseStore } from "../../../../src/server/storage/course-store";
import type { CourseGenerationState } from "../../../../src/shared/course-schema";

const directories: string[] = [];

function runningState(
  overrides: Partial<CourseGenerationState> = {},
): CourseGenerationState {
  return {
    version: 1,
    courseId: "course-123",
    traceId: "trace-123",
    userPrompt: "生成太阳系课程",
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    startedAt: "2026-07-15T01:00:00.000Z",
    updatedAt: "2026-07-15T01:00:00.000Z",
    ...overrides,
  };
}

async function temporaryRoot() {
  const directory = await mkdtemp(path.join(tmpdir(), "course-store-test-"));
  directories.push(directory);
  return path.join(directory, "courses");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("course store", () => {
  it("atomically saves and validates a course checkpoint", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseStore({ rootDir });
    const state = runningState();

    await store.save(state);

    const filePath = path.join(rootDir, state.courseId, "course.json");
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual(state);
    await expect(store.load(state.courseId)).resolves.toEqual(state);
    await expect(readdir(path.dirname(filePath))).resolves.toEqual([
      "course.json",
    ]);
  });

  it("returns undefined for a missing course", async () => {
    const store = createCourseStore({ rootDir: await temporaryRoot() });

    await expect(store.load("course-missing")).resolves.toBeUndefined();
  });

  it.each(["../outside", "course/other", "/tmp/course-other", "COURSE-123"])(
    "rejects unsafe course id %s before reading the filesystem",
    async (courseId) => {
      const store = createCourseStore({ rootDir: await temporaryRoot() });

      await expect(store.load(courseId)).rejects.toThrow();
    },
  );

  it("rejects persisted JSON that does not match the generation schema", async () => {
    const rootDir = await temporaryRoot();
    const courseDirectory = path.join(rootDir, "course-123");
    await mkdir(courseDirectory, { recursive: true });
    await writeFile(
      path.join(courseDirectory, "course.json"),
      JSON.stringify({ version: 1, courseId: "course-123" }),
      "utf8",
    );
    const store = createCourseStore({ rootDir });

    await expect(store.load("course-123")).rejects.toThrow();
  });

  it("rejects a valid checkpoint stored under a different course id", async () => {
    const rootDir = await temporaryRoot();
    const courseDirectory = path.join(rootDir, "course-123");
    await mkdir(courseDirectory, { recursive: true });
    await writeFile(
      path.join(courseDirectory, "course.json"),
      JSON.stringify(runningState({ courseId: "course-other" })),
      "utf8",
    );
    const store = createCourseStore({ rootDir });

    await expect(store.load("course-123")).rejects.toThrow(
      "课程检查点 ID 与存储目录不一致",
    );
  });

  it("rejects an invalid checkpoint before writing it", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseStore({ rootDir });
    const invalidState: unknown = {
      ...runningState(),
      version: 2,
    };

    await expect(
      store.save(invalidState as CourseGenerationState),
    ).rejects.toThrow();
    await expect(readdir(rootDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes concurrent checkpoints in invocation order", async () => {
    const rootDir = await temporaryRoot();
    const store = createCourseStore({ rootDir });
    const first = runningState();
    const second = runningState({
      userPrompt: "生成一门三页的太阳系互动课程",
      updatedAt: "2026-07-15T01:00:01.000Z",
    });

    await Promise.all([store.save(first), store.save(second)]);

    await expect(store.load(second.courseId)).resolves.toEqual(second);
    await expect(
      readdir(path.join(rootDir, second.courseId)),
    ).resolves.toEqual(["course.json"]);
  });
});
