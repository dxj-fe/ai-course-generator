import { z } from "zod";

import {
  AudienceAgeRangeSchema,
  CourseDifficultySchema,
  CourseLanguageSchema,
} from "./intent";
import { AssetSchema } from "./asset";
import { PagePlanSchema } from "./page";
import { QualityReportSchema } from "./quality";
import { ThemeSchema } from "./theme";

/** 描述 Course 聚合在多 Agent 生成流程中的生命周期。 */
export const CourseStatusSchema = z.enum([
  "draft",
  "planning",
  "generating",
  "ready",
  "failed",
]);

/**
 * 保存所有页面都必须遵守的受众上下文。
 * 先验知识控制内容起点，无障碍要求约束后续素材和 HTML 生成。
 */
export const CourseAudienceSchema = z.object({
  description: z.string().min(2).max(300),
  ageRange: AudienceAgeRangeSchema.optional(),
  priorKnowledge: z.array(z.string().min(1).max(120)).max(12),
  accessibilityNeeds: z.array(z.string().min(1).max(120)).max(12),
});

/**
 * 课程的共享学习路径，包含全局目标和有序 PagePlan 序列。
 * 跨页面校验集中放在这里，避免每个 Agent 重复实现依赖规则。
 */
export const CourseOutlineSchema = z
  .object({
    overview: z.string().min(5).max(500),
    learningObjectives: z.array(z.string().min(5).max(300)).min(1).max(12),
    pages: z.array(PagePlanSchema).min(1).max(30),
  })
  .superRefine((outline, context) => {
    const pageIds = new Set<string>();

    // 第一遍建立 ID 索引，同时保证数组位置与显式 order 一致。
    outline.pages.forEach((page, index) => {
      if (pageIds.has(page.id)) {
        context.addIssue({
          code: "custom",
          message: `页面 ID ${page.id} 重复`,
          path: ["pages", index, "id"],
        });
      }
      pageIds.add(page.id);

      if (page.order !== index + 1) {
        context.addIssue({
          code: "custom",
          message: `页面顺序应为 ${index + 1}`,
          path: ["pages", index, "order"],
        });
      }
    });

    // 第二遍验证依赖；依赖必须存在且位于当前页面之前。
    outline.pages.forEach((page, index) => {
      for (const dependencyId of page.dependsOnPageIds) {
        const dependencyIndex = outline.pages.findIndex(
          (candidate) => candidate.id === dependencyId,
        );

        if (dependencyIndex === -1) {
          context.addIssue({
            code: "custom",
            message: `依赖页面 ${dependencyId} 不存在`,
            path: ["pages", index, "dependsOnPageIds"],
          });
        } else if (dependencyIndex >= index) {
          context.addIssue({
            code: "custom",
            message: `依赖页面 ${dependencyId} 必须位于当前页面之前`,
            path: ["pages", index, "dependsOnPageIds"],
          });
        }
      }
    });
  });

/**
 * 整门课程的聚合根，也是持久化、缓存和 Agent 交接的顶层协议。
 * superRefine 负责维护 Page、Asset 与 QualityReport 之间的引用完整性。
 */
export const CourseSchema = z
  .object({
    id: z.string().min(1).max(80),
    version: z.number().int().positive(),
    title: z.string().min(2).max(160),
    goal: z.string().min(5).max(500),
    audience: CourseAudienceSchema,
    difficulty: CourseDifficultySchema,
    language: CourseLanguageSchema,
    status: CourseStatusSchema,
    outline: CourseOutlineSchema,
    theme: ThemeSchema,
    assets: z.array(AssetSchema).max(100),
    qualityReports: z.array(QualityReportSchema).max(100),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((course, context) => {
    // 先建立引用索引，后续校验只比较稳定 ID，不复制嵌套实体。
    const pageIds = new Set(course.outline.pages.map((page) => page.id));
    const assetIds = new Set<string>();
    const qualityReportIds = new Set<string>();

    // 素材 ID 必须唯一，素材的反向页面引用必须落在当前课程内。
    course.assets.forEach((asset, index) => {
      if (assetIds.has(asset.id)) {
        context.addIssue({
          code: "custom",
          message: `素材 ID ${asset.id} 重复`,
          path: ["assets", index, "id"],
        });
      }
      assetIds.add(asset.id);

      for (const pageId of asset.usedByPageIds) {
        if (!pageIds.has(pageId)) {
          context.addIssue({
            code: "custom",
            message: `素材引用了不存在的页面 ${pageId}`,
            path: ["assets", index, "usedByPageIds"],
          });
        }
      }
    });

    // 每个 PagePlan 引用的素材都必须真实存在于 Course.assets。
    course.outline.pages.forEach((page, pageIndex) => {
      for (const assetId of page.assetIds) {
        if (!assetIds.has(assetId)) {
          context.addIssue({
            code: "custom",
            message: `页面引用了不存在的素材 ${assetId}`,
            path: ["outline", "pages", pageIndex, "assetIds"],
          });
        }
      }
    });

    // 质量报告及其中的问题只能引用当前 Course 聚合中的目标。
    course.qualityReports.forEach((report, reportIndex) => {
      if (qualityReportIds.has(report.id)) {
        context.addIssue({
          code: "custom",
          message: `质量报告 ID ${report.id} 重复`,
          path: ["qualityReports", reportIndex, "id"],
        });
      }
      qualityReportIds.add(report.id);

      if (report.target.type === "course" && report.target.courseId !== course.id) {
        context.addIssue({
          code: "custom",
          message: `质量报告引用了其他课程 ${report.target.courseId}`,
          path: ["qualityReports", reportIndex, "target", "courseId"],
        });
      }

      if (report.target.type === "page" && !pageIds.has(report.target.pageId)) {
        context.addIssue({
          code: "custom",
          message: `质量报告引用了不存在的页面 ${report.target.pageId}`,
          path: ["qualityReports", reportIndex, "target", "pageId"],
        });
      }

      report.issues.forEach((issue, issueIndex) => {
        if (issue.pageId && !pageIds.has(issue.pageId)) {
          context.addIssue({
            code: "custom",
            message: `质量问题引用了不存在的页面 ${issue.pageId}`,
            path: ["qualityReports", reportIndex, "issues", issueIndex, "pageId"],
          });
        }
      });
    });
  });

export type CourseStatus = z.infer<typeof CourseStatusSchema>;
export type CourseAudience = z.infer<typeof CourseAudienceSchema>;
export type CourseOutline = z.infer<typeof CourseOutlineSchema>;
export type Course = z.infer<typeof CourseSchema>;
