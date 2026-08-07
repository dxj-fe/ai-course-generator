import { describe, expect, it } from "vitest";

import { buildCourseVisualReferences } from "../../../../src/server/course/page/visual-reference";
import {
  createArchitecture,
  createBrief,
} from "../../../fixtures/course-architecture";

describe("课程页面视觉参考", () => {
  it("为并行页面提供同一课程级主配方和精确 frontend-slides 路径", () => {
    const references = buildCourseVisualReferences({
      architecture: createArchitecture(),
      creationBrief: createBrief(),
    });

    expect(references.canvas).toEqual({
      width: 1920,
      height: 1080,
      aspectRatio: "16:9",
    });
    expect(references.primary).toMatchObject({
      id: "minimal",
      recipePath: expect.stringMatching(
        /^agent\/skills\/frontend-slides\/bold-template-pack\/templates\/.+\/design\.md$/,
      ),
    });
    expect(references.alternatives).toHaveLength(2);
    expect(references.usage).toContain("不是 DSL");
  });
});
