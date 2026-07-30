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
  draft: z.infer<typeof PageWriterInteractionDraftSchema>,
) {
  if (draft.questions.length === 0) {
    throw new AiSchemaValidationError(
      "choice 至少需要一道 questions 题目。",
    );
  }

  return draft.questions.map((question, questionIndex) => {
    if (question.correctOptionIndex >= question.options.length) {
      throw new AiSchemaValidationError(
        `choice question ${questionIndex + 1} 的正确选项位置越界。`,
      );
    }

    const questionNumber = String(questionIndex + 1).padStart(
      2,
      "0",
    );
    const options = question.options.map((label, optionIndex) => ({
      id: `option-${questionNumber}-${String(optionIndex + 1).padStart(2, "0")}`,
      label,
    }));

    return {
      id: `question-${questionNumber}`,
      prompt: question.prompt,
      options,
      correctOptionId: options[question.correctOptionIndex]?.id ?? "",
      feedback: {
        success: question.feedbackSuccess,
        retry: question.feedbackRetry,
      },
      maxAttempts: question.maxAttempts,
    };
  });
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

/** 将兼容输出中的占位文本替换为稳定默认语义。 */
export function usable(value: string, fallback: string) {
  const normalized = value.trim();

  return !normalized || normalized === "未使用"
    ? fallback
    : normalized;
}
