import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pageContentDsl } from "../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../fixtures/generated-html";
import { HtmlPreviewFrame } from "../../../src/features/seaca/html-preview-frame";

describe("HtmlPreviewFrame", () => {
  it("renders valid HTML only inside a no-permissions sandbox", () => {
    const markup = renderToStaticMarkup(
      <HtmlPreviewFrame
        className="h-full grid-rows-[auto_minmax(0,1fr)_auto]"
        frameClassName="h-full min-h-0"
        html={buildValidGeneratedHtml(pageContentDsl)}
        title="课程安全预览"
      />,
    );

    expect(markup).toContain("<iframe");
    expect(markup).toContain('sandbox=""');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain("srcDoc=");
    expect(markup).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    expect(markup).toContain("h-full min-h-0");
    expect(markup).not.toContain("allow-scripts");
    expect(markup).not.toContain("allow-same-origin");
  });

  it("renders structured rejection reasons instead of an iframe", () => {
    const markup = renderToStaticMarkup(
      <HtmlPreviewFrame
        html={'<script src="https://evil.example/x.js"></script>'}
        title="不合规预览"
      />,
    );

    expect(markup).toContain("HTML 已被安全预检拒绝");
    expect(markup).toContain("禁止加载外链脚本");
    expect(markup).not.toContain("<iframe");
  });
});
