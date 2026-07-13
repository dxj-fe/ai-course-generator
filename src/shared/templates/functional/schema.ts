import { z } from "zod";

import { PageTypeSchema } from "@/shared/course-schema";

/** 功能模板允许声明的教学结构槽位，不包含任何视觉属性。 */
export const FunctionalTemplateSlotNameSchema = z.enum([
  "title",
  "narration",
  "blocks",
  "interaction",
  "assetSlots",
]);

/**
 * 描述一个内容槽位的教学职责和数量边界。
 * required 表示生成结果必须填充该槽位，数量范围供后续内容 Agent 校验。
 */
export const FunctionalTemplateSlotSchema = z
  .object({
    name: FunctionalTemplateSlotNameSchema,
    goal: z.string().min(2).max(240),
    required: z.boolean(),
    minItems: z.number().int().min(0).max(20),
    maxItems: z.number().int().min(1).max(20),
  })
  .superRefine((slot, context) => {
    if (slot.maxItems < slot.minItems) {
      context.addIssue({
        code: "custom",
        message: "maxItems 不能小于 minItems",
        path: ["maxItems"],
      });
    }

    if (slot.required && slot.minItems === 0) {
      context.addIssue({
        code: "custom",
        message: "必填槽位的 minItems 至少为 1",
        path: ["minItems"],
      });
    }
  });

/**
 * 功能模板是 Planner、搜索 Skill 与内容 Agent 共享的教学结构协议。
 * 它定义页面承担的任务，不定义颜色、字体、组件树或 HTML。
 */
export const FunctionalTemplateSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
    name: z.string().min(2).max(80),
    pageType: PageTypeSchema,
    goal: z.string().min(5).max(300),
    slots: z.array(FunctionalTemplateSlotSchema).min(2).max(5),
    constraints: z.array(z.string().min(2).max(240)).min(1).max(12),
    bestFor: z.array(z.string().min(2).max(160)).min(1).max(12),
    avoidFor: z.array(z.string().min(2).max(160)).min(1).max(12),
    keywords: z.array(z.string().min(1).max(40)).min(2).max(20),
  })
  .superRefine((template, context) => {
    const slotNames = template.slots.map((slot) => slot.name);

    if (new Set(slotNames).size !== slotNames.length) {
      context.addIssue({
        code: "custom",
        message: "同一功能模板不能重复声明槽位",
        path: ["slots"],
      });
    }

    if (!slotNames.includes("title")) {
      context.addIssue({
        code: "custom",
        message: "每个功能模板都必须声明 title 槽位",
        path: ["slots"],
      });
    }
  });

export type FunctionalTemplateSlotName = z.infer<
  typeof FunctionalTemplateSlotNameSchema
>;
export type FunctionalTemplateSlot = z.infer<
  typeof FunctionalTemplateSlotSchema
>;
export type FunctionalTemplate = z.infer<typeof FunctionalTemplateSchema>;
