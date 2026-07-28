import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import {
  DETERMINISTIC_PAGE_RENDERER_VERSION,
  renderDeterministicPageFallback,
} from "../../../../src/server/html/deterministic-page-fallback";
import { buildFittedLessonSrcDoc } from "../../../../src/shared/html-preview";
import type {
  AssetGenerationResult,
  PageContentDSL,
} from "../../../../src/shared/course-schema";
import { getFunctionalTemplateDslExample } from "../../../../src/shared/templates/functional/dsl-examples";
import { getStyleTemplate } from "../../../../src/shared/templates/style";

const styleTemplate = getStyleTemplate("kids-playful");

if (!styleTemplate) {
  throw new Error("测试需要 kids-playful 样式模板");
}

function getExample(templateId: string) {
  const example = getFunctionalTemplateDslExample(templateId);
  if (!example) throw new Error(`找不到 ${templateId} 示例`);
  return example;
}

function createReadyAsset(
  content: PageContentDSL,
  {
    assetType,
    transparencyUnavailable = false,
  }: {
    assetType: "background" | "character_sticker";
    transparencyUnavailable?: boolean;
  },
): AssetGenerationResult {
  const slot = content.assetSlots[0];
  if (!slot) throw new Error("测试页面必须声明素材槽位");

  return {
    request: {
      assetSlotId: slot.id,
      assetType,
      usage: slot.purpose,
      prompt: "A polished educational illustration without text.",
      transparentBackground: assetType === "character_sticker",
      safeArea: {
        position: assetType === "background" ? "left" : "none",
        coveragePercent: assetType === "background" ? 40 : 0,
        description: "测试安全区",
      },
      aspectRatio: assetType === "background" ? "16:9" : "3:4",
    },
    status: "ready",
    asset: {
      id: `asset-${assetType}`,
      type: "illustration",
      role: slot.role,
      source: "generated",
      status: "ready",
      uri: `/api/assets/asset-${assetType}`,
      altText: slot.altTextGuidance,
      generationPrompt: "A polished educational illustration without text.",
      mimeType: "image/png",
      dimensions:
        assetType === "background"
          ? { width: 1600, height: 900 }
          : { width: 1200, height: 1600 },
      usedByPageIds: [content.pageId],
    },
    provider: "test-provider",
    model: "test-model",
    durationMs: 10,
    ...(transparencyUnavailable
      ? { warnings: ["TRANSPARENCY_UNAVAILABLE"] }
      : {}),
  };
}

function createSubstantialStoryContent(): PageContentDSL {
  const example = getExample("story-intro");
  return {
    ...example,
    title: "毕加索的艺术人生开端",
    narration: [
      "从童年生活到艺术启蒙，沿着三个关键节点观察一位艺术家的风格如何逐步萌芽。",
    ],
    blocks: [
      {
        id: "block-01",
        kind: "fact",
        label: "早期生活背景",
        heading: "童年的艺术起点",
        body: "父亲的美术工作让他很早接触素描与油画，并通过持续训练建立了扎实的观察能力和造型基础。",
        supportingPoints: ["家庭工作室是他最早的艺术实践场所。"],
      },
      {
        id: "block-02",
        kind: "concept",
        label: "艺术启蒙关键",
        heading: "城市文化的影响",
        body: "进入新的城市文化环境后，他接触了更自由的艺术表达，开始尝试突破学院派绘画的既有框架。",
        supportingPoints: ["新的艺术社群拓宽了他的观看方式。"],
      },
      {
        id: "block-03",
        kind: "example",
        label: "早期风格雏形",
        heading: "作品中的变化",
        body: "早期作品仍保留写实基础，但已经更关注人物情感与观看角度，为之后持续探索新的形式埋下伏笔。",
        supportingPoints: ["技术训练与表达探索在这一阶段并行。"],
      },
    ],
    interaction: {
      type: "choice",
      questions: [
        {
          id: "question-01",
          prompt: "哪项经历最能说明艺术环境推动了风格探索？",
          options: [
            { id: "option-01-01", label: "从小接受基础绘画训练" },
            {
              id: "option-01-02",
              label: "接触新的艺术社群并尝试突破传统框架",
            },
            { id: "option-01-03", label: "完成一幅写实主义作品" },
            { id: "option-01-04", label: "整理童年时期的练习手稿" },
          ],
          correctOptionId: "option-01-02",
          feedback: {
            success: "正确，新的艺术环境直接推动了表达方式的变化。",
            retry: "请寻找与艺术环境和表达突破都有关的选项。",
          },
          maxAttempts: 2,
        },
      ],
    },
    layoutHints: {
      ...example.layoutHints,
      readingOrder: ["block-01", "block-02", "block-03"],
    },
  };
}

describe("renderDeterministicPageFallback advanced layout", () => {
  it("marks generated HTML with the current deterministic renderer version", () => {
    const html = renderDeterministicPageFallback({
      content: getExample("story-intro"),
      styleTemplate,
    });

    expect(html).toContain('data-keya-renderer="deterministic"');
    expect(html).toContain(
      `data-keya-renderer-version="${DETERMINISTIC_PAGE_RENDERER_VERSION}"`,
    );
  });

  it("keeps lesson copy visible instead of hiding every block in closed details", () => {
    const content = getExample("story-intro");
    const html = renderDeterministicPageFallback({
      content,
      styleTemplate,
    });

    expect(html).toContain('data-template="story-intro"');
    expect(html).toContain(
      `data-block-count="${String(content.blocks.length)}"`,
    );
    expect(html).not.toContain('<details class="lesson-card"');

    for (const [index, block] of content.blocks.entries()) {
      expect(html).toContain(
        `<article class="lesson-card" data-block-index="${String(index + 1).padStart(2, "0")}" data-block-id="${block.id}">`,
      );
      expect(html).toContain(`<h2>${block.heading}</h2>`);
      expect(html).toContain(`<p>${block.body}</p>`);
    }
  });

  it("turns a single background asset into a full visual region", () => {
    const content = getExample("course-cover");
    const html = renderDeterministicPageFallback({
      assets: [createReadyAsset(content, { assetType: "background" })],
      content,
      styleTemplate,
    });

    expect(html).toContain('data-template="course-cover"');
    expect(html).toContain(
      'class="course-asset-frame asset-panel--background asset-panel--role-hero"',
    );
    expect(html).toContain(
      "main[data-template=\"course-cover\"] .asset-panel",
    );
    expect(html).toContain("height: 100%;");
    expect(html).toContain(
      ".asset-panel--background .course-asset {\n      width: 68%;",
    );
    expect(html).not.toContain("height: min(18vh, 140px)");
  });

  it("lets wide scene assets span the stage instead of cropping them into a narrow rail", () => {
    const content = getExample("story-intro");
    const html = renderDeterministicPageFallback({
      assets: [createReadyAsset(content, { assetType: "background" })],
      content,
      styleTemplate,
    });

    expect(html).toContain(
      ".course-stage:has(.asset-panel--background) .asset-panel",
    );
    expect(html).toContain("grid-area: 1 / 1 / 2 / 3;");
    expect(html).toContain(
      ".course-stage:has(.asset-panel--background) .interaction-panel",
    );
  });

  it("covers the visual rail when a requested transparent sticker is returned opaque", () => {
    const content = getExample("story-intro");
    const html = renderDeterministicPageFallback({
      assets: [
        createReadyAsset(content, {
          assetType: "character_sticker",
          transparencyUnavailable: true,
        }),
      ],
      content,
      styleTemplate,
    });

    expect(html).toContain(
      "asset-panel--character_sticker asset-panel--opaque-sticker",
    );
    expect(html).toContain(
      ".asset-panel--opaque-sticker .course-asset",
    );
    expect(html).toContain("object-fit: cover;");
  });

  it("uses a dedicated two-zone composition for practice and task pages", () => {
    for (const templateId of ["interactive-quiz", "achievement-task"]) {
      const html = renderDeterministicPageFallback({
        content: getExample(templateId),
        styleTemplate,
      });

      expect(html).toContain(`data-template="${templateId}"`);
      expect(html).toContain(
        `main[data-template="${templateId}"] .course-stage`,
      );
      expect(html).toContain(
        `main[data-template="${templateId}"] .course-action`,
      );
    }
  });

  it(
    "fits a substantial story page at native scale without clipping required copy",
    async () => {
      const content = createSubstantialStoryContent();
      const html = buildFittedLessonSrcDoc(
        renderDeterministicPageFallback({
          assets: [createReadyAsset(content, { assetType: "background" })],
          content,
          styleTemplate,
        }),
      );
      const browser = await chromium.launch({ headless: true });

      try {
        for (const viewport of [
          { width: 922, height: 460 },
          { width: 712, height: 650 },
          { width: 366, height: 500 },
        ]) {
          const page = await browser.newPage({ viewport });
          await page.route("**/*", (route) => route.abort());
          await page.setContent(html, { waitUntil: "domcontentloaded" });
          await page.waitForFunction(
            () =>
              document.documentElement.dataset.keyaViewportFitScale !==
              undefined,
          );
          await page.waitForTimeout(32);

          const metrics = (await page.evaluate(`(() => {
            const root = document.documentElement;
            const body = document.body;
            const requiredCopy = Array.from(document.querySelectorAll(
              "h1, .course-narration p, .course-block-summary, .course-block-body, .interaction-panel fieldset"
            ));
            const clippedElementCount = [root, body, ...body.querySelectorAll("*")]
              .filter((element) => {
                if (
                  element === root ||
                  element === body ||
                  element.dataset.keyaFitExpanded === "true"
                ) return false;
                const style = getComputedStyle(element);
                const clipsX = ["hidden", "clip"].includes(style.overflowX);
                const clipsY = ["hidden", "clip"].includes(style.overflowY);
                return (
                  (clipsX && element.scrollWidth > element.clientWidth + 1) ||
                  (clipsY && element.scrollHeight > element.clientHeight + 1)
                );
              }).length;
            return {
              scale: Number(root.dataset.keyaViewportFitScale ?? "0"),
              clippedElementCount,
              requiredCopyVisible: requiredCopy.every((element) => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return (
                  style.display !== "none" &&
                  style.visibility !== "hidden" &&
                  rect.width > 0 &&
                  rect.height > 0 &&
                  rect.left >= -1 &&
                  rect.top >= -1 &&
                  rect.right <= window.innerWidth + 1 &&
                  rect.bottom <= window.innerHeight + 1
                );
              }),
            };
          })()`)) as {
            scale: number;
            clippedElementCount: number;
            requiredCopyVisible: boolean;
          };

          expect(metrics, `${viewport.width}x${viewport.height}`).toMatchObject({
            clippedElementCount: 0,
            requiredCopyVisible: true,
          });
          expect(metrics.scale, `${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(
            0.99,
          );
          await page.close();
        }
      } finally {
        await browser.close();
      }
    },
    15_000,
  );
});
