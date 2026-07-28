import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pageContentDsl } from "../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../fixtures/generated-html";
import {
  HtmlPreviewFrame,
  routeLessonRuntimeMessage,
} from "../../../src/features/keya/html-preview-frame";

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

  it("enables only the platform runtime for a learner preview", () => {
    const markup = renderToStaticMarkup(
      <HtmlPreviewFrame
        chrome="learner"
        html={buildValidGeneratedHtml(pageContentDsl)}
        runtimeConfig={{
          pageId: pageContentDsl.pageId,
          interaction: pageContentDsl.interaction,
          runtime: {
            runtimeVersion: 1,
            sceneKind: "demo",
            visualPrimitive: "concept-map",
            motionPlan: { intensity: "subtle", cuePoints: [] },
            completionRule: { type: "view" },
          },
        }}
        title="课程学习预览"
      />,
    );

    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).toContain("keya-trusted-runtime");
    expect(markup).not.toContain("allow-same-origin");
  });

  it("ignores delayed messages from the previous lesson document", () => {
    const source = {} as MessageEventSource;
    const otherSource = {} as MessageEventSource;
    const runtimeConfig = {
      pageId: "page-06-achievement",
      interaction: pageContentDsl.interaction,
      runtime: {
        runtimeVersion: 1 as const,
        sceneKind: "demo" as const,
        visualPrimitive: "concept-map" as const,
        motionPlan: { intensity: "subtle" as const, cuePoints: [] },
        completionRule: { type: "view" as const },
      },
    };
    const currentEvent = {
      channel: "keya.lesson-runtime",
      type: "section-ready",
      pageId: runtimeConfig.pageId,
      runtimeVersion: 1,
    };

    expect(
      routeLessonRuntimeMessage(
        { data: currentEvent, source: otherSource },
        source,
        runtimeConfig,
      ),
    ).toEqual({ kind: "ignored", reason: "foreign-source" });
    expect(
      routeLessonRuntimeMessage(
        {
          data: { ...currentEvent, pageId: "page-01-cover" },
          source,
        },
        source,
        runtimeConfig,
      ),
    ).toEqual({ kind: "ignored", reason: "stale-runtime" });
    expect(
      routeLessonRuntimeMessage(
        { data: currentEvent, source },
        source,
        runtimeConfig,
      ),
    ).toMatchObject({ event: currentEvent, kind: "accepted" });
  });

  it("keeps malformed messages visible as protocol errors", () => {
    const source = {} as MessageEventSource;
    const result = routeLessonRuntimeMessage(
      { data: { channel: "unexpected" }, source },
      source,
      {
        pageId: pageContentDsl.pageId,
        interaction: pageContentDsl.interaction,
        runtime: {
          runtimeVersion: 1,
          sceneKind: "demo",
          visualPrimitive: "concept-map",
          motionPlan: { intensity: "subtle", cuePoints: [] },
          completionRule: { type: "view" },
        },
      },
    );

    expect(result.kind).toBe("invalid");
  });
});
