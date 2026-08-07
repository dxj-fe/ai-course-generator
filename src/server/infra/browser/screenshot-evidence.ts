import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  QualityReport,
  QualityScreenshotCapture,
} from "@/shared/course-schema";

const ARTIFACT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;

export type StoredScreenshotImage = {
  pageId: string;
  viewport: QualityScreenshotCapture["viewport"];
  png: Uint8Array;
};

export async function loadStoredScreenshotImages(input: {
  pageId: string;
  quality: QualityReport;
  viewport?: "desktop" | "all";
  rootDir?: string;
}): Promise<StoredScreenshotImage[]> {
  const root = path.resolve(
    /* turbopackIgnore: true */
    input.rootDir ??
      path.join(process.cwd(), ".data", "quality-screenshots"),
  );
  const captures = input.quality.screenshotEvidence?.captures ?? [];
  const selected =
    input.viewport === "all"
      ? captures
      : captures.filter(({ viewport }) => viewport.width >= 900).slice(0, 1);

  const images = await Promise.all(
    selected.map(async (capture) => {
      if (
        capture.status !== "captured" ||
        !capture.artifactId ||
        !ARTIFACT_ID_PATTERN.test(capture.artifactId)
      ) {
        return undefined;
      }
      const filePath = path.resolve(
        /* turbopackIgnore: true */ root,
        `${capture.artifactId}.png`,
      );
      if (!filePath.startsWith(`${root}${path.sep}`)) return undefined;
      try {
        const png = await readFile(filePath);
        if (
          png.byteLength === 0 ||
          png.byteLength > MAX_SCREENSHOT_BYTES
        ) {
          return undefined;
        }
        return {
          pageId: input.pageId,
          viewport: capture.viewport,
          png: new Uint8Array(png),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw error;
      }
    }),
  );
  return images.flatMap((image) => (image ? [image] : []));
}
