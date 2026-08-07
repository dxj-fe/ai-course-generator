import { projectCourseArchitecture } from "@/server/course/projection/architecture";
import {
  CourseArchitectureSchema,
  type CourseArchitecture,
  type CourseCreationBrief,
  type ReferencePack,
  type ReferenceUsage,
  validateReferenceUsages,
} from "@/shared/course-schema";

export type ArchitectureGateIssue = {
  code: string;
  path: string;
  message: string;
};

export type ArchitectureGateResult =
  | { ok: true; architecture: CourseArchitecture }
  | { ok: false; issues: ArchitectureGateIssue[] };

/**
 * 这里只校验可确定的执行合同。课程内容、视觉方向和教学创意由 Agent
 * 结合资料与浏览器证据判断，不能在全局 Gate 中写入特定学科或模板规则。
 */
export function runArchitectureGate(input: {
  candidate: unknown;
  creationBrief: CourseCreationBrief;
  referencePacks: readonly ReferencePack[];
  expectedCourseId: string;
}): ArchitectureGateResult {
  const parsed = CourseArchitectureSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "ARCHITECTURE_SCHEMA_INVALID",
        path: issue.path.join(".") || "root",
        message: issue.message,
      })),
    };
  }

  const architecture = parsed.data;
  const issues: ArchitectureGateIssue[] = [];
  if (architecture.courseId !== input.expectedCourseId) {
    issues.push({
      code: "ARCHITECTURE_COURSE_MISMATCH",
      path: "courseId",
      message: `courseId 必须是 ${input.expectedCourseId}`,
    });
  }

  if (
    typeof input.creationBrief.sectionCount === "number" &&
    architecture.pageTasks.length !== input.creationBrief.sectionCount
  ) {
    issues.push({
      code: "ARCHITECTURE_PAGE_COUNT_MISMATCH",
      path: "pageTasks",
      message: `用户确认了 ${input.creationBrief.sectionCount} 页，当前提交了 ${architecture.pageTasks.length} 页`,
    });
  }

  if (
    architecture.pageTasks.length >= 3 &&
    architecture.pageTasks.filter(
      ({ buildDependsOnPageIds }) => buildDependsOnPageIds.length === 0,
    ).length < 2
  ) {
    issues.push({
      code: "ARCHITECTURE_PARALLELISM_TOO_LOW",
      path: "pageTasks",
      message:
        "至少两页应能直接从 CourseArchitecture 并行开工；移除仅表示学习顺序或承接关系的 buildDependsOnPageIds，只保留必须读取前页实际产物的依赖。",
    });
  }

  architecture.pageTasks.forEach((page, index) => {
    pushReferenceIssues(
      page.referenceUsages,
      input.referencePacks,
      `pageTasks.${index}.referenceUsages`,
      issues,
    );
  });

  (["facts", "examples", "terms"] as const).forEach((collection) => {
    architecture.coursePack[collection].forEach((item, index) => {
      pushReferenceIssues(
        item.sourceUsages,
        input.referencePacks,
        `coursePack.${collection}.${index}.sourceUsages`,
        issues,
      );
    });
  });

  try {
    projectCourseArchitecture(architecture, input.creationBrief);
  } catch (error) {
    issues.push({
      code: "ARCHITECTURE_PROJECTION_INVALID",
      path: "root",
      message:
        error instanceof Error
          ? error.message
          : "CourseArchitecture 无法投影为页面执行合同",
    });
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, architecture };
}

function pushReferenceIssues(
  usages: readonly ReferenceUsage[],
  referencePacks: readonly ReferencePack[],
  path: string,
  issues: ArchitectureGateIssue[],
) {
  const validationIssues = validateReferenceUsages(usages, referencePacks);

  validationIssues.forEach((message) => {
    issues.push({
      code: "REFERENCE_USAGE_INVALID",
      path,
      message,
    });
  });
}
