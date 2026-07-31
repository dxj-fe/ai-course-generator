import type { CourseArtifactStore } from "@/server/course/store/artifact";
import { hashStorageValue } from "@/server/infra/database/codec";
import type { ArtifactRef } from "@/shared/course-schema/course-artifact";
import { CourseReviewSchema } from "@/shared/course-schema/course-review";
import { HtmlOutputSchema } from "@/shared/course-schema/page";
import type { WorkOrder } from "@/shared/course-schema/work-order";

type FixSubmissionPayloads = {
  content: unknown;
  html: unknown;
  quality: unknown;
};

export function assertFixSubmissionUsesCurrentCheckpoints(input: {
  artifacts: CourseArtifactStore;
  payloads: FixSubmissionPayloads;
  workOrder: WorkOrder;
}) {
  if (input.workOrder.kind !== "fix_page") return;
  if (input.workOrder.scope.type !== "page") {
    throw new Error("Fix WorkOrder 缺少 page scope");
  }
  const pageId = input.workOrder.scope.pageId;
  const fixInput = loadFixSubmissionInput({
    artifacts: input.artifacts,
    workOrder: input.workOrder,
    pageId,
  });
  const required: Array<
    readonly [ArtifactRef["kind"], unknown]
  > = [
    ["page_html", input.payloads.html],
    ["page_quality", input.payloads.quality],
  ];
  if (fixInput.targetArtifact === "page_content") {
    required.push(["page_content", input.payloads.content]);
  }
  for (const [kind, payload] of required) {
    const ref = input.workOrder.checkpointArtifactRefs.find(
      (candidate) => candidate.kind === kind,
    );
    const artifact = ref
      ? input.artifacts.load(ref.id)
      : undefined;
    if (
      !ref ||
      !artifact ||
      artifact.createdByWorkOrderId !== input.workOrder.id ||
      artifact.contentHash !== hashStorageValue(payload)
    ) {
      throw new Error(
        `Fix WorkOrder 提交必须使用当前返工产生的 ${kind} checkpoint`,
      );
    }
  }

  const contentRef =
    input.workOrder.checkpointArtifactRefs.find(
      ({ kind }) => kind === "page_content",
    );
  if (fixInput.targetArtifact === "page_content") {
    if (
      hashStorageValue(input.payloads.content) ===
      fixInput.baselineContent.contentHash
    ) {
      throw new Error(
        "Fix WorkOrder 的 PageContent 与 baseline 相同，未完成有效修订",
      );
    }
    return;
  }

  if (contentRef) {
    throw new Error(
      "HTML 定向 Fix WorkOrder 不能创建 PageContent checkpoint",
    );
  }
  if (
    hashStorageValue(input.payloads.content) !==
    fixInput.baselineContent.contentHash
  ) {
    throw new Error(
      "HTML 定向 Fix WorkOrder 必须保持 baseline PageContent 不变",
    );
  }
  const submittedHtml = HtmlOutputSchema.parse(
    input.payloads.html,
  );
  const baselineHtml = HtmlOutputSchema.parse(
    fixInput.baselineHtml.payload,
  );
  if (submittedHtml.html === baselineHtml.html) {
    throw new Error(
      "Fix WorkOrder 的 HTML 正文与 baseline 相同，未完成有效修订",
    );
  }
}

function loadFixSubmissionInput(input: {
  artifacts: CourseArtifactStore;
  workOrder: WorkOrder;
  pageId: string;
}) {
  const review = loadUniqueFixInputArtifact(
    input,
    "course_review",
  );
  const parsedReview = CourseReviewSchema.parse(review.payload);
  if (
    parsedReview.courseId !== input.workOrder.courseId ||
    parsedReview.decision !== "revise_pages"
  ) {
    throw new Error("Fix WorkOrder 的 CourseReview 输入无效");
  }
  const causedIds = new Set(
    input.workOrder.causedByReviewIssueIds,
  );
  const causedIssues = parsedReview.issues.filter(({ id }) =>
    causedIds.has(id),
  );
  if (
    causedIds.size === 0 ||
    causedIssues.length !== causedIds.size
  ) {
    throw new Error("Fix WorkOrder 的 Review issue 输入无效");
  }
  const directIssues = causedIssues.filter(
    (issue) =>
      issue.scope === "page" &&
      issue.pageId === input.pageId,
  );
  const targetArtifact =
    directIssues.length === 0 ||
    directIssues.some(
      (issue) => issue.targetArtifact === "page_content",
    )
      ? "page_content"
      : "page_html";

  return {
    targetArtifact,
    baselineContent: loadUniqueFixInputArtifact(
      input,
      "page_content",
    ),
    baselineHtml: loadUniqueFixInputArtifact(
      input,
      "page_html",
    ),
  } as const;
}

function loadUniqueFixInputArtifact(
  input: {
    artifacts: CourseArtifactStore;
    workOrder: WorkOrder;
    pageId: string;
  },
  kind: ArtifactRef["kind"],
) {
  const refs = input.workOrder.inputArtifactRefs.filter(
    (ref) =>
      ref.kind === kind &&
      (kind === "course_review" ||
        ref.pageId === input.pageId),
  );
  if (refs.length !== 1) {
    throw new Error(
      `Fix WorkOrder 必须恰好包含一份 ${kind} baseline`,
    );
  }
  const ref = refs[0]!;
  const artifact = input.artifacts.load(ref.id);
  if (
    !artifact ||
    artifact.kind !== ref.kind ||
    artifact.courseId !== ref.courseId ||
    artifact.pageId !== ref.pageId ||
    artifact.scopeKey !== ref.scopeKey ||
    artifact.revision !== ref.revision ||
    artifact.contentHash !== ref.contentHash
  ) {
    throw new Error(
      `Fix WorkOrder 的 ${kind} baseline 引用失效`,
    );
  }
  return artifact;
}
