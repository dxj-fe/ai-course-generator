import { describe, expect, it } from "vitest";

import {
  LessonRuntimeEventSchema,
  type LessonRuntime,
} from "../../../src/shared/course-schema";
import {
  buildFittedLessonSrcDoc,
  buildTrustedLessonSrcDoc,
} from "../../../src/shared/html-preview";
import { pageContentDsl } from "../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../fixtures/generated-html";

const runtime: LessonRuntime = {
  sceneKind: "practice",
  visualPrimitive: "concept-map",
  motionPlan: {
    intensity: "guided",
    cuePoints: [
      {
        id: "cue-block-01",
        action: "highlight",
        targetId: "block-01",
        delayMs: 100,
        durationMs: 400,
      },
    ],
  },
  completionRule: { type: "view" },
};

describe("trusted lesson runtime", () => {
  it("injects a standalone viewport fit runtime without interaction capabilities", () => {
    const srcDoc = buildFittedLessonSrcDoc(
      buildValidGeneratedHtml(pageContentDsl),
    );

    expect(srcDoc).toContain('id="keya-viewport-fit-style"');
    expect(srcDoc).toContain('id="keya-viewport-fit"');
    expect(srcDoc).toContain('root.dataset.keyaViewportFit = "ready"');
    expect(srcDoc).toContain('window.addEventListener("resize", scheduleFit');
    expect(srcDoc).toContain("document.fonts?.ready.then");
    expect(srcDoc).toContain('image.addEventListener("load", scheduleFit');
    expect(srcDoc).toContain("new MutationObserver");
    expect(srcDoc).toContain("new ResizeObserver");
    expect(srcDoc).toContain("data-keya-fit-expanded");
    expect(srcDoc).toContain('"translate("');
    expect(srcDoc).toContain('"px) scale("');
    expect(srcDoc).not.toContain("postMessage");
    expect(srcDoc).not.toContain("interaction-started");
    expect(srcDoc).not.toContain("keya.lesson-runtime");
    expect(srcDoc).not.toContain("fetch(");
    expect(srcDoc).not.toContain("XMLHttpRequest");
  });

  it("forces marked generated pages to fill the player canvas", () => {
    const html = buildValidGeneratedHtml(pageContentDsl).replace(
      "<html",
      '<html data-keya-canvas-mode="fluid"',
    );
    const srcDoc = buildFittedLessonSrcDoc(html);

    expect(srcDoc).toContain(
      'html[data-keya-viewport-fit="ready"][data-keya-canvas-mode="fluid"] main[data-page-id]',
    );
    expect(srcDoc).toContain(
      'if (root.dataset.keyaCanvasMode !== "fluid") return',
    );
    expect(srcDoc).toContain(
      'node.style.setProperty("width", "100%", "important")',
    );
    expect(srcDoc).toContain(
      'lessonRoot.style.setProperty("overflow", "visible", "important")',
    );
  });

  it("injects only the platform runtime after generated HTML validation", () => {
    const srcDoc = buildTrustedLessonSrcDoc(
      buildValidGeneratedHtml(pageContentDsl),
      {
        pageId: pageContentDsl.pageId,
        interaction: pageContentDsl.interaction,
        runtime,
      },
    );

    expect(srcDoc).toContain('id="keya-trusted-runtime"');
    expect(srcDoc).toContain('id="keya-trusted-runtime-style"');
    expect(srcDoc).toContain('id="keya-viewport-fit"');
    expect(srcDoc).toContain('id="keya-viewport-fit-style"');
    expect(srcDoc).toContain("interaction-started");
    expect(srcDoc).toContain('replace(/["\\\\]/g, "\\\\$&")');
    expect(srcDoc).not.toContain("fetch(");
    expect(srcDoc).not.toContain("XMLHttpRequest");
  });

  it("can keep interaction runtime enabled while QA measures unscaled HTML", () => {
    const srcDoc = buildTrustedLessonSrcDoc(
      buildValidGeneratedHtml(pageContentDsl),
      {
        pageId: pageContentDsl.pageId,
        interaction: pageContentDsl.interaction,
        runtime,
      },
      { viewportFit: false },
    );

    expect(srcDoc).toContain('id="keya-trusted-runtime"');
    expect(srcDoc).not.toContain('id="keya-viewport-fit"');
    expect(srcDoc).not.toContain('id="keya-viewport-fit-style"');
  });

  it("accepts only the strict host message protocol", () => {
    expect(
      LessonRuntimeEventSchema.safeParse({
        channel: "keya.lesson-runtime",
        type: "interaction-submitted",
        pageId: "page-02-knowledge",
        interactionId: "interaction-page-02-knowledge",
        attempt: 1,
        result: "correct",
      }).success,
    ).toBe(true);
    expect(
      LessonRuntimeEventSchema.safeParse({
        channel: "keya.lesson-runtime",
        type: "interaction-submitted",
        pageId: "page-02-knowledge",
        interactionId: "interaction-page-02-knowledge",
        attempt: 1,
        result: "correct",
        html: "<script>parent.location='https://evil.example'</script>",
      }).success,
    ).toBe(false);
  });
});
