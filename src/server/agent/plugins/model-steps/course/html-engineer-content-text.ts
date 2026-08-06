import type { PageContentDSL } from "@/shared/course-schema";

import { normalizeText } from "./html-engineer-text";

/**
 * 只把学习主干视为页面必须保留的文字。旁白、supporting points、placeholder、
 * 评价标准与反馈仍保存在 DSL，可由设计按层级渐进或条件呈现，不能再逼迫它们
 * 同时铺满固定画布。
 */
export function collectRequiredStaticContentText(content: PageContentDSL) {
  const blockText = content.blocks.flatMap((block) => [
    block.heading,
    block.body,
  ]);
  const interactionText = collectInteractionStaticContentText(content);

  return [
    ...new Set([...blockText, ...interactionText]),
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
        ...interaction.items.map(({ label }) => label),
      ];
      break;
    case "choice":
      interactionText = interaction.questions.flatMap((question) => [
        question.prompt,
        ...question.options.map(({ label }) => label),
      ]);
      break;
    case "sort":
      interactionText = [
        interaction.prompt,
        ...interaction.items.map(({ label }) => label),
      ];
      break;
    case "input":
      interactionText = [interaction.prompt];
      break;
  }

  return [...new Set(interactionText)];
}

export function isAlignedBlockReference(
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

/**
 * reveal item 若只是同序正文块的交互入口，正文块已经承担可信内容展示，
 * 不应再在交互控件内复制一份。除显式“卡片引用”外，也接受 item 的标签和
 * 内容均已由该 block 的可信 DSL 文本覆盖。
 */
export function isRevealItemRepresentedByBlock(
  item: { label: string; content: string },
  block: PageContentDSL["blocks"][number] | undefined,
) {
  if (!block) return false;
  if (isAlignedBlockReference(item, block)) return true;

  const blockText = normalizeText(
    [
      block.label,
      block.heading,
      block.body,
      ...block.supportingPoints,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  );

  return [item.label, item.content].every((text) =>
    blockText.includes(normalizeText(text)),
  );
}
