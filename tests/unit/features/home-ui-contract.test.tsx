import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseHistoryItem } from "../../../src/shared/course-schema";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

import { HomeHero } from "../../../src/features/keya/home-hero";
import { WorkGallery } from "../../../src/features/keya/work-gallery";

describe("homepage UI contract", () => {
  beforeEach(() => {
    mocks.push.mockReset();
  });

  it("keeps course creation controls and the empty featured-course path", () => {
    const markup = renderToStaticMarkup(<HomeHero featuredWorks={[]} />);

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
    expect(markup).toContain("还没有真实课程作品");
    expect(markup).toContain('href="/chat"');
  });

  it("keeps gallery filtering, search, status, and course navigation visible", () => {
    const markup = renderToStaticMarkup(
      <WorkGallery works={[historyItem]} />,
    );

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain("全部课程");
    expect(markup).toContain("已完成");
    expect(markup).toContain("生成中");
    expect(markup).toContain("可导出");
    expect(markup).toContain('placeholder="搜索课程"');
    expect(markup).toContain("小小植物学家");
    expect(markup).toContain("观察一粒种子如何长成一株植物");
    expect(markup).toContain('href="/course/course-garden"');
  });
});

const historyItem: CourseHistoryItem = {
  courseId: "course-garden",
  title: "小小植物学家",
  prompt: "观察一粒种子如何长成一株植物",
  status: "completed",
  currentStage: "complete",
  totalPages: 4,
  completedPages: 4,
  referenceCount: 0,
  runCount: 1,
  exportable: true,
  startedAt: "2026-07-29T08:00:00.000Z",
  updatedAt: "2026-07-29T08:10:00.000Z",
  completedAt: "2026-07-29T08:10:00.000Z",
};
