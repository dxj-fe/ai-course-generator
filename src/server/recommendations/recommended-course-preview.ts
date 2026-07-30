import type { RecommendedCourseDefinition } from "./recommended-course-registry";

export function renderRecommendedCoursePreviewHtml(
  course: RecommendedCourseDefinition,
) {
  const title = escapeHtml(course.title);
  const kicker = escapeHtml(course.preview.kicker);
  const domain = escapeHtml(course.domainLabel);
  const firstPage = escapeHtml(course.outline[0]);
  const audience = escapeHtml(course.audience);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --primary: ${course.preview.primary};
        --surface: ${course.preview.surface};
        --accent: ${course.preview.accent};
      }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; overflow: hidden; }
      body {
        background: var(--surface);
        color: #fff;
        font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      }
      .cover {
        position: relative;
        display: flex;
        width: 100%;
        height: 100%;
        min-height: 100%;
        isolation: isolate;
      }
      .art {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
      }
      .wash {
        position: absolute;
        inset: 0;
        z-index: 1;
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--primary) 92%, transparent) 0%, color-mix(in srgb, var(--primary) 72%, transparent) 36%, transparent 70%),
          linear-gradient(0deg, color-mix(in srgb, var(--primary) 58%, transparent), transparent 54%);
      }
      .cover.right .wash {
        background:
          linear-gradient(270deg, color-mix(in srgb, var(--primary) 92%, transparent) 0%, color-mix(in srgb, var(--primary) 72%, transparent) 36%, transparent 70%),
          linear-gradient(0deg, color-mix(in srgb, var(--primary) 58%, transparent), transparent 54%);
      }
      .cover.bottom .wash {
        background:
          linear-gradient(0deg, color-mix(in srgb, var(--primary) 94%, transparent) 0%, color-mix(in srgb, var(--primary) 70%, transparent) 40%, transparent 75%);
      }
      .content {
        position: relative;
        z-index: 2;
        display: flex;
        width: min(58%, 760px);
        padding: clamp(28px, 5vw, 76px);
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        text-shadow: 0 2px 18px rgb(0 0 0 / 24%);
      }
      .right .content {
        margin-left: auto;
        align-items: flex-end;
        text-align: right;
      }
      .bottom .content {
        width: min(86%, 1120px);
        margin-top: auto;
        justify-content: flex-end;
      }
      .eyebrow {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        border: 1px solid rgb(255 255 255 / 45%);
        border-radius: 999px;
        background: rgb(255 255 255 / 16%);
        padding: 6px 13px;
        color: #fff;
        font-size: clamp(12px, 1.4vw, 18px);
        font-weight: 650;
        letter-spacing: .04em;
        backdrop-filter: blur(12px);
      }
      h1 {
        max-width: 12em;
        margin: clamp(12px, 2vw, 24px) 0 0;
        font-size: clamp(30px, 5.2vw, 74px);
        font-weight: 750;
        line-height: 1.08;
        letter-spacing: -.045em;
      }
      .kicker {
        max-width: 30em;
        margin: clamp(10px, 1.5vw, 18px) 0 0;
        color: rgb(255 255 255 / 86%);
        font-size: clamp(14px, 1.8vw, 24px);
        line-height: 1.55;
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: 9px;
        margin-top: clamp(14px, 2vw, 24px);
        font-size: clamp(11px, 1.2vw, 16px);
      }
      .meta span {
        border-radius: 999px;
        background: rgb(255 255 255 / 90%);
        padding: 7px 11px;
        color: var(--primary);
        font-weight: 650;
        text-shadow: none;
      }
      .page-mark {
        position: absolute;
        right: clamp(20px, 3vw, 44px);
        bottom: clamp(18px, 3vw, 40px);
        z-index: 3;
        display: flex;
        align-items: center;
        gap: 9px;
        border-radius: 18px;
        background: rgb(255 255 255 / 90%);
        padding: 9px 13px;
        color: var(--primary);
        font-size: clamp(10px, 1.1vw, 15px);
        font-weight: 650;
        box-shadow: 0 16px 40px rgb(0 0 0 / 14%);
      }
      .page-mark::before {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent);
        content: "";
      }
      @media (max-width: 700px) {
        .content { display: none; }
        .wash { background: linear-gradient(0deg, rgb(20 48 32 / 18%), transparent 62%); }
        .page-mark { display: none; }
      }
    </style>
  </head>
  <body>
    <main class="cover ${course.preview.layout}">
      <img class="art" src="${course.coverImage}" alt="" />
      <div class="wash" aria-hidden="true"></div>
      <section class="content">
        <span class="eyebrow">${domain} · ${audience}</span>
        <h1>${title}</h1>
        <p class="kicker">${kicker}</p>
        <div class="meta">
          <span>${course.pageCount} 页微课</span>
          <span>约 ${course.durationMinutes} 分钟</span>
        </div>
      </section>
      <span class="page-mark">${firstPage}</span>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
