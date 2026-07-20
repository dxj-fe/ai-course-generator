import { z } from "zod";

import { AssetGenerationResultSchema } from "./asset";
import { CourseDesignBriefsSchema, PageWorkerBriefSchema } from "./course-design";
import { CoursePlanSchema } from "./course-plan";
import { CourseIntentSchema } from "./intent";
import { HtmlOutputSchema } from "./page";
import { PageContentDSLSchema } from "./page-content-dsl";
import { QualityReportSchema } from "./quality";
import { RepairAttemptRecordSchema } from "./repair";
import { SupervisorRuntimeStateSchema } from "./supervisor";

/** 可安全用作课程存储目录名的稳定 ID。 */
export const CourseIdSchema = z
  .string()
  .min(8)
  .max(80)
  .regex(/^course-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);

/** Day 18 串行课程生成器对外公开的阶段。 */
export const CourseGenerationStageSchema = z.enum([
  "intent",
  "planner",
  "design",
  "page_writer",
  "assets",
  "html",
  "qa",
  "repair",
  "complete",
]);

export const CourseGenerationStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const PageGenerationStageSchema = z.enum([
  "page_writer",
  "assets",
  "html",
  "qa",
  "repair",
  "complete",
]);

export const PageWorkerModeSchema = z.enum(["serial", "parallel"]);

export const PageWorkerConfigSchema = z
  .object({
    mode: PageWorkerModeSchema,
    concurrency: z.number().int().min(1).max(5),
  })
  .strict();

export const PageGenerationStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

export const CourseGenerationEventTypeSchema = z.enum([
  "start",
  "agent_start",
  "agent_done",
  "model_call",
  "tool_call",
  "validation",
  "supervisor_decision",
  "repair_attempt",
  "repair_success",
  "page_done",
  "finish",
  "error",
]);

/**
 * 仅保存可以出现在 Agent Timeline 的结构化公开事件。
 * 故意不接收原生 event data，避免 checkpoint 或 UI 泄露私有上下文。
 */
export const CourseGenerationPublicEventSchema = z
  .object({
    id: z.string().min(1).max(120),
    sequence: z.number().int().positive(),
    type: CourseGenerationEventTypeSchema,
    traceId: z.string().min(1).max(120),
    timestamp: z.string().datetime({ offset: true }),
    step: z.number().int().nonnegative(),
    summary: z.string().min(1).max(500),
    stage: CourseGenerationStageSchema,
    pageId: z.string().min(1).max(80).optional(),
    agent: z.string().min(1).max(80).optional(),
  })
  .strict();

/** 统一表示课程级和页面级失败，供恢复逻辑及 UI 使用。 */
export const CourseGenerationErrorSchema = z
  .object({
    stage: CourseGenerationStageSchema,
    pageId: z.string().min(1).max(80).optional(),
    code: z.string().min(1).max(100),
    message: z.string().min(1).max(1_000),
  })
  .strict();

/** 页面内只保存局部错误摘要；阶段和 pageId 由当前页面及顶层 errors 提供。 */
export const PageGenerationErrorSchema = CourseGenerationErrorSchema.omit({
  stage: true,
  pageId: true,
});

export const PageGenerationAttemptSchema = z
  .object({
    stage: PageGenerationStageSchema.exclude(["complete", "repair"]),
    attempts: z.number().int().min(1).max(3),
  })
  .strict();

/** Worker 先产生页面局部事件，课程运行层再为其分配全局 id 与 sequence。 */
export const PageWorkerEventSchema = z
  .object({
    type: CourseGenerationEventTypeSchema.exclude(["supervisor_decision"]),
    stage: PageGenerationStageSchema.exclude(["complete"]),
    pageId: z.string().min(1).max(80),
    agent: z.string().min(1).max(80).optional(),
    step: z.number().int().nonnegative().optional(),
    timestamp: z.string().datetime({ offset: true }),
    summary: z.string().min(1).max(500),
  })
  .strict();

/** 单页在 Page Writer → Assets → HTML 串行链路中的可恢复状态。 */
export const PageGenerationStateSchema = z
  .object({
    pageId: z.string().min(1).max(80),
    order: z.number().int().positive(),
    status: PageGenerationStatusSchema,
    currentStage: PageGenerationStageSchema,
    content: PageContentDSLSchema.optional(),
    assets: z.array(AssetGenerationResultSchema).max(12),
    htmlOutput: HtmlOutputSchema.optional(),
    qualityReport: QualityReportSchema.optional(),
    repairHistory: z.array(RepairAttemptRecordSchema).max(2).optional(),
    attempts: z.array(PageGenerationAttemptSchema).max(4).optional(),
    error: PageGenerationErrorSchema.optional(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.content && page.content.pageId !== page.pageId) {
      context.addIssue({
        code: "custom",
        message: "PageContentDSL.pageId 必须与页面状态一致",
        path: ["content", "pageId"],
      });
    }

    if (
      page.qualityReport?.target.type === "page" &&
      page.qualityReport.target.pageId !== page.pageId
    ) {
      context.addIssue({
        code: "custom",
        message: "QualityReport.pageId 必须与页面状态一致",
        path: ["qualityReport", "target", "pageId"],
      });
    }

    (page.repairHistory ?? []).forEach((attempt, index) => {
      if (attempt.round !== index + 1) {
        context.addIssue({
          code: "custom",
          message: `Repair round 应连续为 ${index + 1}`,
          path: ["repairHistory", index, "round"],
        });
      }
      if (
        attempt.sourceReport.target.type !== "page" ||
        attempt.sourceReport.target.pageId !== page.pageId
      ) {
        context.addIssue({
          code: "custom",
          message: "Repair attempt 的来源报告必须引用当前页面",
          path: ["repairHistory", index, "sourceReport", "target"],
        });
      }
    });

    if (page.status === "failed" && !page.error) {
      context.addIssue({
        code: "custom",
        message: "failed 页面必须包含 error",
        path: ["error"],
      });
    }

    if (page.status === "completed") {
      if (page.currentStage !== "complete") {
        context.addIssue({
          code: "custom",
          message: "completed 页面的 currentStage 必须为 complete",
          path: ["currentStage"],
        });
      }

      if (!page.content) {
        context.addIssue({
          code: "custom",
          message: "completed 页面必须包含 PageContentDSL",
          path: ["content"],
        });
      }

      if (!page.htmlOutput) {
        context.addIssue({
          code: "custom",
          message: "completed 页面必须包含 htmlOutput",
          path: ["htmlOutput"],
        });
      }

      if (page.content) {
        const expectedSlotIds = page.content.assetSlots.map(({ id }) => id);
        const resultSlotIds = page.assets.map(
          ({ request }) => request.assetSlotId,
        );

        if (
          expectedSlotIds.length !== resultSlotIds.length ||
          new Set(resultSlotIds).size !== resultSlotIds.length ||
          expectedSlotIds.some((id) => !resultSlotIds.includes(id))
        ) {
          context.addIssue({
            code: "custom",
            message: "completed 页面的素材结果必须无重复地覆盖全部 asset slot",
            path: ["assets"],
          });
        }
      }
    }
  });

/** Page Worker 的完整局部输出；不包含或引用整课状态。 */
export const PageWorkerResultSchema = z
  .object({
    pageId: z.string().min(1).max(80),
    state: PageGenerationStateSchema,
    events: z.array(PageWorkerEventSchema).max(300),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.pageId !== result.state.pageId) {
      context.addIssue({
        code: "custom",
        message: "PageWorkerResult.pageId 必须与局部状态一致",
        path: ["state", "pageId"],
      });
    }
    result.events.forEach((event, index) => {
      if (event.pageId !== result.pageId) {
        context.addIssue({
          code: "custom",
          message: "Page Worker 事件只能引用当前页面",
          path: ["events", index, "pageId"],
        });
      }
    });
  });

/**
 * 单提示生成 3–5 页课程的持久化 checkpoint。
 * 允许保存运行中的部分结果；completed 状态则必须具备完整可预览产物。
 */
export const CourseGenerationStateSchema = z
  .object({
    version: z.literal(1),
    courseId: CourseIdSchema,
    traceId: z.string().min(1).max(120),
    userPrompt: z.string().min(2).max(4_000),
    status: CourseGenerationStatusSchema,
    currentStage: CourseGenerationStageSchema,
    currentPageId: z.string().min(1).max(80).optional(),
    intent: CourseIntentSchema.optional(),
    outline: CoursePlanSchema.optional(),
    briefs: CourseDesignBriefsSchema.optional(),
    pageWorkerBriefs: z.array(PageWorkerBriefSchema).max(5).optional(),
    workerConfig: PageWorkerConfigSchema.optional(),
    pages: z.array(PageGenerationStateSchema).max(5),
    events: z.array(CourseGenerationPublicEventSchema).max(1_000),
    errors: z.array(CourseGenerationErrorSchema).max(30),
    supervisor: SupervisorRuntimeStateSchema.optional(),
    startedAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }).optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const pageIds = state.pages.map(({ pageId }) => pageId);

    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({
        code: "custom",
        message: "页面生成状态不能包含重复 pageId",
        path: ["pages"],
      });
    }

    state.pages.forEach((page, index) => {
      if (page.order !== index + 1) {
        context.addIssue({
          code: "custom",
          message: `页面生成顺序应为 ${index + 1}`,
          path: ["pages", index, "order"],
        });
      }
    });

    state.events.forEach((event, index) => {
      if (event.sequence !== index + 1) {
        context.addIssue({
          code: "custom",
          message: `公开事件序号应为 ${index + 1}`,
          path: ["events", index, "sequence"],
        });
      }

      if (event.pageId && !pageIds.includes(event.pageId)) {
        context.addIssue({
          code: "custom",
          message: `公开事件引用了不存在的页面 ${event.pageId}`,
          path: ["events", index, "pageId"],
        });
      }
    });

    if (state.currentPageId && !pageIds.includes(state.currentPageId)) {
      context.addIssue({
        code: "custom",
        message: "currentPageId 必须引用真实页面状态",
        path: ["currentPageId"],
      });
    }

    state.errors.forEach((error, index) => {
      if (error.pageId && !pageIds.includes(error.pageId)) {
        context.addIssue({
          code: "custom",
          message: `错误引用了不存在的页面 ${error.pageId}`,
          path: ["errors", index, "pageId"],
        });
      }
    });

    if (state.outline) {
      const outlinePageIds = state.outline.pages.map(({ id }) => id);

      if (
        state.intent &&
        state.outline.pages.length !== state.intent.courseLength
      ) {
        context.addIssue({
          code: "custom",
          message: "CoursePlan 页数必须与 CourseIntent.courseLength 一致",
          path: ["outline", "pages"],
        });
      }

      if (outlinePageIds.length > 5) {
        context.addIssue({
          code: "custom",
          message: "Day 18 MVP 最多生成 5 个页面",
          path: ["outline", "pages"],
        });
      }

      if (
        state.pages.length > 0 &&
        JSON.stringify(pageIds) !== JSON.stringify(outlinePageIds)
      ) {
        context.addIssue({
          code: "custom",
          message: "页面生成状态必须按 CoursePlan 顺序覆盖全部页面",
          path: ["pages"],
        });
      }

      state.pages.forEach((page, index) => {
        const plan = state.outline?.pages[index];

        if (
          plan &&
          page.content &&
          (page.content.functionalTemplateId !== plan.functionalTemplateId ||
            page.content.interaction.type !== plan.interactionType)
        ) {
          context.addIssue({
            code: "custom",
            message: "页面 DSL 必须遵守 CoursePlan 的模板与交互类型",
            path: ["pages", index, "content"],
          });
        }
      });
    }

    if (state.pageWorkerBriefs && state.outline) {
      const briefPageIds = state.pageWorkerBriefs.map(({ pageId }) => pageId);
      const outlinePageIds = state.outline.pages.map(({ id }) => id);

      if (JSON.stringify(briefPageIds) !== JSON.stringify(outlinePageIds)) {
        context.addIssue({
          code: "custom",
          message: "PageWorkerBrief 必须按 CoursePlan 顺序覆盖全部页面",
          path: ["pageWorkerBriefs"],
        });
      }
    }

    if (state.status === "completed") {
      if (state.currentStage !== "complete") {
        context.addIssue({
          code: "custom",
          message: "completed 课程的 currentStage 必须为 complete",
          path: ["currentStage"],
        });
      }

      for (const [field, value] of [
        ["intent", state.intent],
        ["outline", state.outline],
        ["briefs", state.briefs],
        ["pageWorkerBriefs", state.pageWorkerBriefs],
        ["completedAt", state.completedAt],
        ["durationMs", state.durationMs],
      ] as const) {
        if (value === undefined) {
          context.addIssue({
            code: "custom",
            message: `completed 课程必须包含 ${field}`,
            path: [field],
          });
        }
      }

      if (
        !state.outline ||
        state.pages.length !== state.outline.pages.length ||
        state.pages.some(({ status }) => status !== "completed")
      ) {
        context.addIssue({
          code: "custom",
          message: "completed 课程的全部规划页面都必须已完成",
          path: ["pages"],
        });
      }
    }

    if (state.status !== "completed" && state.currentStage === "complete") {
      context.addIssue({
        code: "custom",
        message: "只有 completed 课程可以进入 complete 阶段",
        path: ["currentStage"],
      });
    }
  });

export type CourseId = z.infer<typeof CourseIdSchema>;
export type CourseGenerationStage = z.infer<
  typeof CourseGenerationStageSchema
>;
export type CourseGenerationStatus = z.infer<
  typeof CourseGenerationStatusSchema
>;
export type PageGenerationStage = z.infer<typeof PageGenerationStageSchema>;
export type PageGenerationStatus = z.infer<typeof PageGenerationStatusSchema>;
export type CourseGenerationEventType = z.infer<
  typeof CourseGenerationEventTypeSchema
>;
export type CourseGenerationPublicEvent = z.infer<
  typeof CourseGenerationPublicEventSchema
>;
export type CourseGenerationError = z.infer<
  typeof CourseGenerationErrorSchema
>;
export type PageGenerationError = z.infer<typeof PageGenerationErrorSchema>;
export type PageGenerationAttempt = z.infer<
  typeof PageGenerationAttemptSchema
>;
export type PageGenerationState = z.infer<typeof PageGenerationStateSchema>;
export type PageWorkerMode = z.infer<typeof PageWorkerModeSchema>;
export type PageWorkerConfig = z.infer<typeof PageWorkerConfigSchema>;
export type PageWorkerEvent = z.infer<typeof PageWorkerEventSchema>;
export type PageWorkerResult = z.infer<typeof PageWorkerResultSchema>;
export type CourseGenerationState = z.infer<
  typeof CourseGenerationStateSchema
>;
