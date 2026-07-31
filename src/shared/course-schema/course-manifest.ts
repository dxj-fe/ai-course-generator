import { z } from "zod";

import { ArtifactRefSchema, type ArtifactKind } from "./course-artifact";
import { CourseIdSchema } from "./course-generation-state";

export const CourseManifestPageSchema = z
  .object({
    pageId: z.string().min(1).max(80),
    order: z.number().int().positive(),
    sourceWorkOrderId: z.string().min(1).max(160),
    contentRef: ArtifactRefSchema,
    assetsRef: ArtifactRefSchema.optional(),
    htmlRef: ArtifactRefSchema,
    qualityRef: ArtifactRefSchema,
    summaryRef: ArtifactRefSchema,
  })
  .strict()
  .superRefine((page, context) => {
    for (const [field, artifact, kind] of [
      ["contentRef", page.contentRef, "page_content"],
      ["assetsRef", page.assetsRef, "page_assets"],
      ["htmlRef", page.htmlRef, "page_html"],
      ["qualityRef", page.qualityRef, "page_quality"],
      ["summaryRef", page.summaryRef, "page_summary"],
    ] as const) {
      if (!artifact) continue;
      requireArtifact(
        artifact.kind,
        kind,
        artifact.pageId,
        page.pageId,
        field,
        context,
      );
    }
  });

/**
 * Reviewer 和最终发布共同使用的精确页面版本集合。
 * hash 不写在 payload 内，避免自引用；服务端对该对象做稳定哈希。
 */
export const CourseManifestSchema = z
  .object({
    courseId: CourseIdSchema,
    architectureRef: ArtifactRefSchema,
    pages: z.array(CourseManifestPageSchema).min(1).max(200),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.architectureRef.kind !== "course_architecture" ||
      manifest.architectureRef.courseId !== manifest.courseId
    ) {
      context.addIssue({
        code: "custom",
        message: "manifest 必须引用当前课程的 course_architecture",
        path: ["architectureRef"],
      });
    }

    const pageIds = manifest.pages.map(({ pageId }) => pageId);
    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({
        code: "custom",
        message: "manifest 不能包含重复页面",
        path: ["pages"],
      });
    }
    [...manifest.pages]
      .sort((left, right) => left.order - right.order)
      .forEach((page, index) => {
        if (page.order !== index + 1) {
          context.addIssue({
            code: "custom",
            message: "manifest 页面 order 必须从 1 连续排列",
            path: ["pages", index, "order"],
          });
        }
        for (const [field, artifact] of Object.entries(page).filter(
          ([field]) => field.endsWith("Ref"),
        ) as Array<[string, z.infer<typeof ArtifactRefSchema>]>) {
          if (artifact.courseId !== manifest.courseId) {
            context.addIssue({
              code: "custom",
              message: "manifest 页面 Artifact 必须属于当前课程",
              path: ["pages", index, field, "courseId"],
            });
          }
        }
      });
  });

function requireArtifact(
  actualKind: ArtifactKind,
  expectedKind: ArtifactKind,
  actualPageId: string | undefined,
  expectedPageId: string,
  field: string,
  context: z.RefinementCtx,
) {
  if (actualKind !== expectedKind || actualPageId !== expectedPageId) {
    context.addIssue({
      code: "custom",
      message: `${field} 必须引用页面 ${expectedPageId} 的 ${expectedKind}`,
      path: [field],
    });
  }
}

export type CourseManifestPage = z.infer<typeof CourseManifestPageSchema>;
export type CourseManifest = z.infer<typeof CourseManifestSchema>;
