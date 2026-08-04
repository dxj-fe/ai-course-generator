import { describe, expect, it } from "vitest";

import { runArchitectureGate } from "../../../../src/server/course/gate/architecture";
import {
  createArchitecture,
  createBrief,
  createReferencePack,
  COURSE_ID,
} from "../../../fixtures/course-architecture";

describe("Architecture Gate", () => {
  it("展示顺序不限制生成依赖：前一展示页可以依赖后一展示页", () => {
    const architecture = createArchitecture({
      reverseDisplayDependency: true,
    });

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(
        result.architecture.pageTasks[0]?.buildDependsOnPageIds,
      ).toEqual(["page-summary"]);
      expect(result.architecture.pageTasks.map(({ order }) => order)).toEqual([
        1, 2, 3, 4,
      ]);
    }
  });

  it("拒绝不要求互动的总结页用 reveal 重复总结正文", () => {
    const architecture = createArchitecture();
    const summary = architecture.pageTasks.find(
      ({ pageType }) => pageType === "summary",
    )!;
    summary.acceptance.requiresInteraction = false;
    summary.interactionType = "reveal";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
        expect.objectContaining({
          code: "SUMMARY_INTERACTION_REDUNDANT",
          path: "pageTasks.3.interactionType",
        }),
        ]),
      );
    }
  });

  it("拒绝真实互动与 requiresInteraction=false 的矛盾架构", () => {
    const architecture = createArchitecture();
    architecture.pageTasks[1]!.acceptance.requiresInteraction = false;

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "INTERACTION_ACCEPTANCE_MISMATCH",
          path: "pageTasks.1.acceptance.requiresInteraction",
        }),
      ],
    });
  });

  it("在派工前拒绝 interaction 槽位容不下教学点的模板", () => {
    const architecture = createArchitecture();
    const page = architecture.pageTasks[1]!;
    page.pageType = "story_intro";
    page.functionalTemplateId = "story-intro";
    page.interactionType = "reveal";
    page.teachingPoints = ["稀薄大气", "极端低温", "水冰资源"];
    page.acceptance.requiresInteraction = true;

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
          code: "FUNCTIONAL_TEMPLATE_INTERACTION_CAPACITY_MISMATCH",
          path: "pageTasks.1.functionalTemplateId",
        }),
      ]),
    });
  });

  it("用户明确要求代码原生 Broadside 时拒绝重新规划 AI 图片", () => {
    const architecture = createArchitecture();
    architecture.blueprint.courseRules.visualStyle = "broadside";
    architecture.blueprint.courseRules.styleTemplateId = "broadside";
    architecture.pageTasks.forEach((page) => {
      page.styleTemplateId = "broadside";
    });
    architecture.pageTasks[0]!.assetNeeds = [
      {
        type: "image",
        role: "hero",
        purpose: "展示天空场景",
        required: false,
      },
    ];
    const creationBrief = {
      ...createBrief(),
      originalRequest:
        "使用 frontend-slides Broadside，采用代码原生科学图形，不要小插图。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief,
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "BROADSIDE_CODE_NATIVE_ASSET_CONFLICT",
          path: "pageTasks.0.assetNeeds",
        }),
      ]),
    });
  });
});
