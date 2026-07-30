import {
  PromptIds,
  type PromptId,
} from "@/server/agent/ids";

import type { ModelStepPromptId } from "./model-step-catalog";

export const MODEL_STEP_PROMPT_IDS = Object.freeze({
  pedagogy: {
    system: PromptIds.CoursePedagogySystemV2,
    user: PromptIds.CoursePedagogyUserV2,
  },
  story: {
    system: PromptIds.CourseStorySystemV2,
    user: PromptIds.CourseStoryUserV2,
  },
  visual: {
    system: PromptIds.CourseVisualSystemV2,
    user: PromptIds.CourseVisualUserV2,
  },
  "page-writer": {
    system: PromptIds.CoursePageWriterSystemV3,
    user: PromptIds.CoursePageWriterUserV3,
  },
  "image-prompt": {
    system: PromptIds.CourseImagePromptSystemV2,
    user: PromptIds.CourseImagePromptUserV2,
  },
  "html-engineer": {
    system: PromptIds.CourseHtmlEngineerSystemV2,
    user: PromptIds.CourseHtmlEngineerUserV2,
  },
  qa: {
    system: PromptIds.CoursePageQaSystemV2,
    user: PromptIds.CoursePageQaUserV2,
  },
  repair: {
    system: PromptIds.CourseRepairSystemV1,
    user: PromptIds.CourseRepairUserV1,
  },
} satisfies Record<
  ModelStepPromptId,
  Readonly<{ system: PromptId; user: PromptId }>
>);
