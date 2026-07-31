import type { CourseRunRepository } from "../../../../src/server/course/store/repository";
import {
  CourseReviewSchema,
  PageContentDSLSchema,
  type HtmlOutput,
  type PageContentDSL,
  type QualityReport,
  type WorkOrder,
} from "../../../../src/shared/course-schema";

type EnginePagePayloads = {
  content: PageContentDSL;
  html: HtmlOutput;
  quality: QualityReport;
  summary: { contentDigest: string };
};

type FixCheckpoint = {
  toolName: string;
  kind:
    | "page_content"
    | "page_assets"
    | "page_html"
    | "page_quality";
  payload: unknown;
  invalidates: readonly (
    | "page_content"
    | "page_assets"
    | "page_html"
    | "page_quality"
  )[];
};

export function prepareFixPageSubmission<
  Payloads extends EnginePagePayloads,
>(
  repository: CourseRunRepository,
  workOrder: WorkOrder,
  original: Payloads,
): { payloads: Payloads; checkpoints: FixCheckpoint[] } {
  if (
    workOrder.kind !== "fix_page" ||
    workOrder.scope.type !== "page"
  ) {
    return { payloads: original, checkpoints: [] };
  }
  const reviewRef = workOrder.inputArtifactRefs.find(
    ({ kind }) => kind === "course_review",
  );
  if (!reviewRef) throw new Error("Fix 测试缺少 CourseReview");
  const review = CourseReviewSchema.parse(
    repository.artifacts.load(reviewRef.id)?.payload,
  );
  const causedIds = new Set(workOrder.causedByReviewIssueIds);
  const pageId = workOrder.scope.pageId;
  const directIssues = review.issues.filter(
    (issue) =>
      causedIds.has(issue.id) &&
      issue.scope === "page" &&
      issue.pageId === pageId,
  );
  const target =
    directIssues.length > 0 &&
    directIssues.every(
      ({ targetArtifact }) => targetArtifact === "page_html",
    )
      ? "page_html"
      : "page_content";
  const html = {
    ...original.html,
    html: original.html.html.replace(
      "</main>",
      `<p data-fix-revision="${workOrder.revision}">已按 Review 修订</p></main>`,
    ),
    revision: original.html.revision + 1,
  };
  if (target === "page_html") {
    const baselineRef = workOrder.inputArtifactRefs.find(
      ({ kind }) => kind === "page_content",
    );
    const content = PageContentDSLSchema.parse(
      baselineRef
        ? repository.artifacts.load(baselineRef.id)?.payload
        : undefined,
    );
    const payloads = {
      ...original,
      content,
      html,
    } as Payloads;
    return {
      payloads,
      checkpoints: [
        {
          toolName: "generate_page_html",
          kind: "page_html" as const,
          payload: payloads.html,
          invalidates: ["page_quality"] as const,
        },
        {
          toolName: "inspect_page",
          kind: "page_quality" as const,
          payload: payloads.quality,
          invalidates: [] as const,
        },
      ],
    };
  }

  const content = PageContentDSLSchema.parse({
    ...original.content,
    narration: [
      ...original.content.narration,
      `已根据 Review 完成第 ${workOrder.revision} 版修订。`,
    ],
  });
  const payloads = {
    ...original,
    content,
    html,
    summary: {
      ...original.summary,
      contentDigest: `${original.summary.contentDigest}；已根据 Review 修订`,
    },
  } as Payloads;
  return {
    payloads,
    checkpoints: [
      {
        toolName: "generate_page_content",
        kind: "page_content" as const,
        payload: payloads.content,
        invalidates: [
          "page_assets",
          "page_html",
          "page_quality",
        ] as const,
      },
      {
        toolName: "generate_page_html",
        kind: "page_html" as const,
        payload: payloads.html,
        invalidates: ["page_quality"] as const,
      },
      {
        toolName: "inspect_page",
        kind: "page_quality" as const,
        payload: payloads.quality,
        invalidates: [] as const,
      },
    ],
  };
}
