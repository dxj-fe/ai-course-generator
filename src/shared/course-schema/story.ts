import { z } from "zod";

/** 允许严肃课程降低叙事强度，避免所有主题都被强行游戏化。 */
export const NarrativeModeSchema = z.enum(["none", "light", "full"]);

/** 描述故事中的稳定角色及其教学作用。 */
export const StoryCharacterSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().min(2).max(200),
});

/** 把一条叙事节拍和转场绑定到真实 PagePlan。 */
export const StoryPageBeatSchema = z.object({
  pageId: z.string().min(1).max(80),
  beat: z.string().min(2).max(300),
  transition: z.string().min(2).max(240),
});

/**
 * StoryAgent 的跨页叙事协议。
 * 它负责连贯性和学习动机，不修改学习目标或视觉模板。
 */
export const StoryArcSchema = z
  .object({
    narrativeMode: NarrativeModeSchema,
    premise: z.string().min(5).max(400),
    learnerRole: z.string().min(2).max(200),
    mission: z.string().min(5).max(300),
    characters: z.array(StoryCharacterSchema).max(6),
    pageBeats: z.array(StoryPageBeatSchema).min(1),
    tone: z.string().min(2).max(160),
    continuityRules: z.array(z.string().min(2).max(240)).min(1).max(10),
  })
  .superRefine((arc, context) => {
    const pageIds = arc.pageBeats.map(({ pageId }) => pageId);

    if (new Set(pageIds).size !== pageIds.length) {
      context.addIssue({
        code: "custom",
        message: "pageBeats 不能重复引用同一页面",
        path: ["pageBeats"],
      });
    }

    if (arc.narrativeMode === "none" && arc.characters.length > 0) {
      context.addIssue({
        code: "custom",
        message: "none 叙事模式不应创建虚构角色",
        path: ["characters"],
      });
    }
  });

export type NarrativeMode = z.infer<typeof NarrativeModeSchema>;
export type StoryCharacter = z.infer<typeof StoryCharacterSchema>;
export type StoryPageBeat = z.infer<typeof StoryPageBeatSchema>;
export type StoryArc = z.infer<typeof StoryArcSchema>;
