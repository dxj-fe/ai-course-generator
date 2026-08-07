import { createHash } from "node:crypto";

import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";

export const COURSE_BLIND_REVIEW_DIMENSIONS = [
  { id: "knowledge", label: "知识深度与准确性" },
  { id: "pedagogy", label: "教学有效性" },
  { id: "visual", label: "视觉完成度与信息表达" },
  { id: "interaction", label: "互动价值" },
  { id: "coherence", label: "跨页连贯性" },
] as const;

export type BlindReviewVariant = {
  label: "A" | "B";
  pages: Array<{
    order: number;
    title: string;
    fileName: string;
    html: string;
  }>;
};

export type CourseBlindReviewPacket = {
  prompt: string;
  dimensions: typeof COURSE_BLIND_REVIEW_DIMENSIONS;
  variants: [BlindReviewVariant, BlindReviewVariant];
  answerKey: Record<"A" | "B", string>;
};

/** 只随机化身份，不用内部质量分数替人决定哪门课更好。 */
export function buildCourseBlindReviewPacket(input: {
  baseline: unknown;
  candidate: unknown;
  seed: string;
}): CourseBlindReviewPacket {
  const baseline = CourseGenerationStateSchema.parse(input.baseline);
  const candidate = CourseGenerationStateSchema.parse(input.candidate);
  assertComparableCourses(baseline, candidate);

  const candidateFirst =
    createHash("sha256")
      .update(`${input.seed}\0${baseline.courseId}\0${candidate.courseId}`)
      .digest()[0]! %
      2 ===
    0;
  const ordered = candidateFirst
    ? [candidate, baseline]
    : [baseline, candidate];
  const labels = ["A", "B"] as const;
  const variants = labels.map((label, index) =>
    toVariant(label, ordered[index]!),
  ) as [BlindReviewVariant, BlindReviewVariant];

  return {
    prompt: baseline.userPrompt,
    dimensions: COURSE_BLIND_REVIEW_DIMENSIONS,
    variants,
    answerKey: {
      A: ordered[0]!.courseId,
      B: ordered[1]!.courseId,
    },
  };
}

function assertComparableCourses(
  baseline: CourseGenerationState,
  candidate: CourseGenerationState,
) {
  if (normalizePrompt(baseline.userPrompt) !== normalizePrompt(candidate.userPrompt)) {
    throw new Error("盲测的 baseline 与 candidate 必须来自同一条课程提示词。");
  }
  if (baseline.pages.length !== candidate.pages.length) {
    throw new Error("盲测的 baseline 与 candidate 必须具有相同页数。");
  }
  if (
    baseline.pages.some(({ htmlOutput }) => !htmlOutput) ||
    candidate.pages.some(({ htmlOutput }) => !htmlOutput)
  ) {
    throw new Error("盲测课程的每一页都必须有 HTML 输出。");
  }
}

function toVariant(
  label: "A" | "B",
  course: CourseGenerationState,
): BlindReviewVariant {
  return {
    label,
    pages: [...course.pages]
      .sort((left, right) => left.order - right.order)
      .map((page) => ({
        order: page.order,
        title: page.content?.title ?? `第 ${page.order} 页`,
        fileName: `page-${String(page.order).padStart(2, "0")}.html`,
        html: page.htmlOutput!.html,
      })),
  };
}

function normalizePrompt(value: string) {
  return value.trim().replace(/\s+/g, " ");
}
