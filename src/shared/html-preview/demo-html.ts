import type { PageContentDSL } from "@/shared/course-schema";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

/**
 * Day 13 只需要一个安全、确定性的预览文档来验证 iframe 架构。
 * 真正由模型生成高质量 HTML 的职责留给 Day 14 HtmlEngineerAgent。
 */
export function buildPagePreviewDemoHtml(content: PageContentDSL) {
  const narration = content.narration
    .map((paragraph) => `<p class="lead">${escapeHtml(paragraph)}</p>`)
    .join("");
  const blocks = content.blocks
    .map(
      (block, index) => `<article class="card">
        <span class="number">${String(index + 1).padStart(2, "0")}</span>
        <div>
          <p class="kind">${escapeHtml(block.kind)}</p>
          <h2>${escapeHtml(block.heading)}</h2>
          <p>${escapeHtml(block.body)}</p>
        </div>
      </article>`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(content.title)}</title>
    <style>
      :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-width: 280px; background: #f8f4ed; color: #382c19; }
      main { width: min(100%, 720px); margin: 0 auto; padding: clamp(22px, 6vw, 52px); }
      .eyebrow { margin: 0; color: #5d9845; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 10px 0 0; font-size: clamp(28px, 8vw, 52px); line-height: 1.08; letter-spacing: -.035em; }
      .lead { margin: 18px 0 0; color: #786d5f; font-size: clamp(15px, 3vw, 18px); line-height: 1.75; }
      .grid { display: grid; gap: 12px; margin-top: 28px; }
      .card { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; border: 1px solid #e6ddd1; border-radius: 18px; background: #fffdf8; padding: 16px; box-shadow: 0 10px 28px -28px rgba(56, 44, 25, .65); }
      .number { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 50%; background: #eff7e9; color: #5d9845; font-size: 11px; font-weight: 700; }
      .kind { margin: 0; color: #77a863; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h2 { margin: 5px 0 0; font-size: 18px; line-height: 1.3; }
      .card p:last-child { margin: 8px 0 0; color: #786d5f; font-size: 14px; line-height: 1.65; }
      .interaction { display: inline-flex; margin-top: 20px; border-radius: 999px; background: #eaf6e3; padding: 7px 11px; color: #4f8938; font-size: 11px; font-weight: 700; }
      @media (min-width: 620px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
    </style>
  </head>
  <body>
    <main data-page-id="${escapeHtml(content.pageId)}">
      <p class="eyebrow">Seaca · 安全课程预览</p>
      <h1>${escapeHtml(content.title)}</h1>
      ${narration}
      <section class="grid" aria-label="课程内容">${blocks}</section>
      <p class="interaction">互动类型 · ${escapeHtml(content.interaction.type)}</p>
    </main>
  </body>
</html>`;
}

