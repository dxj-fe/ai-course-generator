import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

import { HomeHero } from "../../../src/features/keya/home-hero";
import { RecommendedCourseShowcase } from "../../../src/features/keya/recommended-course-showcase";
import { listRecommendedCourses } from "../../../src/server/recommendations/recommended-course-registry";

describe("homepage UI contract", () => {
  beforeEach(() => {
    mocks.push.mockReset();
  });

  it("keeps the branded course creation controls", () => {
    const markup = renderToStaticMarkup(<HomeHero />);

    expect(markup).toContain("让每一个好奇，都长成一门好课");
    expect(markup).toContain("keya-sprout-companion");
    expect(markup).toContain('aria-label="消息输入"');
    expect(markup).toContain('aria-label="添加内容"');
    expect(markup).toContain('aria-label="语音输入"');
    expect(markup).toContain('aria-label="发送"');
    expect(markup).toContain("帮我补上高一数学");
    expect(markup).toContain("30 分钟读懂《论语》");
    expect(markup).toContain("练一段地道英文对话");
    expect(markup).toContain("给我一个学习计划");
    expect(markup).toContain('href="/chat"');
  });

  it("renders one featured and two supporting recommendations from backend data", () => {
    const markup = renderToStaticMarkup(
      <RecommendedCourseShowcase initialData={listRecommendedCourses()} />,
    );

    expect(markup).toContain("本周精选");
    expect(markup).toContain("换一批灵感");
    expect(markup).toContain('name="recommendationCursor"');
    expect(markup).toContain('method="get"');
    expect(markup).toContain("看懂函数的变化");
    expect(markup).toContain("30 分钟读懂《论语》");
    expect(markup).toContain("把英语说得更自然");
    expect(markup).toContain(
      "/api/recommendations/courses/recommended-math-functions/preview",
    );
    expect(markup).toContain("source=recommendation");
    expect(markup).not.toContain("我的真实课程");
    expect(markup).not.toContain("左右滑动");
  });
});
