import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createHtmlPreviewStore } from "../../../../src/server/preview/store";
import { pageContentDsl } from "../../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../../fixtures/generated-html";

const directories: string[] = [];

async function temporaryDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), "preview-store-test-"));
  directories.push(directory);
  return path.join(directory, "keya.sqlite");
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("HTML preview store", () => {
  it("stores validated HTML in SQLite behind a random id", async () => {
    const store = createHtmlPreviewStore(await temporaryDatabase());
    const saved = await store.save({
      html: buildValidGeneratedHtml(pageContentDsl),
      pageId: pageContentDsl.pageId,
      title: pageContentDsl.title,
    });

    expect(saved.id).not.toContain(pageContentDsl.title);
    await expect(store.load(saved.id)).resolves.toEqual(saved);
  });

  it("rejects unsafe HTML before writing", async () => {
    const store = createHtmlPreviewStore(await temporaryDatabase());
    await expect(
      store.save({
        html: "<html><body><script>alert(1)</script></body></html>",
        pageId: pageContentDsl.pageId,
        title: pageContentDsl.title,
      }),
    ).rejects.toThrow();
  });

  it("removes an expired preview", async () => {
    const databasePath = await temporaryDatabase();
    const store = createHtmlPreviewStore(databasePath);
    const saved = await store.save({
      html: buildValidGeneratedHtml(pageContentDsl),
      pageId: pageContentDsl.pageId,
      title: pageContentDsl.title,
    });
    const database = new DatabaseSync(databasePath);
    database
      .prepare("UPDATE html_previews SET expires_at = ? WHERE id = ?")
      .run("2000-01-01T00:00:00.000Z", saved.id);
    database.close();

    await expect(store.load(saved.id)).resolves.toBeUndefined();
  });
});
