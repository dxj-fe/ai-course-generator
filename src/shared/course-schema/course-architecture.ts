import { z } from "zod";

import { ArtifactRefSchema } from "./course-artifact";
import { CourseIdSchema } from "./course-generation-state";
import {
  AudienceAgeRangeSchema,
  CourseDifficultySchema,
  CourseLanguageSchema,
  VisualStyleSchema,
} from "./intent";
import {
  PageAssetNeedSchema,
  PageInteractionTypeSchema,
  PageTypeSchema,
} from "./page";
import { ReferenceUsageSchema, type ReferenceUsage } from "./reference";

const DomainIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);

const SourceUsagesSchema = z
  .array(ReferenceUsageSchema)
  .max(12)
  .superRefine(validateUniqueReferenceUsages);

export const CoursePackFactSchema = z
  .object({
    id: DomainIdSchema,
    text: z.string().trim().min(2).max(1_000),
    sourceUsages: SourceUsagesSchema,
  })
  .strict();

export const CoursePackTermSchema = z
  .object({
    term: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(2).max(600),
    sourceUsages: SourceUsagesSchema,
  })
  .strict();

export const CoursePackExampleSchema = z
  .object({
    id: DomainIdSchema,
    summary: z.string().trim().min(2).max(1_000),
    sourceUsages: SourceUsagesSchema,
  })
  .strict();

export const CoursePackSchema = z
  .object({
    courseId: CourseIdSchema,
    topic: z.string().trim().min(1).max(160),
    facts: z.array(CoursePackFactSchema).max(80),
    terms: z.array(CoursePackTermSchema).max(80),
    examples: z.array(CoursePackExampleSchema).max(40),
    constraints: z.array(z.string().trim().min(1).max(500)).max(40),
  })
  .strict()
  .superRefine((pack, context) => {
    addDuplicateIdIssues(
      pack.facts.map(({ id }) => id),
      "事实 ID 不能重复",
      ["facts"],
      context,
    );
    addDuplicateIdIssues(
      pack.examples.map(({ id }) => id),
      "示例 ID 不能重复",
      ["examples"],
      context,
    );
  });

export const CourseObjectiveSchema = z
  .object({
    id: DomainIdSchema,
    outcome: z.string().trim().min(2).max(500),
    evidence: z.string().trim().min(2).max(500),
  })
  .strict();

export const CourseBlueprintAudienceSchema = z
  .object({
    description: z.string().trim().min(1).max(300),
    priorKnowledge: z.array(z.string().trim().min(1).max(240)).max(20),
    difficulty: CourseDifficultySchema,
    ageRange: AudienceAgeRangeSchema.optional(),
  })
  .strict();

export const CourseRulesSchema = z
  .object({
    tone: z.string().trim().min(1).max(240),
    terminology: z.array(z.string().trim().min(1).max(120)).max(60),
    visualDirection: z.string().trim().min(2).max(500),
    visualStyle: VisualStyleSchema,
    styleTemplateId: z.string().min(1).max(80),
    teachingPattern: z.array(z.string().trim().min(1).max(240)).min(1).max(20),
  })
  .strict();

export const CourseBlueprintSchema = z
  .object({
    courseId: CourseIdSchema,
    title: z.string().trim().min(1).max(200),
    audience: CourseBlueprintAudienceSchema,
    language: CourseLanguageSchema,
    objectives: z.array(CourseObjectiveSchema).min(1).max(40),
    courseRules: CourseRulesSchema,
  })
  .strict()
  .superRefine((blueprint, context) => {
    addDuplicateIdIssues(
      blueprint.objectives.map(({ id }) => id),
      "学习目标 ID 不能重复",
      ["objectives"],
      context,
    );
  });

export const PageTaskAcceptanceSchema = z
  .object({
    requiredConcepts: z.array(z.string().trim().min(1).max(160)).max(30),
    expectedLearnerOutcome: z.string().trim().min(2).max(500),
    requiresInteraction: z.boolean(),
    pageSpecific: z.array(z.string().trim().min(1).max(300)).max(30),
  })
  .strict();

/** 当前问题独有的视觉命题；整课样式一致不代表逐页复用同一构图。 */
export const PageVisualDesignSchema = z
  .object({
    theme: z.string().trim().min(2).max(240),
    layout: z.string().trim().min(2).max(300),
    graphicMotif: z.string().trim().min(2).max(300),
  })
  .strict();

export const PageTaskSchema = z
  .object({
    pageId: DomainIdSchema,
    order: z.number().int().positive(),
    title: z.string().trim().min(1).max(160),
    pageType: PageTypeSchema,
    purpose: z.string().trim().min(2).max(500),
    objectiveIds: z.array(DomainIdSchema).min(1).max(20),
    buildDependsOnPageIds: z.array(DomainIdSchema).max(20),
    teachingPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
    learnerAction: z.string().trim().min(2).max(500),
    assessment: z.string().trim().min(2).max(500).optional(),
    referenceUsages: SourceUsagesSchema,
    functionalTemplateId: z.string().min(1).max(80),
    styleTemplateId: z.string().min(1).max(80),
    interactionType: PageInteractionTypeSchema,
    assetNeeds: z.array(PageAssetNeedSchema).max(12),
    visualDesign: PageVisualDesignSchema.optional(),
    acceptance: PageTaskAcceptanceSchema,
  })
  .strict()
  .superRefine((page, context) => {
    addDuplicateValueIssue(
      page.objectiveIds,
      "objectiveIds 不能包含重复目标",
      ["objectiveIds"],
      context,
    );
    addDuplicateValueIssue(
      page.buildDependsOnPageIds,
      "buildDependsOnPageIds 不能包含重复页面",
      ["buildDependsOnPageIds"],
      context,
    );
    if (page.buildDependsOnPageIds.includes(page.pageId)) {
      context.addIssue({
        code: "custom",
        message: "页面不能把自己作为生成依赖",
        path: ["buildDependsOnPageIds"],
      });
    }
    if (
      page.acceptance.requiresInteraction &&
      page.interactionType === "none"
    ) {
      context.addIssue({
        code: "custom",
        message: "要求互动的页面不能使用 none interactionType",
        path: ["interactionType"],
      });
    }
  });

export const CourseArchitectureSchema = z
  .object({
    courseId: CourseIdSchema,
    coursePack: CoursePackSchema,
    blueprint: CourseBlueprintSchema,
    pageTasks: z.array(PageTaskSchema).min(1).max(200),
  })
  .strict()
  .superRefine(validateCourseArchitecture);

export const ArchitectureSubmissionSchema = z
  .object({
    architectureRef: ArtifactRefSchema,
  })
  .strict()
  .superRefine((submission, context) => {
    if (submission.architectureRef.kind !== "course_architecture") {
      context.addIssue({
        code: "custom",
        message: "ArchitectureSubmission 必须引用 course_architecture Artifact",
        path: ["architectureRef", "kind"],
      });
    }
  });

function validateCourseArchitecture(
  architecture: z.infer<typeof CourseArchitectureSchema>,
  context: z.RefinementCtx,
) {
  if (architecture.coursePack.courseId !== architecture.courseId) {
    context.addIssue({
      code: "custom",
      message: "CoursePack.courseId 必须与 CourseArchitecture 一致",
      path: ["coursePack", "courseId"],
    });
  }
  if (architecture.blueprint.courseId !== architecture.courseId) {
    context.addIssue({
      code: "custom",
      message: "CourseBlueprint.courseId 必须与 CourseArchitecture 一致",
      path: ["blueprint", "courseId"],
    });
  }

  const objectiveIds = new Set(
    architecture.blueprint.objectives.map(({ id }) => id),
  );
  const pageIds = architecture.pageTasks.map(({ pageId }) => pageId);
  const pageIdSet = new Set(pageIds);
  addDuplicateIdIssues(
    pageIds,
    "PageTask.pageId 不能重复",
    ["pageTasks"],
    context,
  );

  const orders = architecture.pageTasks.map(({ order }) => order);
  addDuplicateIdIssues(
    orders,
    "PageTask.order 不能重复",
    ["pageTasks"],
    context,
  );
  const sortedOrders = [...orders].sort((left, right) => left - right);
  sortedOrders.forEach((order, index) => {
    if (order !== index + 1) {
      context.addIssue({
        code: "custom",
        message: "PageTask.order 必须从 1 开始连续排列",
        path: ["pageTasks"],
      });
    }
  });

  const teachingCoverage = new Map<string, number>();
  const assessmentCoverage = new Map<string, number>();

  architecture.pageTasks.forEach((page, pageIndex) => {
    page.objectiveIds.forEach((objectiveId, objectiveIndex) => {
      if (!objectiveIds.has(objectiveId)) {
        context.addIssue({
          code: "custom",
          message: `页面引用了不存在的学习目标 ${objectiveId}`,
          path: ["pageTasks", pageIndex, "objectiveIds", objectiveIndex],
        });
        return;
      }
      teachingCoverage.set(
        objectiveId,
        (teachingCoverage.get(objectiveId) ?? 0) + 1,
      );
      if (page.assessment) {
        assessmentCoverage.set(
          objectiveId,
          (assessmentCoverage.get(objectiveId) ?? 0) + 1,
        );
      }
    });

    page.buildDependsOnPageIds.forEach((dependencyId, dependencyIndex) => {
      if (!pageIdSet.has(dependencyId)) {
        context.addIssue({
          code: "custom",
          message: `页面引用了不存在的生成依赖 ${dependencyId}`,
          path: [
            "pageTasks",
            pageIndex,
            "buildDependsOnPageIds",
            dependencyIndex,
          ],
        });
      }
    });
  });

  architecture.blueprint.objectives.forEach((objective, objectiveIndex) => {
    if (!teachingCoverage.has(objective.id)) {
      context.addIssue({
        code: "custom",
        message: `学习目标 ${objective.id} 没有对应教学页面`,
        path: ["blueprint", "objectives", objectiveIndex],
      });
    }
    if (!assessmentCoverage.has(objective.id)) {
      context.addIssue({
        code: "custom",
        message: `学习目标 ${objective.id} 没有对应练习或证据页面`,
        path: ["blueprint", "objectives", objectiveIndex, "evidence"],
      });
    }
  });

  if (hasDependencyCycle(architecture.pageTasks)) {
    context.addIssue({
      code: "custom",
      message: "buildDependsOnPageIds 不能形成依赖环",
      path: ["pageTasks"],
    });
  }
}

function hasDependencyCycle(pages: Array<z.infer<typeof PageTaskSchema>>) {
  const dependencies = new Map(
    pages.map((page) => [page.pageId, page.buildDependsOnPageIds]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (pageId: string): boolean => {
    if (visiting.has(pageId)) return true;
    if (visited.has(pageId)) return false;
    visiting.add(pageId);
    for (const dependencyId of dependencies.get(pageId) ?? []) {
      if (dependencies.has(dependencyId) && visit(dependencyId)) return true;
    }
    visiting.delete(pageId);
    visited.add(pageId);
    return false;
  };

  return pages.some(({ pageId }) => visit(pageId));
}

function validateUniqueReferenceUsages(
  usages: ReferenceUsage[],
  context: z.RefinementCtx,
) {
  addDuplicateValueIssue(
    usages.map(({ referencePackId }) => referencePackId),
    "同一位置不能重复引用同一个 Reference Pack",
    [],
    context,
  );
}

function addDuplicateValueIssue(
  values: readonly (string | number)[],
  message: string,
  path: Array<string | number>,
  context: z.RefinementCtx,
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: "custom", message, path });
  }
}

function addDuplicateIdIssues(
  values: readonly (string | number)[],
  message: string,
  path: Array<string | number>,
  context: z.RefinementCtx,
) {
  addDuplicateValueIssue(values, message, path, context);
}

export type CoursePackFact = z.infer<typeof CoursePackFactSchema>;
export type CoursePackTerm = z.infer<typeof CoursePackTermSchema>;
export type CoursePackExample = z.infer<typeof CoursePackExampleSchema>;
export type CoursePack = z.infer<typeof CoursePackSchema>;
export type CourseObjective = z.infer<typeof CourseObjectiveSchema>;
export type CourseBlueprintAudience = z.infer<
  typeof CourseBlueprintAudienceSchema
>;
export type CourseRules = z.infer<typeof CourseRulesSchema>;
export type CourseBlueprint = z.infer<typeof CourseBlueprintSchema>;
export type PageTaskAcceptance = z.infer<typeof PageTaskAcceptanceSchema>;
export type PageTask = z.infer<typeof PageTaskSchema>;
export type CourseArchitecture = z.infer<typeof CourseArchitectureSchema>;
export type ArchitectureSubmission = z.infer<
  typeof ArchitectureSubmissionSchema
>;
