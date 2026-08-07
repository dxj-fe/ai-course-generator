import { z } from "zod";

import { CourseOutlineSchema } from "./course";

/**
 * 迁移期产品读模型。课程节奏、首尾职责与互动密度由 Course Lead 和
 * Reviewer 根据具体目标判断，不在共享 Schema 中写死。
 */
export const CoursePlanSchema = CourseOutlineSchema;

export type CoursePlan = z.infer<typeof CoursePlanSchema>;
