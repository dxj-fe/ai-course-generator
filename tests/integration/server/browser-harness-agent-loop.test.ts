import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeCourseBrowser } from "../../../src/server/infra/browser/browser-pool";
import { capturePageScreenshot } from "../../../src/server/infra/browser/page-screenshot";
import { PageContentDSLSchema } from "../../../src/shared/course-schema";

describe.runIf(process.env.KEYA_BROWSER_INTEGRATION === "true")(
  "Agent Loop Browser Harness",
  () => {
    let rootDir = "";

    beforeAll(async () => {
      rootDir = await mkdtemp(
        path.join(tmpdir(), "keya-browser-harness-agent-loop-"),
      );
    });

    afterAll(async () => {
      await closeCourseBrowser();
      if (rootDir) await rm(rootDir, { recursive: true, force: true });
    });

    it("返回截图、DOM、Console、网络和受控互动证据", async () => {
      const content = PageContentDSLSchema.parse({
        pageId: "page-browser-loop",
        functionalTemplateId: "agent-authored",
        title: "观察与解释",
        narration: ["先观察两个事实，再展开解释。"],
        blocks: [
          {
            id: "block-01",
            kind: "concept",
            heading: "核心关系",
            body: "页面用可操作的解释帮助学习者形成理解。",
            supportingPoints: [],
          },
        ],
        interaction: {
          type: "reveal",
          prompt: "展开解释",
          items: [
            {
              id: "item-reason",
              label: "查看原因",
              content: "因为两个现象共享同一个关键关系。",
            },
          ],
        },
        usedReferences: [],
        assetSlots: [],
        layoutHints: {
          contentDensity: "sparse",
          visualPriority: "用一个清晰关系作为视觉焦点",
          groupingStrategy: "解释与互动相邻",
          readingOrder: ["block-01"],
        },
        runtime: {
          sceneKind: "explain",
          visualPrimitive: "none",
          motionPlan: {
            intensity: "guided",
            cuePoints: [
              {
                id: "cue-block-01",
                action: "reveal",
                targetId: "block-01",
                delayMs: 0,
                durationMs: 420,
              },
              {
                id: "cue-item-reason",
                action: "reveal",
                targetId: "item-reason",
                delayMs: 120,
                durationMs: 420,
              },
            ],
          },
          completionRule: {
            type: "interaction-complete",
            interactionId: "interaction-page-browser-loop",
          },
        },
      });
      const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{margin:0;min-height:100%}main{box-sizing:border-box;min-height:100vh;padding:32px;display:grid;gap:20px}details{padding:16px;border:1px solid #888}</style>
</head><body><main data-page-id="page-browser-loop">
<article data-block-id="block-01" data-runtime-target-id="block-01"><h1>核心关系</h1><p>页面用可操作的解释帮助学习者形成理解。</p></article>
<section data-interaction-type="reveal" data-interaction-id="interaction-page-browser-loop">
<p>展开解释</p><details data-interaction-item-id="item-reason"><summary>查看原因</summary><p>因为两个现象共享同一个关键关系。</p></details>
</section></main></body></html>`;

      const result = await capturePageScreenshot(
        {
          pageId: content.pageId,
          content,
          html,
          traceId: "trace-browser-agent-loop",
          interactionSteps: [
            { action: "click", selector: "details summary" },
            {
              action: "expectAttribute",
              selector: "details",
              attribute: "open",
              value: "",
            },
            {
              action: "expectText",
              selector: "details p",
              value: "共享同一个关键关系",
            },
          ],
        },
        { enabled: true, rootDir, timeoutMs: 12_000 },
      );

      expect(result.evidence.captures).toHaveLength(3);
      for (const capture of result.evidence.captures) {
        expect(capture.status).toBe("captured");
        expect(capture.diagnostics).toMatchObject({
          console: [],
          pageErrors: [],
          requestFailures: [],
          dom: {
            interactiveCount: expect.any(Number),
            outline: expect.arrayContaining([
              expect.stringContaining("data-block-id=block-01"),
            ]),
          },
          interaction: [
            expect.objectContaining({ action: "click", status: "passed" }),
            expect.objectContaining({
              action: "expectAttribute",
              status: "passed",
            }),
            expect.objectContaining({
              action: "expectText",
              status: "passed",
            }),
          ],
        });
      }
    });
  },
);
