import { describe, expect, it } from "vitest";

import { buildCourseBlindReviewPacket } from "@/server/course/page/quality/blind-review";
import type { CourseGenerationState } from "@/shared/course-schema";

describe("课程 A/B 盲测包", () => {
  it("稳定随机化课程身份，公开页面不泄露内部 courseId", () => {
    const packet = buildCourseBlindReviewPacket({
      baseline: course("course-baseline"),
      candidate: course("course-candidate"),
      seed: "test-seed",
    });

    expect(packet.variants.map(({ label }) => label)).toEqual(["A", "B"]);
    expect(new Set(Object.values(packet.answerKey))).toEqual(
      new Set(["course-baseline", "course-candidate"]),
    );
    expect(JSON.stringify(packet.variants)).not.toContain("course-baseline");
    expect(JSON.stringify(packet.variants)).not.toContain("course-candidate");
    expect(packet.dimensions).toHaveLength(5);
  });

  it("拒绝用不同提示词或不同页数做伪 A/B 对比", () => {
    const candidate = course("course-candidate");
    candidate.userPrompt = "另一条课程请求";

    expect(() =>
      buildCourseBlindReviewPacket({
        baseline: course("course-baseline"),
        candidate,
        seed: "test-seed",
      }),
    ).toThrow("同一条课程提示词");
  });
});

function course(courseId: string): CourseGenerationState {
  return {
    courseId,
    traceId: `trace-${courseId}`,
    userPrompt: "为初学者制作一门三页课程",
    status: "running",
    currentStage: "html",
    pages: [1, 2, 3].map((order) => ({
      pageId: `page-${order}`,
      order,
      status: "running",
      currentStage: "html",
      assets: [],
      htmlOutput: {
        html: `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>main{padding:2rem}</style></head><body><main>第 ${order} 页</main></body></html>`,
        revision: 1,
        generatedAt: "2026-08-06T05:00:00.000Z",
      },
    })),
    events: [],
    errors: [],
    startedAt: "2026-08-06T05:00:00.000Z",
    updatedAt: "2026-08-06T05:01:00.000Z",
  };
}
