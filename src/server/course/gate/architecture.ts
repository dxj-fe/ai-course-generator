import { projectCourseArchitectureToLegacy } from "@/server/course/legacy/architecture-adapter";
import {
  CourseArchitectureSchema,
  type CourseArchitecture,
  type CourseCreationBrief,
  type ReferencePack,
  type ReferenceUsage,
  validateReferenceUsages,
} from "@/shared/course-schema";
import { getFunctionalTemplate } from "@/shared/templates/functional";
import { getStyleTemplate } from "@/shared/templates/style";

export type ArchitectureGateIssue = {
  code: string;
  path: string;
  message: string;
};

export type ArchitectureGateResult =
  | { ok: true; architecture: CourseArchitecture }
  | { ok: false; issues: ArchitectureGateIssue[] };

/**
 * 只检查能由代码确定的合同。课程是否真正切中用户目标，仍由 Director 做语义验收。
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

  const globalStyle = getStyleTemplate(
    architecture.blueprint.courseRules.styleTemplateId,
  );
  if (!globalStyle) {
    issues.push({
      code: "STYLE_TEMPLATE_NOT_FOUND",
      path: "blueprint.courseRules.styleTemplateId",
      message: `找不到样式模板 ${architecture.blueprint.courseRules.styleTemplateId}`,
    });
  } else {
    const requestedStyle =
      architecture.blueprint.courseRules.visualStyle === "professional"
        ? "minimal"
        : architecture.blueprint.courseRules.visualStyle;
    if (globalStyle.visualStyle !== requestedStyle) {
      issues.push({
        code: "STYLE_TEMPLATE_MISMATCH",
        path: "blueprint.courseRules.styleTemplateId",
        message: `样式模板 ${globalStyle.id} 不属于视觉方向 ${requestedStyle}`,
      });
    }
  }

  architecture.pageTasks.forEach((page, index) => {
    const functionalTemplate = getFunctionalTemplate(
      page.functionalTemplateId,
    );
    if (!functionalTemplate) {
      issues.push({
        code: "FUNCTIONAL_TEMPLATE_NOT_FOUND",
        path: `pageTasks.${index}.functionalTemplateId`,
        message: `找不到功能模板 ${page.functionalTemplateId}`,
      });
    } else if (functionalTemplate.pageType !== page.pageType) {
      issues.push({
        code: "FUNCTIONAL_TEMPLATE_MISMATCH",
        path: `pageTasks.${index}.functionalTemplateId`,
        message: `模板 ${functionalTemplate.id} 只能用于 ${functionalTemplate.pageType}，不能用于 ${page.pageType}`,
      });
    }

    if (
      page.styleTemplateId !==
      architecture.blueprint.courseRules.styleTemplateId
    ) {
      issues.push({
        code: "PAGE_STYLE_VERSION_MISMATCH",
        path: `pageTasks.${index}.styleTemplateId`,
        message: "所有页面必须引用当前 Architecture 的同一个样式模板",
      });
    }

    pushReferenceIssues(
      page.referenceUsages,
      input.referencePacks,
      `pageTasks.${index}.referenceUsages`,
      issues,
    );
  });

  const packItems = [
    ...architecture.coursePack.facts,
    ...architecture.coursePack.examples,
    ...architecture.coursePack.terms,
  ];
  packItems.forEach((item, index) => {
    pushReferenceIssues(
      item.sourceUsages,
      input.referencePacks,
      `coursePack.sources.${index}`,
      issues,
    );
  });

  try {
    projectCourseArchitectureToLegacy(architecture, input.creationBrief);
  } catch (error) {
    issues.push({
      code: "LEGACY_PROJECTION_INVALID",
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
  packs: readonly ReferencePack[],
  path: string,
  issues: ArchitectureGateIssue[],
) {
  validateReferenceUsages(usages, packs).forEach((message) => {
    issues.push({
      code: "REFERENCE_USAGE_INVALID",
      path,
      message,
    });
  });
}
