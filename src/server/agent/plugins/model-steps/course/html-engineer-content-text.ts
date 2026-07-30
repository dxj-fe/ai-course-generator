import type { PageContentDSL } from "@/shared/course-schema";

import { normalizeText } from "./html-engineer-text";

/** 静态预览必须常显的正文；答错后的 retry 反馈仍由 DSL 保存，不要求永久铺开。 */
export function collectRequiredStaticContentText(content: PageContentDSL) {
  const blockText = content.blocks.flatMap((block) => [
    block.heading,
    block.body,
    ...block.supportingPoints,
  ]);
  const interactionText = collectInteractionStaticContentText(content);

  return [
    ...new Set([
      content.title,
      ...content.narration,
      ...blockText,
      ...interactionText,
    ]),
  ];
}

function collectInteractionStaticContentText(content: PageContentDSL) {
  const interaction = content.interaction;
  let interactionText: string[] = [];

  switch (interaction.type) {
    case "none":
      break;
    case "navigate":
      interactionText = [interaction.actionLabel];
      break;
    case "reveal":
    case "explore":
      interactionText = [
        interaction.prompt,
        ...interaction.items.flatMap((item, index) =>
          isAlignedBlockReference(item, content.blocks[index])
            ? []
            : [item.label, item.content],
        ),
      ];
      break;
    case "choice":
      interactionText = interaction.questions.flatMap((question) => [
        question.prompt,
        ...question.options.map(({ label }) => label),
        question.feedback.success,
      ]);
      break;
    case "sort":
      interactionText = [
        interaction.prompt,
        ...interaction.items.flatMap((item) => [item.label, item.content]),
        interaction.feedback.success,
      ];
      break;
    case "input":
      interactionText = [
        interaction.prompt,
        interaction.placeholder,
        ...interaction.evaluationCriteria,
        interaction.feedback.success,
      ];
      break;
  }

  return [...new Set(interactionText)];
}

function isAlignedBlockReference(
  item: { label: string; content: string },
  block: PageContentDSL["blocks"][number] | undefined,
) {
  if (!block) return false;

  const names = [block.label, block.heading]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => [value, `${value}卡片`])
    .map(normalizeText);
  const references = new Set(names);

  return (
    references.has(normalizeText(item.label)) &&
    references.has(normalizeText(item.content))
  );
}

