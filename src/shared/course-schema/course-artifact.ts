import { z } from "zod";

import { CourseIdSchema } from "./course-generation-state";
import { CourseTaskIdSchema } from "./course-task-event";

export const ArtifactKindSchema = z.enum([
  "course_architecture",
  "course_architecture_candidate",
  "page_content",
  "page_assets",
  "page_html",
  "page_quality",
  "page_summary",
  "course_review",
  "course_manifest",
]);

const ArtifactRefFields = {
  id: z.string().min(1).max(160),
  kind: ArtifactKindSchema,
  courseId: CourseIdSchema,
  pageId: z.string().min(1).max(80).optional(),
  scopeKey: z.string().min(1).max(100),
  revision: z.number().int().positive(),
  contentHash: z.string().min(8).max(160),
} as const;

const PAGE_ARTIFACT_KINDS = new Set([
  "page_content",
  "page_assets",
  "page_html",
  "page_quality",
  "page_summary",
]);

function validateArtifactScope(
  artifact: z.infer<z.ZodObject<typeof ArtifactRefFields>>,
  context: z.RefinementCtx,
) {
  const isPageArtifact = PAGE_ARTIFACT_KINDS.has(artifact.kind);

  if (isPageArtifact && !artifact.pageId) {
    context.addIssue({
      code: "custom",
      message: "页面 Artifact 必须包含 pageId",
      path: ["pageId"],
    });
    return;
  }

  const expectedScopeKey = artifact.pageId
    ? `page:${artifact.pageId}`
    : "course";
  if (artifact.scopeKey !== expectedScopeKey) {
    context.addIssue({
      code: "custom",
      message: `scopeKey 必须为 ${expectedScopeKey}`,
      path: ["scopeKey"],
    });
  }

  if (!isPageArtifact && artifact.pageId) {
    context.addIssue({
      code: "custom",
      message: "课程级 Artifact 不能包含 pageId",
      path: ["pageId"],
    });
  }
}

export const ArtifactRefSchema = z
  .object(ArtifactRefFields)
  .strict()
  .superRefine(validateArtifactScope);

export const CourseArtifactSchema = z
  .object({
    ...ArtifactRefFields,
    taskId: CourseTaskIdSchema,
    createdByWorkOrderId: z.string().min(1).max(160),
    payload: z
      .unknown()
      .refine((value) => value !== undefined, "Artifact payload 不能为 undefined"),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine(validateArtifactScope);

export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type CourseArtifact = z.infer<typeof CourseArtifactSchema>;
