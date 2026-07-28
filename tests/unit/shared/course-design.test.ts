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
  StoryArcSchema,
  VisualBriefSchema,
} from "../../../src/shared/course-schema";

describe("Day 11 course design schemas", () => {
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
