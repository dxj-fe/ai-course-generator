import { describe, expect, it } from "vitest";

import { runArchitectureGate } from "../../../../src/server/course/gate/architecture";
import {
  createArchitecture,
  createBrief,
  createReferencePack,
  COURSE_ID,
} from "../../../fixtures/course-architecture";

describe("Architecture Gate", () => {
  it("接受完整且可投影的 Agent 课程规划", () => {
    const result = runArchitectureGate({
      candidate: createArchitecture(),
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("只拒绝确定的课程身份错误", () => {
    const architecture = createArchitecture();
    architecture.courseId = "course-other";
    architecture.coursePack.courseId = "course-other";
    architecture.blueprint.courseId = "course-other";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "ARCHITECTURE_COURSE_MISMATCH",
          path: "courseId",
        }),
      ]),
    });
  });

  it("用户确认页数后拒绝页数不一致", () => {
    const architecture = createArchitecture();
    architecture.pageTasks.pop();

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "ARCHITECTURE_PAGE_COUNT_MISMATCH",
          path: "pageTasks",
        }),
      ]),
    });
  });

  it("拒绝把学习顺序误写成全串行生成依赖", () => {
    const architecture = createArchitecture();
    architecture.pageTasks.forEach((page, index, pages) => {
      page.buildDependsOnPageIds =
        index === 0 ? [] : [pages[index - 1]!.pageId];
    });

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "ARCHITECTURE_PARALLELISM_TOO_LOW",
          path: "pageTasks",
        }),
      ]),
    });
  });

  it("引用错误返回可直接修复的真实字段路径", () => {
    const architecture = createArchitecture();
    architecture.coursePack.facts[0]!.sourceUsages = [
      {
        referencePackId: "ref-000000000000000000000000",
        chunkIds: ["chunk-99"],
      },
    ];

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_USAGE_INVALID",
          path: "coursePack.facts.0.sourceUsages",
        }),
      ]),
    });
  });

  it("不让迁移期互动类型反向约束学习动作", () => {
    const architecture = createArchitecture();
    architecture.pageTasks[1]!.acceptance.requiresInteraction = false;

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("不再用模板注册表或图片槽位限制课程规划", () => {
    const architecture = createArchitecture();
    architecture.blueprint.courseRules.styleTemplateId = "agent-authored";
    architecture.pageTasks.forEach((page, index) => {
      page.functionalTemplateId = `free-form-${index}`;
      page.styleTemplateId = "agent-authored";
    });
    architecture.pageTasks[0]!.assetNeeds = [
      {
        type: "image",
        role: "hero",
        purpose: "由 Page Creator 判断是否值得生成",
        required: false,
      },
    ];

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("视觉方案留给 Page Creator 时仍允许派工", () => {
    const architecture = createArchitecture();
    architecture.pageTasks.forEach((page) => {
      delete page.visualDesign;
    });

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("不再用首尾页型和互动密度阻断投影", () => {
    const architecture = createArchitecture();
    architecture.pageTasks.forEach((page) => {
      page.pageType = "story_intro";
      page.interactionType = "navigate";
    });

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });
});
