import { describe, expect, it } from "vitest";

import qualityReportExample from "../../../src/shared/course-schema/examples/quality-report.example.json";
import { QualityReportSchema } from "../../../src/shared/course-schema";
import { pageContentDsl } from "../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../fixtures/generated-html";
import {
  loadGeneratedHtmlPreview,
  saveGeneratedHtmlPreview,
} from "../../../src/shared/html-preview";

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe("generated HTML preview cache", () => {
  it("stores HTML behind a random preview id and validates it again on read", () => {
    const storage = createStorage();
    const html = buildValidGeneratedHtml(pageContentDsl);
    const saved = saveGeneratedHtmlPreview(
      { html, pageId: pageContentDsl.pageId, title: pageContentDsl.title },
      storage,
    );

    expect(saved.id).not.toContain(pageContentDsl.title);
    expect(loadGeneratedHtmlPreview(saved.id, storage)).toEqual(saved);
    expect([...storage.values.keys()][0]).toBe(`seaca:html-preview:${saved.id}`);
  });

  it("does not return a cached record after its HTML becomes unsafe", () => {
    const storage = createStorage();
    const saved = saveGeneratedHtmlPreview(
      {
        html: buildValidGeneratedHtml(pageContentDsl),
        pageId: pageContentDsl.pageId,
        title: pageContentDsl.title,
      },
      storage,
    );
    const key = [...storage.values.keys()][0]!;
    const record = JSON.parse(storage.values.get(key)!) as { html: string };
    record.html = record.html.replace(
      "</body>",
      "<script>alert('unsafe')</script></body>",
    );
    storage.values.set(key, JSON.stringify(record));

    expect(loadGeneratedHtmlPreview(saved.id, storage)).toBeUndefined();
  });

  it("removes an expired preview instead of treating browser storage as history", () => {
    const storage = createStorage();
    const saved = saveGeneratedHtmlPreview(
      {
        html: buildValidGeneratedHtml(pageContentDsl),
        pageId: pageContentDsl.pageId,
        title: pageContentDsl.title,
      },
      storage,
    );
    const key = [...storage.values.keys()][0]!;
    const record = JSON.parse(storage.values.get(key)!) as {
      expiresAt: string;
    };
    record.expiresAt = "2000-01-01T00:00:00.000Z";
    storage.values.set(key, JSON.stringify(record));

    expect(loadGeneratedHtmlPreview(saved.id, storage)).toBeUndefined();
    expect(storage.values.has(key)).toBe(false);
  });

  it("stores only a validated quality report for the same page", () => {
    const storage = createStorage();
    const qualityReport = QualityReportSchema.parse({
      ...qualityReportExample,
      id: "quality-page-02",
      target: { type: "page", pageId: pageContentDsl.pageId },
      issues: qualityReportExample.issues.map((issue) => ({
        ...issue,
        location: { ...issue.location, pageId: pageContentDsl.pageId },
      })),
    });
    const saved = saveGeneratedHtmlPreview(
      {
        html: buildValidGeneratedHtml(pageContentDsl),
        pageId: pageContentDsl.pageId,
        qualityReport,
        title: pageContentDsl.title,
      },
      storage,
    );

    expect(saved.version).toBe(2);
    expect(loadGeneratedHtmlPreview(saved.id, storage)?.qualityReport).toEqual(
      qualityReport,
    );
  });
});
