import type { PageContentDSL } from "../../src/shared/course-schema";

/** 测试专用的最小合规文档；生产 HTML 必须来自 HtmlEngineerAgent。 */
export function buildValidGeneratedHtml(content: PageContentDSL) {
  const blocks = content.blocks
    .map(
      ({ body, heading, id, supportingPoints }) =>
        `<article data-block-id="${id}"><h2>${heading}</h2><p>${body}</p><ul>${supportingPoints
          .map((point) => `<li>${point}</li>`)
          .join("")}</ul></article>`,
    )
    .join("");
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
      ${blocks}
      ${assets}
      <section data-interaction-type="${content.interaction.type}">${interactionText(content)}</section>
    </main>
  </body>
</html>`;
}

function interactionText(content: PageContentDSL) {
  const interaction = content.interaction;

  switch (interaction.type) {
    case "none":
      return "";
    case "navigate":
      return interaction.actionLabel;
    case "reveal":
    case "explore":
      return [
        interaction.prompt,
        ...interaction.items.flatMap((item) => [item.label, item.content]),
      ].join(" ");
    case "choice":
      return interaction.questions
        .flatMap((question) => [
          question.prompt,
          ...question.options.map(({ label }) => label),
          question.feedback.success,
          question.feedback.retry,
        ])
        .join(" ");
    case "sort":
      return [
        interaction.prompt,
        ...interaction.items.flatMap((item) => [item.label, item.content]),
        interaction.feedback.success,
        interaction.feedback.retry,
      ].join(" ");
    case "input":
      return [
        interaction.prompt,
        interaction.placeholder,
        ...interaction.evaluationCriteria,
        interaction.feedback.success,
        interaction.feedback.retry,
      ].join(" ");
  }
}
