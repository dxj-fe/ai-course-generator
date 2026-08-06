import type {
  AssetGenerationResult,
  PageContentDSL,
} from "@/shared/course-schema";

export function renderNarration(content: PageContentDSL) {
  if (content.narration.length === 0) {
    return '<div class="course-narration"></div>';
  }
  return `<div class="course-narration">${content.narration
    .map((paragraph) => `<p>${escapeHtmlText(paragraph)}</p>`)
    .join("")}</div>`;
}

export function renderBlock(
  block: PageContentDSL["blocks"][number],
  content: PageContentDSL,
) {
  const runtimeTarget = ` data-runtime-target-id="${escapeHtmlAttribute(block.id)}"`;
  const label =
    block.label && block.label !== block.heading
      ? `<p class="lesson-label">${escapeHtmlText(block.label)}</p>`
      : "";
  const points =
    block.supportingPoints.length > 0
      ? `<ul>${block.supportingPoints
          .map((point) => `<li>${escapeHtmlText(point)}</li>`)
          .join("")}</ul>`
      : "";
  const blockIndex =
    content.blocks.findIndex(({ id }) => id === block.id) + 1;

  return `<article class="lesson-card" data-block-index="${String(blockIndex).padStart(2, "0")}" data-block-id="${escapeHtmlAttribute(block.id)}"${runtimeTarget}>
    <div class="course-block-summary"><h2>${escapeHtmlText(block.heading)}</h2></div>
    <div class="course-block-body">
      ${label}
      <p>${escapeHtmlText(block.body)}</p>
      ${points}
    </div>
  </article>`;
}

export function renderInteraction(
  content: PageContentDSL,
  mergeChoiceBlocks: boolean,
) {
  const interaction = content.interaction;
  if (interaction.type === "none") return "";

  const rootAttributes = `data-interaction-type="${interaction.type}" data-interaction-id="interaction-${escapeHtmlAttribute(content.pageId)}"`;

  switch (interaction.type) {
    case "navigate":
      return `<section class="interaction-panel" ${rootAttributes}>
        <button type="button">${escapeHtmlText(interaction.actionLabel)}</button>
      </section>`;
    case "reveal":
      return `<section class="interaction-panel" ${rootAttributes}>
        ${renderPrompt(interaction.prompt, content)}
        <div class="interaction-items">${interaction.items
          .map(
            (item) => `<details data-interaction-item-id="${escapeHtmlAttribute(item.id)}">
              <summary>${escapeHtmlText(item.label)}</summary>
              ${renderItemContent(item.label, item.content)}
            </details>`,
          )
          .join("")}</div>
      </section>`;
    case "explore":
      return `<section class="interaction-panel" ${rootAttributes}>
        ${renderPrompt(interaction.prompt, content)}
        <div class="interaction-items">${interaction.items
          .map(
            (item) => `<article class="explore-item" role="button" tabindex="0" data-interaction-item-id="${escapeHtmlAttribute(item.id)}">
              <h3>${escapeHtmlText(item.label)}</h3>
              ${renderItemContent(item.label, item.content)}
            </article>`,
          )
          .join("")}</div>
      </section>`;
    case "choice":
      return `<section class="interaction-panel" ${rootAttributes}>
        <div class="interaction-items">${interaction.questions
          .map((question, index) =>
            renderChoiceQuestion(
              question,
              index,
              content,
              mergeChoiceBlocks ? content.blocks[index] : undefined,
            ),
          )
          .join("")}</div>
        <button type="button" data-runtime-submit="true">提交答案</button>
        <p class="feedback" data-feedback-kind="success" hidden>${escapeHtmlText(
          [
            ...new Set(
              interaction.questions.map(({ feedback }) => feedback.success),
            ),
          ].join(" "),
        )}</p>
        <p class="feedback" data-feedback-kind="retry" hidden>${escapeHtmlText(
          [
            ...new Set(
              interaction.questions.map(({ feedback }) => feedback.retry),
            ),
          ].join(" "),
        )}</p>
      </section>`;
    case "sort":
      return `<section class="interaction-panel" ${rootAttributes}>
        ${renderPrompt(interaction.prompt, content)}
        <ol class="interaction-items">${interaction.items
          .map(
            (item) => `<li class="sort-item" data-interaction-item-id="${escapeHtmlAttribute(item.id)}">
              <strong>${escapeHtmlText(item.label)}</strong>
              ${normalizeText(item.label) === normalizeText(item.content) ? "" : `<span>${escapeHtmlText(item.content)}</span>`}
            </li>`,
          )
          .join("")}</ol>
        <button type="button" data-runtime-submit="true">检查顺序</button>
        <p class="feedback" data-feedback-kind="success" hidden>${escapeHtmlText(interaction.feedback.success)}</p>
      </section>`;
    case "input":
      return `<section class="interaction-panel" ${rootAttributes}>
        ${renderPrompt(interaction.prompt, content, "label")}
        <textarea data-runtime-input="true" placeholder="${escapeHtmlAttribute(interaction.placeholder)}"></textarea>
        <ul class="criteria">${interaction.evaluationCriteria
          .map((criterion) => `<li>${escapeHtmlText(criterion)}</li>`)
          .join("")}</ul>
        <button type="button" data-runtime-submit="true">提交回答</button>
        <p class="feedback" data-feedback-kind="success" hidden>${escapeHtmlText(interaction.feedback.success)}</p>
      </section>`;
  }
}

function renderChoiceQuestion(
  question: Extract<
    PageContentDSL["interaction"],
    { type: "choice" }
  >["questions"][number],
  index: number,
  content: PageContentDSL,
  block: PageContentDSL["blocks"][number] | undefined,
) {
  const blockAttributes = block
    ? ` data-block-id="${escapeHtmlAttribute(block.id)}" data-runtime-target-id="${escapeHtmlAttribute(block.id)}"`
    : "";
  const blockMarkup = block
    ? `${block.label && block.label !== block.heading ? `<p class="lesson-label">${escapeHtmlText(block.label)}</p>` : ""}
       <h2>${escapeHtmlText(block.heading)}</h2>
       <p>${escapeHtmlText(block.body)}</p>
       ${
         block.supportingPoints.length > 0
           ? `<ul>${block.supportingPoints
               .map((point) => `<li>${escapeHtmlText(point)}</li>`)
               .join("")}</ul>`
           : ""
       }`
    : "";
  const prompt = isChoicePromptRepresentedByBlock(
    question.prompt,
    block,
    index,
  )
    ? ""
    : `<p>${escapeHtmlText(question.prompt)}</p>`;

  return `<fieldset data-question-id="${escapeHtmlAttribute(question.id)}"${blockAttributes}>
    <legend>第 ${index + 1} 题</legend>
    ${blockMarkup}
    ${prompt}
    ${question.options
      .map(
        (option) => `<label class="option">
          <input type="radio" name="${escapeHtmlAttribute(question.id)}" value="${escapeHtmlAttribute(option.id)}">
          <span>${escapeHtmlText(option.label)}</span>
        </label>`,
      )
      .join("")}
  </fieldset>`;
}

function renderPrompt(
  prompt: string,
  content: PageContentDSL,
  element: "p" | "label" = "p",
) {
  if (isTextRepresentedByBlock(prompt, content)) return "";
  return `<${element} class="interaction-prompt">${escapeHtmlText(prompt)}</${element}>`;
}

function renderItemContent(label: string, content: string) {
  return normalizeText(label) === normalizeText(content)
    ? ""
    : `<p>${escapeHtmlText(content)}</p>`;
}

export function renderAssets(
  content: PageContentDSL,
  assets: AssetGenerationResult[],
) {
  if (content.assetSlots.length === 0) return "";
  const results = new Map(
    assets.map((result) => [result.request.assetSlotId, result] as const),
  );

  return `<section class="asset-panel">${content.assetSlots
    .map((slot) => {
      const result = results.get(slot.id);
      if (result?.status === "ready" && result.asset?.uri) {
        const classes = [
          "course-asset-frame",
          `asset-panel--${result.request.assetType}`,
          result.warnings?.includes("TRANSPARENCY_UNAVAILABLE")
            ? "asset-panel--opaque-sticker"
            : "",
          `asset-panel--role-${slot.role}`,
        ]
          .filter(Boolean)
          .join(" ");
        return `<figure class="${escapeHtmlAttribute(classes)}">
          <img class="course-asset" data-asset-slot-id="${escapeHtmlAttribute(slot.id)}" src="${escapeHtmlAttribute(result.asset.uri)}" alt="${escapeHtmlAttribute(result.asset.altText ?? "")}">
        </figure>`;
      }
      if (result?.status === "fallback" && result.fallback) {
        return `<figure class="asset-fallback" data-asset-slot-id="${escapeHtmlAttribute(slot.id)}" data-asset-fallback="${escapeHtmlAttribute(result.fallback.kind)}">
          <figcaption>${escapeHtmlText(result.fallback.description)}</figcaption>
        </figure>`;
      }
      return `<figure class="asset-fallback" data-asset-slot-id="${escapeHtmlAttribute(slot.id)}">
        <figcaption>${escapeHtmlText(slot.purpose)}</figcaption>
      </figure>`;
    })
    .join("")}</section>`;
}

export function renderVisualPrimitive(content: PageContentDSL) {
  const primitive = content.runtime.visualPrimitive;
  if (primitive === "none") return "";

  return `<div class="course-native-visual" data-visual-primitive="${escapeHtmlAttribute(primitive)}" aria-label="${escapeHtmlAttribute(content.title)}的代码原生图示">
    ${renderPrimitiveSvg(primitive)}
  </div>`;
}

function renderPrimitiveSvg(
  primitive: PageContentDSL["runtime"]["visualPrimitive"],
) {
  const common = 'viewBox="0 0 620 360" preserveAspectRatio="xMidYMid meet" aria-hidden="true"';

  if (primitive === "function-graph") {
    return `<svg ${common}><path class="native-grid" d="M70 48V310M70 310H570M70 244H570M70 178H570M70 112H570"/><path class="native-accent" d="M70 278C150 278 166 84 252 84s105 194 190 194 74-130 128-168"/><circle class="native-node" cx="252" cy="84" r="13"/><circle class="native-node" cx="442" cy="278" r="13"/></svg>`;
  }
  if (primitive === "venn") {
    return `<svg ${common}><circle class="native-primary native-fill-soft" cx="252" cy="180" r="118"/><circle class="native-accent native-fill-soft" cx="368" cy="180" r="118"/><circle class="native-node" cx="310" cy="180" r="18"/><path class="native-grid" d="M82 180H538"/></svg>`;
  }
  if (primitive === "process" || primitive === "timeline") {
    return `<svg ${common}><path class="native-grid" d="M72 180H548"/><path class="native-primary native-progress" d="M72 180H420"/><g class="native-node-group"><circle cx="92" cy="180" r="34"/><circle cx="242" cy="180" r="34"/><circle cx="392" cy="180" r="34"/><circle cx="528" cy="180" r="34"/></g><g class="native-dot-group"><circle cx="92" cy="180" r="9"/><circle cx="242" cy="180" r="9"/><circle cx="392" cy="180" r="9"/></g><path class="native-accent" d="M502 148L544 180 502 212"/></svg>`;
  }
  if (primitive === "comparison") {
    return `<svg ${common}><path class="native-grid" d="M78 302H550M78 302V54"/><rect class="native-primary native-fill" x="126" y="94" width="88" height="208" rx="18"/><rect class="native-accent native-fill" x="270" y="154" width="88" height="148" rx="18"/><rect class="native-primary native-fill-soft" x="414" y="218" width="88" height="84" rx="18"/><path class="native-accent" d="M126 94C250 116 364 198 502 218"/></svg>`;
  }
  if (primitive === "concept-map") {
    return `<svg ${common}><g class="native-grid"><path d="M310 180L108 78M310 180L108 282M310 180L512 78M310 180L512 282"/></g><circle class="native-primary native-fill-soft" cx="310" cy="180" r="72"/><g class="native-node-group"><circle cx="108" cy="78" r="32"/><circle cx="108" cy="282" r="32"/><circle cx="512" cy="78" r="32"/><circle cx="512" cy="282" r="32"/></g><circle class="native-dot" cx="310" cy="180" r="18"/></svg>`;
  }
  return "";
}

export function canMergeChoiceBlocks(content: PageContentDSL) {
  return (
    content.interaction.type === "choice" &&
    content.blocks.length === content.interaction.questions.length &&
    content.blocks.every(({ kind }) => kind === "question")
  );
}

function isChoicePromptRepresentedByBlock(
  prompt: string,
  block: PageContentDSL["blocks"][number] | undefined,
  questionIndex: number,
) {
  if (!block) return false;
  const normalizedPrompt = normalizeText(prompt);
  const normalizedBody = normalizeText(block.body);
  if (normalizedPrompt === normalizedBody) return true;

  const number = questionIndex + 1;
  const numericPrefix = new RegExp(`^${number}\\s*[.、:)]\\s*(.+)$`);
  const chinesePrefix = new RegExp(
    `^第\\s*${number}\\s*题\\s*[.、:：]?\\s*(.+)$`,
  );
  const body =
    normalizedPrompt.match(numericPrefix)?.[1]?.trim() ??
    normalizedPrompt.match(chinesePrefix)?.[1]?.trim();
  return Boolean(body && normalizeText(body) === normalizedBody);
}

function isTextRepresentedByBlock(
  text: string,
  content: PageContentDSL,
) {
  const normalized = normalizeText(text);
  return content.blocks.some((block) =>
    [block.heading, block.body, ...block.supportingPoints].some(
      (candidate) => normalizeText(candidate) === normalized,
    ),
  );
}

export function resolveDensity(content: PageContentDSL) {
  const textLength =
    content.title.length +
    content.narration.join("").length +
    content.blocks.reduce(
      (total, block) =>
        total +
        block.heading.length +
        block.body.length +
        block.supportingPoints.join("").length,
      0,
    );
  return content.blocks.length > 4 || textLength > 1_400
    ? "dense"
    : "balanced";
}

export function resolveTemplateLabel(
  templateId: PageContentDSL["functionalTemplateId"],
) {
  const labels: Partial<
    Record<PageContentDSL["functionalTemplateId"], string>
  > = {
    "achievement-task": "表达任务 · CREATE",
    "course-cover": "课程导入 · DISCOVER",
    "interactive-quiz": "理解检测 · PRACTICE",
    "knowledge-card-grid": "核心概念 · INSIGHT",
    "learning-timeline": "情节脉络 · TIMELINE",
    "recap-summary": "学习回顾 · RECAP",
    "story-intro": "故事导读 · STORY",
  };
  return labels[templateId] ?? "课程学习 · KEYA";
}

function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeHtmlAttribute(value: string) {
  return escapeHtmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
