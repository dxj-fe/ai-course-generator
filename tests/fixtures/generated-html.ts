import { renderInteraction } from "../../src/server/course/page/deterministic-fallback-markup";
import type { PageContentDSL } from "../../src/shared/course-schema";

/** 测试专用的最小合规文档；生产 HTML 必须来自 HtmlEngineerAgent。 */
export function buildValidGeneratedHtml(content: PageContentDSL) {
  const blocks = content.blocks
    .map(
      ({ body, heading, id, supportingPoints }) =>
        `<article data-block-id="${id}" data-runtime-target-id="${id}"><h2>${heading}</h2><p>${body}</p><ul>${supportingPoints
          .map((point) => `<li>${point}</li>`)
          .join("")}</ul></article>`,
    )
    .join("");
  const visualContent =
    content.runtime.visualPrimitive === "none"
      ? blocks
      : `<section data-visual-primitive="${content.runtime.visualPrimitive}">${blocks}</section>`;
  const assets = content.assetSlots
    .map(
      ({ id, purpose }) =>
        `<figure data-asset-slot-id="${id}"><figcaption>${purpose}</figcaption></figure>`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${content.title}</title>
    <style>:root { color-scheme: light; } body { margin: 0; }</style>
  </head>
  <body>
    <main data-page-id="${content.pageId}">
      <h1>${content.title}</h1>
      ${content.narration.map((text) => `<p>${text}</p>`).join("")}
      ${visualContent}
      ${assets}
      ${renderInteraction(content, false)}
    </main>
  </body>
</html>`;
}
