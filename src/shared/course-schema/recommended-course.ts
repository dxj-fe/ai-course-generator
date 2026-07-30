import { z } from "zod";

export const RecommendedCourseDomainSchema = z.enum([
  "mathematics",
  "chinese",
  "english",
  "science",
  "history",
  "geography",
  "technology",
  "art",
  "finance",
  "health",
  "critical-thinking",
  "learning",
]);

export const RecommendedCourseIdSchema = z
  .string()
  .regex(/^recommended-[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(80);

export const RecommendedCourseSummarySchema = z
  .object({
    id: RecommendedCourseIdSchema,
    domain: RecommendedCourseDomainSchema,
    domainLabel: z.string().min(1).max(24),
    title: z.string().min(2).max(80),
    description: z.string().min(8).max(160),
    learningOutcome: z.string().min(8).max(180),
    audience: z.string().min(2).max(60),
    pageCount: z.number().int().min(3).max(12),
    durationMinutes: z.number().int().min(8).max(90),
    prompt: z.string().min(20).max(2_000),
    previewUrl: z.string().startsWith("/api/recommendations/courses/"),
    styleLabel: z.string().min(2).max(40),
  })
  .strict();

export const RecommendedCourseListResponseSchema = z
  .object({
    items: z.array(RecommendedCourseSummarySchema).length(3),
    nextCursor: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    supportedDomains: z.array(RecommendedCourseDomainSchema).min(1),
  })
  .strict();

export type RecommendedCourseDomain = z.infer<
  typeof RecommendedCourseDomainSchema
>;
export type RecommendedCourseSummary = z.infer<
  typeof RecommendedCourseSummarySchema
>;
export type RecommendedCourseListResponse = z.infer<
  typeof RecommendedCourseListResponseSchema
>;
