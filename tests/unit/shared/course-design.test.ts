import { describe, expect, it } from "vitest";

import {
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../fixtures/course-design";
import {
  CourseDesignBriefsSchema,
  CoursePlanSchema,
  DesignDirectionSchema,
  StoryArcSchema,
  VisualBriefSchema,
} from "../../../src/shared/course-schema";

describe("course design schemas", () => {
  it("accepts three aligned professional briefs", () => {
    expect(CoursePlanSchema.parse(courseDesignOutline).pages).toHaveLength(3);
    expect(
      CourseDesignBriefsSchema.parse({
        pedagogy: pedagogyPlan,
        story: storyArc,
        visual: visualBrief,
      }),
    ).toEqual({ pedagogy: pedagogyPlan, story: storyArc, visual: visualBrief });
  });

  it("rejects copied color values in a VisualBrief", () => {
    expect(
      VisualBriefSchema.safeParse({
        ...visualBrief,
        colorUsage: "Use #ffffff for every text label.",
      }).success,
    ).toBe(false);
  });

  it("keeps the final VisualBrief contract strict", () => {
    expect(
      VisualBriefSchema.safeParse({
        ...visualBrief,
        layoutPrinciples: [visualBrief.layoutPrinciples[0]],
      }).success,
    ).toBe(false);
  });

  it("keeps HTML design direction compact while preserving global guardrails", () => {
    const pageGuidance = visualBrief.pageGuidance[0];
    const designDirection = {
      courseThesis: visualBrief.visualConcept,
      globalGuardrails: {
        layoutPrinciples: visualBrief.layoutPrinciples,
        typographyGuidance: visualBrief.typographyGuidance,
        colorUsage: visualBrief.colorUsage,
        assetDirection: {
          medium: visualBrief.assetDirection.medium,
          composition: visualBrief.assetDirection.composition,
        },
        motionGuidance: visualBrief.motionGuidance,
        accessibilityRules: visualBrief.accessibilityRules,
        negativeConstraints: [
          "避免通用后台面板、等权白卡网格和组件展示页",
        ],
      },
      page: {
        theme: pageGuidance.theme,
        proofGoal: pageGuidance.focalPoint,
        composition: pageGuidance.composition,
        graphicMotif: pageGuidance.graphicMotif,
        assetPurpose: pageGuidance.assetPurpose,
      },
      styleReference: {
        goal: "保留模板的字体角色、色场、节奏和图形气质",
        motif: "模板只提供风格灵感，不固定 DOM",
      },
      inspirationNotes: [],
    };

    expect(DesignDirectionSchema.safeParse(designDirection).success).toBe(
      true,
    );
    expect(
      DesignDirectionSchema.safeParse({
        ...designDirection,
        globalGuardrails: {
          ...designDirection.globalGuardrails,
          layoutPrinciples: [
            ...visualBrief.layoutPrinciples,
            "第三条原则",
            "第四条原则",
          ],
        },
      }).success,
    ).toBe(false);
  });

  it("rejects fictional characters when narrative mode is none", () => {
    expect(
      StoryArcSchema.safeParse({ ...storyArc, narrativeMode: "none" }).success,
    ).toBe(false);
  });

  it("accepts aligned professional guidance for more than twelve pages", () => {
    const pageIds = Array.from(
      { length: 20 },
      (_, index) => `page-${String(index + 1).padStart(2, "0")}`,
    );
    const pedagogyGuidance = pageIds.map((pageId) => ({
      ...pedagogyPlan.pageGuidance[0],
      pageId,
    }));
    const storyBeats = pageIds.map((pageId) => ({
      ...storyArc.pageBeats[0],
      pageId,
    }));
    const visualGuidance = pageIds.map((pageId) => ({
      ...visualBrief.pageGuidance[0],
      pageId,
    }));

    expect(
      CourseDesignBriefsSchema.safeParse({
        pedagogy: {
          ...pedagogyPlan,
          pageGuidance: pedagogyGuidance,
        },
        story: { ...storyArc, pageBeats: storyBeats },
        visual: { ...visualBrief, pageGuidance: visualGuidance },
      }).success,
    ).toBe(true);
  });
});
