import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { capturePageScreenshot } from "../../../src/server/infra/browser/page-screenshot";
import { closeCourseBrowser } from "../../../src/server/infra/browser/browser-pool";
import { normalizeTrustedPlayerLayout } from "../../../src/server/agent/plugins/model-steps/course/html-engineer-normalizers";
import {
  PageContentDSLSchema,
  type PageContentDSL,
} from "../../../src/shared/course-schema";
import { getFunctionalTemplateDslExample } from "../../../src/shared/templates/functional";

describe.runIf(process.env.KEYA_BROWSER_INTEGRATION === "true")(
  "真实浏览器截图 QA",
  () => {
    let rootDir = "";

    beforeAll(async () => {
      rootDir = await mkdtemp(
        path.join(tmpdir(), "keya-page-screenshot-browser-"),
      );
    });

    afterAll(async () => {
      await closeCourseBrowser();
      if (rootDir) {
        await rm(rootDir, { recursive: true, force: true });
      }
    });

    it(
      "可点击隐藏原生控件的可见 label，并忽略素材画框中的预期裁切",
      async () => {
        const content = choiceContent();
        const result = await capturePageScreenshot(
          {
            pageId: content.pageId,
            content,
            html: choiceHtml(content),
            traceId: "trace-browser-choice-label",
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        expect(result.evidence.captures).toHaveLength(3);
        for (const capture of result.evidence.captures ?? []) {
          expect(capture.status).toBe("captured");
          expect(capture.metrics).toMatchObject({
            clippedElementCount: 0,
            interactionSubmitTested: true,
            interactionFeedbackVisible: true,
          });
        }
        expect(result.issues.map(({ code }) => code)).not.toEqual(
          expect.arrayContaining([
            "BROWSER_CONTENT_CLIPPED",
            "BROWSER_INTERACTION_SUBMIT_UNTESTED",
          ]),
        );
      },
      30_000,
    );

    it(
      "保留绝对定位封面的作者 max-width，不由布局护栏制造横向溢出",
      async () => {
        const html = normalizeTrustedPlayerLayout(
          `<!doctype html>
<html lang="zh-CN" data-keya-canvas-mode="fluid">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>课程封面</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, main { width: 100%; height: 100%; }
    body { padding: 2rem; }
    main { position: relative; }
    .content { position: absolute; top: 50%; left: 5vw; transform: translateY(-50%); max-width: 40%; }
  </style>
</head>
<body>
  <main data-page-id="page-cover">
    <div class="content">
      <h1>认识 AI，安全使用</h1>
      <p>认识能力边界、核验事实，并保护个人信息。</p>
      <button data-interaction-type="navigate" data-interaction-id="interaction-page-cover">开始学习</button>
    </div>
  </main>
</body>
</html>`,
        );
        if (typeof html !== "string") {
          throw new Error("布局护栏必须返回 HTML 字符串。");
        }

        const result = await capturePageScreenshot(
          {
            pageId: "page-cover",
            html,
            traceId: "trace-browser-positioned-cover",
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        for (const capture of result.evidence.captures ?? []) {
          expect(capture.status).toBe("captured");
          expect(capture.metrics?.horizontalOverflowPx).toBe(0);
          expect(capture.metrics?.touchTargetUnder44Count).toBe(0);
        }
      },
      30_000,
    );

    it(
      "整页 overflow hidden 只交给 contain-fit 比例判断，不重复误报根节点裁切",
      async () => {
        const result = await capturePageScreenshot(
          {
            pageId: "page-root-overflow",
            traceId: "trace-browser-root-overflow",
            html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>根节点缩放检查</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    main { min-height: 130vh; padding: 24px; display: grid; gap: 16px; }
  </style>
</head>
<body>
  <main>
    <h1>太阳系的尺度</h1>
    <p>整页画布由播放器统一缩放；根节点 overflow hidden 不是内部正文裁切证据。</p>
  </main>
</body>
</html>`,
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        expect(result.evidence.captures).toHaveLength(3);
        expect(result.issues.map(({ code }) => code)).not.toContain(
          "BROWSER_CONTENT_CLIPPED",
        );
        for (const capture of result.evidence.captures ?? []) {
          expect(capture.metrics?.clippedElementSelectors).not.toEqual(
            expect.arrayContaining(["html", "body"]),
          );
        }
      },
      30_000,
    );

    it(
      "装饰几何越出 overflow hidden 舞台时不误报正文裁切",
      async () => {
        const result = await capturePageScreenshot(
          {
            pageId: "page-decorative-overflow",
            traceId: "trace-browser-decorative-overflow",
            html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>装饰舞台</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; }
    .stage { position: relative; width: min(100%, 600px); height: 320px; overflow: hidden; }
    .orbit { position: absolute; width: 520px; height: 520px; left: 50%; top: 50%; transform: translate(-50%, -50%); border: 2px solid #888; border-radius: 50%; }
    .label { position: absolute; left: 24px; top: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>太阳系舞台</h1>
    <div class="stage"><div class="orbit" aria-hidden="true"></div><p class="label">轨道关系示意</p></div>
  </main>
</body>
</html>`,
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        expect(result.issues.map(({ code }) => code)).not.toContain(
          "BROWSER_CONTENT_CLIPPED",
        );
        for (const capture of result.evidence.captures ?? []) {
          expect(capture.metrics?.clippedElementCount).toBe(0);
        }
      },
      30_000,
    );

    it(
      "overflow hidden 真正截断正文时仍报告精确元素",
      async () => {
        const result = await capturePageScreenshot(
          {
            pageId: "page-text-clipped",
            traceId: "trace-browser-text-clipped",
            html: `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>正文裁切</title>
  <style>
    body { margin: 0; padding: 24px; }
    #clipped-copy { width: 240px; height: 22px; line-height: 22px; overflow: hidden; }
  </style>
</head>
<body>
  <main>
    <h1>知识解释</h1>
    <div id="clipped-copy">第一行仍可见<br>第二行会被固定高度真实截断</div>
  </main>
</body>
</html>`,
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "BROWSER_CONTENT_CLIPPED",
              location: expect.objectContaining({ selector: "#clipped-copy" }),
            }),
          ]),
        );
      },
      30_000,
    );

    it(
      "低高度画布的过长内容被固定舞台门禁阻断",
      async () => {
        const blocks = Array.from(
          { length: 4 },
          (_, index) =>
            `<div data-block-id="block-0${index + 1}"><details><summary>知识点 ${index + 1}</summary><p>按需展开的详细解释。</p></details></div>`,
        ).join("");
        const items = Array.from(
          { length: 3 },
          (_, index) =>
            `<details data-interaction-item-id="item-0${index + 1}"><summary>对比项 ${index + 1}</summary><p>用于区分概念的短解释。</p></details>`,
        ).join("");
        const html = normalizeTrustedPlayerLayout(
          `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>核心概念对比</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, main { width: 100%; height: 100%; }
    main { padding: 2rem 1.5rem; }
    [data-block-id] { margin-bottom: 2rem; }
    [data-block-id] > details, [data-interaction-item-id] { padding: 1.5rem; }
    [data-interaction-type="reveal"] { margin-top: 2rem; padding: 1.5rem; }
  </style>
</head>
<body>
  <main data-page-id="page-dense-reveal">
    <h1>核心概念对比</h1>
    ${blocks}
    <section data-interaction-type="reveal" data-interaction-id="interaction-page-dense-reveal">
      <p>逐项揭示区别</p>
      <div>${items}</div>
    </section>
  </main>
</body>
</html>`,
        );
        if (typeof html !== "string") {
          throw new Error("布局护栏必须返回 HTML 字符串。");
        }

        const result = await capturePageScreenshot(
          {
            pageId: "page-dense-reveal",
            html,
            traceId: "trace-browser-dense-reveal",
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        for (const capture of result.evidence.captures ?? []) {
          expect(capture.status).toBe("captured");
          expect(capture.metrics?.horizontalOverflowPx).toBe(0);
          expect(capture.metrics?.requiredViewportScale).toBeGreaterThan(0);
        }
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "BROWSER_VERTICAL_OVERFLOW",
              severity: "error",
            }),
          ]),
        );
      },
      30_000,
    );

    it(
      "blocks 与 sort 嵌套过长时要求重新排版或拆页",
      async () => {
        const blocks = Array.from(
          { length: 3 },
          (_, index) =>
            `<details data-block-id="block-0${index + 1}"><summary>环境依据 ${index + 1}</summary><p>按需展开的完整比较依据。</p></details>`,
        ).join("");
        const items = Array.from(
          { length: 3 },
          (_, index) =>
            `<details data-interaction-item-id="item-0${index + 1}"><summary>挑战 ${index + 1}</summary><p>用于排序的关键依据。</p></details>`,
        ).join("");
        const html = normalizeTrustedPlayerLayout(
          `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>生存挑战分析</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, main { width: 100%; height: 100%; }
    main { padding: 2rem 0; }
    .content { padding-left: 40%; padding-right: 1.5rem; }
    h1 { margin-bottom: 1rem; font-size: 2.5rem; }
    .narration, .blocks { margin-bottom: 2.5rem; }
    .blocks { display: flex; flex-direction: column; gap: 1.25rem; }
    [data-block-id], [data-interaction-type="sort"] { padding: 1.25rem; }
    [data-interaction-item-id] { padding: 1rem; margin-bottom: 1.25rem; }
  </style>
</head>
<body>
  <main data-page-id="page-sort-comparison">
    <div class="content">
      <h1>生存挑战分析</h1>
      <div class="narration">先查看环境依据，再完成挑战排序。</div>
      <div class="blocks">${blocks}</div>
      <section data-interaction-type="sort" data-interaction-id="interaction-page-sort-comparison">
        <h2>挑战排序</h2>
        <p>按紧急程度排序</p>
        <div>${items}</div>
        <button data-runtime-submit="true">提交排序</button>
        <p data-feedback-kind="success" hidden>排序依据正确。</p>
        <p data-feedback-kind="retry" hidden>重新检查生存时限。</p>
      </section>
    </div>
  </main>
</body>
</html>`,
        );
        if (typeof html !== "string") {
          throw new Error("布局护栏必须返回 HTML 字符串。");
        }

        const result = await capturePageScreenshot(
          {
            pageId: "page-sort-comparison",
            html,
            traceId: "trace-browser-sort-comparison",
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        for (const capture of result.evidence.captures ?? []) {
          expect(capture.status).toBe("captured");
          expect(capture.metrics?.horizontalOverflowPx).toBe(0);
          expect(capture.metrics?.requiredViewportScale).toBeGreaterThan(0);
        }
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "BROWSER_VERTICAL_OVERFLOW",
              severity: "error",
            }),
          ]),
        );
      },
      30_000,
    );

    it(
      "blocks 与 sort 直接堆叠过长时要求重新排版或拆页",
      async () => {
        const blocks = Array.from(
          { length: 3 },
          (_, index) =>
            `<details data-block-id="block-0${index + 1}"><summary>环境依据 ${index + 1}</summary><p>按需展开的完整比较依据。</p></details>`,
        ).join("");
        const items = Array.from(
          { length: 3 },
          (_, index) =>
            `<details data-interaction-item-id="item-0${index + 1}"><summary>挑战 ${index + 1}</summary><p>用于排序的关键依据。</p></details>`,
        ).join("");
        const html = normalizeTrustedPlayerLayout(
          `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>生存挑战分析</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, main { width: 100%; height: 100%; }
    main { padding: 2rem; }
    h1 { margin-bottom: 1rem; font-size: 2.5rem; }
    .narration { margin-bottom: 2.5rem; }
    [data-block-id], [data-interaction-type="sort"] { padding: 1.25rem; margin-bottom: 1.25rem; }
    [data-interaction-item-id] { padding: 1rem; margin-bottom: 1.25rem; }
  </style>
</head>
<body>
  <main data-page-id="page-direct-sort">
    <h1>生存挑战分析</h1>
    <div class="narration">先查看环境依据，再完成挑战排序。</div>
    ${blocks}
    <section data-interaction-type="sort" data-interaction-id="interaction-page-direct-sort">
      <h2>挑战排序</h2>
      <p>按紧急程度排序</p>
      <div>${items}</div>
      <button data-runtime-submit="true">提交排序</button>
      <p data-feedback-kind="success" hidden>排序依据正确。</p>
      <p data-feedback-kind="retry" hidden>重新检查生存时限。</p>
    </section>
  </main>
</body>
</html>`,
        );
        if (typeof html !== "string") {
          throw new Error("布局护栏必须返回 HTML 字符串。");
        }

        const result = await capturePageScreenshot(
          {
            pageId: "page-direct-sort",
            html,
            traceId: "trace-browser-direct-sort",
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        for (const capture of result.evidence.captures ?? []) {
          expect(capture.status).toBe("captured");
          expect(capture.metrics?.horizontalOverflowPx).toBe(0);
          expect(capture.metrics?.requiredViewportScale).toBeGreaterThan(0);
        }
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "BROWSER_VERTICAL_OVERFLOW",
              severity: "error",
            }),
          ]),
        );
      },
      30_000,
    );

    it(
      "课程对比页长文本堆叠时要求重新排版或拆页",
      async () => {
        const blocks = ["颜色来源差异", "物理过程差异", "观测条件差异"]
          .map(
            (title, index) =>
              `<div class="block" data-block-id="block-0${index + 1}"><details><summary>${title}</summary><p>按需展开的完整对比说明。</p></details></div>`,
          )
          .join("");
        const columns = ["日落", "极光"]
          .map((title, columnIndex) => {
            const items = Array.from(
              { length: 3 },
              (_, itemIndex) =>
                `<div class="sort-item" data-interaction-item-id="item-${columnIndex}-${itemIndex}"><strong>${title}的关键机制</strong><p>包含足够长度并且必须完整显示的机制说明文字</p></div>`,
            ).join("");
            return `<div class="sort-column"><h3>${title}</h3>${items}</div>`;
          })
          .join("");
        const html = normalizeTrustedPlayerLayout(
          `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>日落与极光</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: sans-serif; }
    main { max-width: 76rem; margin: 0 auto; padding: 2rem; }
    h1 { margin-bottom: 1rem; font-size: 1.8rem; }
    .narration, .block { margin-bottom: 2rem; }
    .block, .interaction, .sort-column { padding: 1rem; }
    .sort-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
    .sort-item { padding: .75rem; margin: .5rem 0; }
    button { margin-top: 1rem; padding: .75rem 1.5rem; }
  </style>
</head>
<body>
  <main data-page-id="page-sunset-aurora">
    <h1>对比：日落与极光的颜色机制</h1>
    <div class="narration">完成排序任务，找出两者的关键不同点。</div>
    ${blocks}
    <section class="interaction" data-interaction-type="sort" data-interaction-id="interaction-page-sunset-aurora">
      <p>将以下描述归类到日落或极光。</p>
      <div class="sort-container">${columns}</div>
      <button data-runtime-submit="true">提交答案</button>
      <p data-feedback-kind="success" hidden>回答正确。</p>
      <p data-feedback-kind="retry" hidden>请重新检查。</p>
    </section>
  </main>
</body>
</html>`,
        );
        if (typeof html !== "string") {
          throw new Error("布局护栏必须返回 HTML 字符串。");
        }

        const result = await capturePageScreenshot(
          {
            pageId: "page-sunset-aurora",
            html,
            traceId: "trace-browser-sunset-aurora-sort",
          },
          {
            enabled: true,
            rootDir,
            timeoutMs: 12_000,
          },
        );

        for (const capture of result.evidence.captures ?? []) {
          expect(capture.status).toBe("captured");
          expect(capture.metrics?.horizontalOverflowPx).toBe(0);
          expect(capture.metrics?.requiredViewportScale).toBeGreaterThan(0);
        }
        expect(result.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code: "BROWSER_VERTICAL_OVERFLOW",
              severity: "error",
            }),
          ]),
        );
      },
      30_000,
    );

    it(
      "把未包裹在素材槽中的 SVG 与 canvas 知识图纳入首屏视觉占比",
      async () => {
        const examples = [
          {
            id: "svg-knowledge-graphic",
            markup:
              '<svg id="svg-knowledge-graphic" viewBox="0 0 600 300" aria-label="光路关系图"><path d="M20 150 H580" stroke="#2563eb" stroke-width="12" /></svg>',
          },
          {
            id: "canvas-knowledge-graphic",
            markup:
              '<canvas id="canvas-knowledge-graphic" aria-label="波长关系图"></canvas>',
          },
        ];

        for (const example of examples) {
          const html = `<!doctype html>
<html lang="zh-CN" data-keya-canvas-mode="fluid">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>光路知识图</title>
  <style>
    * { box-sizing: border-box; }
    html, body, main { width: 100%; height: 100%; margin: 0; }
    #${example.id} { display: block; width: 60vw; height: 60vh; }
  </style>
</head>
<body>
  <main data-page-id="page-${example.id}">
    ${example.markup}
  </main>
</body>
</html>`;
          const result = await capturePageScreenshot(
            {
              pageId: `page-${example.id}`,
              html,
              traceId: `trace-browser-${example.id}-prominence`,
            },
            {
              enabled: true,
              rootDir,
              timeoutMs: 12_000,
            },
          );

          for (const capture of result.evidence.captures ?? []) {
            expect(capture.status).toBe("captured");
            expect(capture.metrics?.largestVisualAreaRatio).toBeCloseTo(
              0.36,
              2,
            );
            expect(capture.metrics?.largestVisualSelector).toBe(
              `#${example.id}`,
            );
          }
        }
      },
      30_000,
    );
  },
);

function choiceContent() {
  const example = getFunctionalTemplateDslExample("interactive-quiz");
  if (!example || example.interaction.type !== "choice") {
    throw new Error("interactive-quiz 示例必须包含 choice interaction。");
  }
  const question = example.interaction.questions[0];
  if (!question) throw new Error("choice 示例必须至少包含一道题。");

  return PageContentDSLSchema.parse({
    ...example,
    interaction: {
      type: "choice",
      questions: [question],
    },
    runtime: {
      sceneKind: "practice",
      visualPrimitive: "none",
      motionPlan: {
        intensity: "none",
        cuePoints: [],
      },
      completionRule: {
        type: "correct-answer",
        interactionId: `interaction-${example.pageId}`,
      },
    },
  });
}

function choiceHtml(content: PageContentDSL) {
  if (content.interaction.type !== "choice") {
    throw new Error("测试内容必须是 choice interaction。");
  }
  const question = content.interaction.questions[0]!;
  const options = question.options
    .map(
      (option) =>
        `<label class="choice-option"><input type="radio" name="${question.id}" value="${option.id}"><span>${option.label}</span></label>`,
    )
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${content.title}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body { font: 16px/1.4 system-ui, sans-serif; }
    main { position: relative; width: 100%; height: 100%; padding: 12px; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 8px; }
    h1 { margin: 0; font-size: 24px; }
    [data-interaction-type="choice"] { min-height: 0; padding: 10px; border: 1px solid #889; border-radius: 12px; }
    fieldset { margin: 0 0 8px; padding: 8px; }
    .choice-option { min-height: 44px; display: flex; align-items: center; margin: 4px 0; padding: 6px 10px; border: 1px solid #ccd; border-radius: 8px; cursor: pointer; }
    .choice-option input { position: absolute; width: 1px; height: 1px; opacity: .001; }
    button { min-width: 44px; min-height: 44px; }
    .asset-crop { position: absolute; right: 8px; top: 8px; width: 48px; height: 20px; overflow: hidden; opacity: .1; pointer-events: none; }
    .asset-crop > span { display: block; width: 160px; height: 20px; }
  </style>
</head>
<body>
  <main data-page-id="${content.pageId}">
    <h1>${content.title}</h1>
    <section data-interaction-type="choice" data-interaction-id="interaction-${content.pageId}">
      <fieldset data-question-id="${question.id}">
        <legend>${question.prompt}</legend>
        ${options}
      </fieldset>
      <button type="button" data-runtime-submit="true" disabled>提交答案</button>
      <p data-feedback-kind="success" hidden>${question.feedback.success}</p>
      <p data-feedback-kind="retry" hidden>${question.feedback.retry}</p>
    </section>
    <div class="asset-crop" data-asset-slot-id="asset-slot-99" aria-hidden="true"><span></span></div>
  </main>
</body>
</html>`;
}
