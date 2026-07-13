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

  it("rejects fictional characters when narrative mode is none", () => {
    expect(
      StoryArcSchema.safeParse({ ...storyArc, narrativeMode: "none" }).success,
    ).toBe(false);
  });
});
