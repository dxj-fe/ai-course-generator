import { z } from "zod";

import { PedagogyPageGuidanceSchema, PedagogyPlanSchema } from "./pedagogy";
import { StoryArcSchema, StoryPageBeatSchema } from "./story";
import { VisualBriefSchema, VisualPageGuidanceSchema } from "./visual";

/** 汇总三个专业 Agent 的输出，作为 Page Worker 的上游设计协议。 */
export const CourseDesignBriefsSchema = z.object({
  pedagogy: PedagogyPlanSchema,
  story: StoryArcSchema,
  visual: VisualBriefSchema,
});

/** 单个 Page Worker 实际消费的最小专业上下文。 */
export const PageWorkerBriefSchema = z.object({
  pageId: z.string().min(1).max(80),
  styleTemplateId: z.string().min(1).max(80),
  pedagogy: PedagogyPageGuidanceSchema,
  story: StoryPageBeatSchema,
  visual: VisualPageGuidanceSchema,
});

export type CourseDesignBriefs = z.infer<typeof CourseDesignBriefsSchema>;
export type PageWorkerBrief = z.infer<typeof PageWorkerBriefSchema>;
