export const STORY_INTRO_VISUAL_CHOICE_LIMITS = {
  narration: 1,
  blocks: 2,
  supportingPoints: 2,
  options: 3,
} as const;

export const ACHIEVEMENT_VISUAL_INPUT_LIMITS = {
  narration: 1,
  blocks: 2,
  supportingPoints: 2,
  evaluationCriteria: 2,
} as const;

// 实际渲染插图的页面必须给正文、互动和触控区域留下稳定空间。
export const RENDERED_VISUAL_FIXED_CANVAS_LIMITS = {
  narration: 1,
  blocks: 3,
  supportingPoints: 3,
  interactionEntries: 3,
} as const;
