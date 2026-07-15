import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pageContentDsl } from "../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../fixtures/generated-html";
import { CoursePreviewGrid } from "../../../src/features/seaca/course-preview-grid";

const firstHtml = buildValidGeneratedHtml(pageContentDsl);
const secondHtml = firstHtml.replace(
  pageContentDsl.title,
  "第二页唯一预览内容",
);

describe("CoursePreviewGrid", () => {
  it("renders one selected completed page and exposes an accessible tab relationship", () => {
    const markup = renderToStaticMarkup(
      <CoursePreviewGrid
        pages={[
          {
            id: "page-02",
            order: 2,
            title: "第二页",
            status: "completed",
            htmlOutput: secondHtml,
          },
          {
            id: "page-01",
            order: 1,
            title: "第一页",
            status: "completed",
            htmlOutput: firstHtml,
          },
        ]}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(2);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-selected="false"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toMatch(/aria-labelledby="[^"]+-page-tab-0"/);
    expect(markup.match(/<iframe/g)).toHaveLength(1);
    expect(markup).toContain("第一页 · 第 1 页课程预览");
    expect(markup).not.toContain("第二页唯一预览内容");
  });

  it("does not mount a preview for a selected failed page", () => {
    const markup = renderToStaticMarkup(
      <CoursePreviewGrid
        pages={[
          {
            id: "page-01",
            order: 1,
            title: "失败页面",
            status: "failed",
            error: "模型输出没有通过 HTML 合同。",
          },
          {
            id: "page-02",
            order: 2,
            title: "等待页面",
            status: "idle",
          },
        ]}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("模型输出没有通过 HTML 合同。");
    expect(markup).not.toContain("<iframe");
  });

  it("renders a stable empty state without a tab interface", () => {
    const markup = renderToStaticMarkup(<CoursePreviewGrid pages={[]} />);

    expect(markup).toContain('aria-label="课程多页预览"');
    expect(markup).toContain("课程页面生成后，可以在这里统一预览。");
    expect(markup).not.toContain('role="tablist"');
  });
});
