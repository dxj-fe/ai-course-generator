import {
  PromptIds,
  type PromptId,
} from "@/server/agent/ids";

import type { ModelStepPromptId } from "./model-step-catalog";

export const MODEL_STEP_PROMPT_IDS = Object.freeze({
  pedagogy: {
    system: PromptIds.CoursePedagogySystem,
    user: PromptIds.CoursePedagogyUser,
  },
  story: {
    system: PromptIds.CourseStorySystem,
    user: PromptIds.CourseStoryUser,
  },
  visual: {
    system: PromptIds.CourseVisualSystem,
    user: PromptIds.CourseVisualUser,
  },
  "page-writer": {
    system: PromptIds.CoursePageWriterSystem,
    user: PromptIds.CoursePageWriterUser,
  },
  "image-prompt": {
    system: PromptIds.CourseImagePromptSystem,
    user: PromptIds.CourseImagePromptUser,
  },
  "html-engineer": {
    system: PromptIds.CourseHtmlEngineerSystem,
    user: PromptIds.CourseHtmlEngineerUser,
  },
  qa: {
    system: PromptIds.CoursePageQaSystem,
    user: PromptIds.CoursePageQaUser,
  },
  repair: {
    system: PromptIds.CourseRepairSystem,
    user: PromptIds.CourseRepairUser,
  },
} satisfies Record<
  ModelStepPromptId,
  Readonly<{ system: PromptId; user: PromptId }>
>);
