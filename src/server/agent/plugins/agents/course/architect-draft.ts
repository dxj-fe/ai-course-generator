import { z } from "zod";

import {
  CourseArchitectureSchema,
  CourseDifficultySchema,
  ReferenceUsageSchema,
  VisualStyleSchema,
  type CourseArchitecture,
  type CourseCreationBrief,
} from "@/shared/course-schema";

const DraftFactSchema = z
  .object({
    text: z.string().trim().min(2).max(1_000),
    sourceUsages: z.array(ReferenceUsageSchema).max(12).default([]),
  })
  .strict();

const DraftTermSchema = z
  .object({
    term: z.string().trim().min(1).max(120),
    definition: z.string().trim().min(2).max(600),
    sourceUsages: z.array(ReferenceUsageSchema).max(12).default([]),
  })
  .strict();

const DraftExampleSchema = z
  .object({
    summary: z.string().trim().min(2).max(1_000),
    sourceUsages: z.array(ReferenceUsageSchema).max(12).default([]),
  })
  .strict();

const DraftObjectiveSchema = z
  .object({
    outcome: z.string().trim().min(2).max(500),
    evidence: z.string().trim().min(2).max(500),
  })
  .strict();

const DraftPageSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    purpose: z.string().trim().min(2).max(500),
    objectiveNumbers: z.array(z.number().int().positive()).min(1).max(20),
    buildDependsOnPageNumbers: z
      .array(z.number().int().positive())
      .max(20)
      .default([]),
    teachingPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(30),
    learnerAction: z.string().trim().min(2).max(500),
    assessment: z.string().trim().min(2).max(500),
    referenceUsages: z.array(ReferenceUsageSchema).max(12).default([]),
    requiresInteraction: z.boolean(),
    visualDesign: z
      .object({
        theme: z.string().trim().min(2).max(240),
        layout: z.string().trim().min(2).max(300),
        graphicMotif: z.string().trim().min(2).max(300),
      })
      .strict(),
  })
  .strict();

/**
 * Course Lead 面向模型的轻量协议。稳定 ID、用户已确认字段和兼容默认值由
 * Harness 投影，避免让模型重复输出大段机械 JSON。
 */
export const CoursePlanDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    difficulty: CourseDifficultySchema,
    objectives: z.array(DraftObjectiveSchema).min(1).max(40),
    facts: z.array(DraftFactSchema).max(80).default([]),
    terms: z.array(DraftTermSchema).max(80).default([]),
    examples: z.array(DraftExampleSchema).max(40).default([]),
    constraints: z.array(z.string().trim().min(1).max(500)).max(40).default([]),
    tone: z.string().trim().min(1).max(240),
    visualDirection: z.string().trim().min(2).max(500),
    visualStyle: VisualStyleSchema,
    pages: z.array(DraftPageSchema).min(1).max(200),
  })
  .strict();

export type CoursePlanDraft = z.infer<typeof CoursePlanDraftSchema>;

export function projectCoursePlanDraft(input: {
  courseId: string;
  creationBrief: CourseCreationBrief;
  draft: unknown;
}): CourseArchitecture {
  const draft = CoursePlanDraftSchema.parse(input.draft);
  const objectiveId = (number: number) =>
    `objective-${String(number).padStart(2, "0")}`;
  const pageId = (number: number) =>
    `page-${String(number).padStart(2, "0")}`;

  return CourseArchitectureSchema.parse({
    courseId: input.courseId,
    coursePack: {
      courseId: input.courseId,
      topic: input.creationBrief.topic,
      facts: draft.facts.map((fact, index) => ({
        id: `fact-${String(index + 1).padStart(2, "0")}`,
        ...fact,
      })),
      terms: draft.terms,
      examples: draft.examples.map((example, index) => ({
        id: `example-${String(index + 1).padStart(2, "0")}`,
        ...example,
      })),
      constraints: draft.constraints,
    },
    blueprint: {
      courseId: input.courseId,
      title: draft.title,
      audience: {
        description: input.creationBrief.audience,
        priorKnowledge: [],
        difficulty: draft.difficulty,
      },
      language: input.creationBrief.language,
      objectives: draft.objectives.map((objective, index) => ({
        id: objectiveId(index + 1),
        ...objective,
      })),
      courseRules: {
        tone: draft.tone,
        terminology: draft.terms.map(({ term }) => term),
        visualDirection: draft.visualDirection,
        visualStyle: draft.visualStyle,
        teachingPattern: draft.pages.map(({ purpose }) => purpose),
      },
    },
    pageTasks: draft.pages.map((page, index) => ({
      pageId: pageId(index + 1),
      order: index + 1,
      title: page.title,
      purpose: page.purpose,
      objectiveIds: page.objectiveNumbers.map(objectiveId),
      buildDependsOnPageIds: page.buildDependsOnPageNumbers.map(pageId),
      teachingPoints: page.teachingPoints,
      learnerAction: page.learnerAction,
      assessment: page.assessment,
      referenceUsages: page.referenceUsages,
      visualDesign: page.visualDesign,
      acceptance: {
        requiredConcepts: page.teachingPoints,
        expectedLearnerOutcome: page.assessment,
        requiresInteraction: page.requiresInteraction,
        pageSpecific: [],
      },
    })),
  });
}
