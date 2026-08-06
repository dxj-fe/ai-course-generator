import { z } from "zod";

import { AiSchemaValidationError } from "@/server/infra/ai/error";
import type {
  PageContentDSL,
  PageContentInteraction,
} from "@/shared/course-schema";
import type { FunctionalTemplate } from "@/shared/templates/functional";

import { PageWriterInteractionDraftSchema } from "./page-writer-schema";

/** 为模型返回的选择题语义草稿补齐稳定 question/option ID。 */
export function materializeChoiceQuestions(
  draft: Extract<
    z.infer<typeof PageWriterInteractionDraftSchema>,
    { type: "choice" }
  >,
) {
  if (draft.correctOptionIndex >= draft.options.length) {
    throw new AiSchemaValidationError(
      "choice question 1 的正确选项位置越界。",
    );
  }

  const options = draft.options.map((label, optionIndex) => ({
    id: `option-01-${String(optionIndex + 1).padStart(2, "0")}`,
    label,
  }));

  return [
    {
      id: "question-01",
      prompt: draft.prompt,
      options,
      correctOptionId: options[draft.correctOptionIndex]?.id ?? "",
      feedback: {
        success: draft.feedbackSuccess,
        retry: draft.feedbackRetry,
      },
      maxAttempts: draft.maxAttempts,
    },
  ];
}

/** 按 FunctionalTemplate 的声明校验每个语义槽位是否越界。 */
export function validateTemplateSlots(
  dsl: PageContentDSL,
  template: FunctionalTemplate,
) {
  const counts = {
    title: dsl.title ? 1 : 0,
    narration: dsl.narration.length,
    blocks: dsl.blocks.length,
    interaction: getInteractionItemCount(dsl.interaction),
    assetSlots: dsl.assetSlots.length,
  };
  const issues: string[] = [];

  for (const [name, count] of Object.entries(counts)) {
    const slot = template.slots.find(
      (candidate) => candidate.name === name,
    );

    if (!slot && count > 0) {
      issues.push(`${name} 未在模板中声明，数量必须为 0`);
    } else if (
      slot &&
      (count < slot.minItems || count > slot.maxItems)
    ) {
      issues.push(
        `${name} 数量 ${count} 不在模板范围 ${slot.minItems}-${slot.maxItems}`,
      );
    }
  }

  return issues;
}

/** 将不同互动协议投影为 FunctionalTemplate 使用的槽位数量。 */
function getInteractionItemCount(
  interaction: PageContentInteraction,
) {
  switch (interaction.type) {
    case "none":
      return 0;
    case "choice":
      return interaction.questions.length;
    case "reveal":
    case "explore":
      return interaction.items.length;
    default:
      return 1;
  }
}
