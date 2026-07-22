import * as archiverModule from "archiver";
import type { Archiver, ZipOptions } from "archiver";
import { Readable } from "node:stream";

import { AiRequestError } from "@/server/ai/error";
import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";

export type CourseArchive = {
  fileName: string;
  stream: ReadableStream<Uint8Array>;
};

type ArchiverFactory = (format: "zip", options?: ZipOptions) => Archiver;

/** 生成不含私有 Agent 数据的课程交付包；素材本体仍由内部 URI 管理。 */
export function createCourseArchive(input: CourseGenerationState): CourseArchive {
  const course = CourseGenerationStateSchema.parse(input);
  if (course.status !== "completed") {
    throw new AiRequestError("课程尚未完成，不能导出正式交付包。");
  }

  // Next ESM 和 Vitest 对 CommonJS `export =` 的 namespace 包装不同。
  const archiverNamespace = archiverModule as unknown as {
    default?: ArchiverFactory;
  };
  const archiver =
    archiverNamespace.default ??
    (archiverModule as unknown as ArchiverFactory);
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.append(`${JSON.stringify(course, null, 2)}\n`, {
    name: "course.json",
  });

  for (const page of course.pages) {
    if (!page.htmlOutput) {
      throw new AiRequestError(`页面 ${page.pageId} 缺少 HTML，无法导出。`);
    }
    archive.append(page.htmlOutput.html, {
      name: `pages/${String(page.order).padStart(2, "0")}-${page.pageId}.html`,
    });
  }

  const manifest = {
    version: 1,
    courseId: course.courseId,
    generatedAt: course.completedAt,
    assets: course.pages.flatMap((page) =>
      page.assets.map((result) => ({
        pageId: page.pageId,
        assetSlotId: result.request.assetSlotId,
        status: result.status,
        asset: result.asset
          ? {
              id: result.asset.id,
              uri: result.asset.uri,
              type: result.asset.type,
              role: result.asset.role,
              mimeType: result.asset.mimeType,
              altText: result.asset.altText,
              dimensions: result.asset.dimensions,
            }
          : undefined,
        fallback: result.fallback,
        warnings: result.warnings,
        errorCode: result.errorCode,
      })),
    ),
  };
  archive.append(`${JSON.stringify(manifest, null, 2)}\n`, {
    name: "assets/manifest.json",
  });

  void archive.finalize();
  return {
    fileName: `${course.courseId}.zip`,
    stream: Readable.toWeb(archive) as ReadableStream<Uint8Array>,
  };
}
