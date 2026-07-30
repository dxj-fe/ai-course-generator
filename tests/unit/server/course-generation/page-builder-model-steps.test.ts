import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import { buildPageWriterCourseContext } from "../../../../src/server/agent/plugins/tools/course/page-builder-model-steps";
import { preparePageBuilder } from "./page-builder-agent-test-support";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Page Builder 上游生成上下文", () => {
  it("把完整课程方向、当前页面职责和真实依赖摘要一次性交给 Page Writer", async () => {
    const prepared = await preparePageBuilder(directories);
    const context = buildPageWriterCourseContext(
      prepared.execution,
    );

    expect(context.courseTitle).toBe(
      prepared.execution.architecture.blueprint.title,
    );
    expect(context.courseRules).toEqual(
      prepared.execution.architecture.blueprint.courseRules,
    );
    expect(context.coursePack).toEqual(
      prepared.execution.architecture.coursePack,
    );
    expect(context.pageTask).toEqual(prepared.execution.pageTask);
    expect(context.pageTask.purpose).toContain("区别");
    expect(context.dependencySummaries).toEqual([]);
  });
});
