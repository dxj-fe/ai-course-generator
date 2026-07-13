import { z } from "zod";

export const VisualStyleSchema = z.enum([
  "sci-fi",
  "kids-playful",
  "minimal",
  "nature",
  "blackboard",
  "game-quest",
  "professional",
]);

export const CourseDifficultySchema = z.enum([
  "beginner",
  "intermediate",
  "advanced",
]);

export const CourseLanguageSchema = z.enum([
  "zh-CN",
  "en-US",
  "bilingual",
]);

export const AudienceAgeRangeSchema = z
  .object({
    min: z.number().int().min(3).max(99),
    max: z.number().int().min(3).max(99),
    label: z.string().min(2).max(40),
  })
  .refine((range) => range.max >= range.min, {
    message: "audienceAgeRange.max must be greater than or equal to min",
    path: ["max"],
  });

export const CourseIntentSchema = z.object({
  topic: z.string().min(2).max(120),
  audienceAgeRange: AudienceAgeRangeSchema,
  courseLength: z.number().int().min(3).max(12),
  visualStyle: VisualStyleSchema,
  difficulty: CourseDifficultySchema,
  mustInclude: z.array(z.string().min(1).max(80)).max(12),
  avoid: z.array(z.string().min(1).max(80)).max(12),
  language: CourseLanguageSchema,
});

export type VisualStyle = z.infer<typeof VisualStyleSchema>;
export type CourseDifficulty = z.infer<typeof CourseDifficultySchema>;
export type CourseLanguage = z.infer<typeof CourseLanguageSchema>;
export type AudienceAgeRange = z.infer<typeof AudienceAgeRangeSchema>;
export type CourseIntent = z.infer<typeof CourseIntentSchema>;

export function formatZodIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const field = issue.path.length ? issue.path.join(".") : "root";

      return `${field}: ${issue.message}`;
    })
    .join("; ");
}
