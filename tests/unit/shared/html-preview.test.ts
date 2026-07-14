import { describe, expect, it } from "vitest";

import { pageContentDsl } from "../../fixtures/course-design";
import {
  buildPagePreviewDemoHtml,
  sanitizeHtmlLite,
  validateGeneratedHtmlContract,
} from "../../../src/shared/html-preview";

describe("generated HTML preview", () => {
  it("builds a complete, responsive, self-contained document from PageContentDSL", () => {
    const html = buildPagePreviewDemoHtml(pageContentDsl);

    expect(validateGeneratedHtmlContract(html)).toEqual({
      valid: true,
      issues: [],
    });
    expect(sanitizeHtmlLite(html)).toEqual({ safe: true, issues: [] });
    expect(html).toContain("恒星与行星");
    expect(html).toContain("width=device-width, initial-scale=1");
  });

  it("reports every missing required document part", () => {
    const result = validateGeneratedHtmlContract(
      "<html><head></head><body>课程内容</body></html>",
    );

    expect(result.valid).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual([
      "missing_doctype",
      "missing_viewport",
      "missing_style",
    ]);
  });

  it.each([
    [
      "external_script",
      '<script src="https://evil.example/steal.js"></script>',
    ],
    ["external_iframe", '<iframe src="https://evil.example"></iframe>'],
    ["event_handler", '<img src="/safe.png" onerror="steal()">'],
    ["javascript_url", '<a href="javascript:steal()">继续</a>'],
    [
      "meta_refresh",
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    ],
    ["active_embed", '<object data="https://evil.example"></object>'],
    [
      "external_stylesheet",
      '<link rel="stylesheet" href="https://evil.example/theme.css">',
    ],
  ])("rejects %s content before it reaches srcDoc", (code, fragment) => {
    const result = sanitizeHtmlLite(`<!doctype html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body { color: black; }</style>${fragment}
      </head><body>课程</body></html>`);

    expect(result.safe).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(code);
  });

  it("allows inline CSS and data image assets used by a self-contained preview", () => {
    const html = `<!doctype html><html><head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>body { color: #382c19; }</style>
      </head><body><img alt="" src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E"></body></html>`;

    expect(sanitizeHtmlLite(html)).toEqual({ safe: true, issues: [] });
  });
});
