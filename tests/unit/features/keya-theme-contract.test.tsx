import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/course",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({
    back: vi.fn(),
    push: vi.fn(),
  }),
}));

import { SiteHeader } from "../../../src/components/site-header";
import { ChatThread } from "../../../src/features/keya/chat-thread";
import { CourseLibrary } from "../../../src/features/keya/course-library";
import { TemplateGallery } from "../../../src/features/template-gallery/components/template-gallery";

describe("课芽全产品主题契约", () => {
  beforeEach(() => {
    mocks.pathname = "/course";
  });

  it("保留共享品牌导航与当前页面状态", () => {
    const markup = renderToStaticMarkup(<SiteHeader />);

    expect(markup).toContain('aria-label="课芽首页"');
    expect(markup).toContain('href="/"');
    expect(markup).toContain('href="/course"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("课芽");
  });

  it("让聊天欢迎态使用学习伙伴与绿色工作区语言", () => {
    const markup = renderToStaticMarkup(<ChatThread conversation={null} />);

    expect(markup).toContain("keya-sprout-companion");
    expect(markup).toContain("keya-gentle-bob");
    expect(markup).toContain("想学点什么？准备");
    expect(markup).toContain("开始");
  });

  it("让课程库继承统一产品壳，同时保留筛选入口", () => {
    const markup = renderToStaticMarkup(<CourseLibrary />);

    expect(markup).toContain("keya-product-shell");
    expect(markup).toContain("我的课程");
    expect(markup).toContain('placeholder="搜索标题、提示词或课程 ID"');
    expect(markup).toContain("全部状态");
    expect(markup).toContain('href="/chat"');
  });

  it("让模板目录使用课芽产品壳，但保留模板自身的 CSS Variables", () => {
    const markup = renderToStaticMarkup(<TemplateGallery />);

    expect(markup).toContain("keya-product-shell");
    expect(markup).toContain("keya-sprout-companion");
    expect(markup).toContain("返回课芽");
    expect(markup).toContain("功能模板");
    expect(markup).toContain("样式主题");
    expect(markup).toContain("--course-color-background");
    expect(markup).not.toContain("返回工程训练台");
  });
});
