import type {
  AssetGenerationResult,
  PageContentDSL,
} from "@/shared/course-schema";
import type { StyleTemplate } from "@/shared/templates/style";

import {
  canMergeChoiceBlocks,
  escapeHtmlAttribute,
  escapeHtmlText,
  renderAssets,
  renderInteraction,
  resolveTemplateLabel,
} from "./deterministic-fallback-markup";

type BroadsidePageFallbackInput = {
  content: PageContentDSL;
  assets: AssetGenerationResult[];
  styleTemplate: StyleTemplate;
};

/**
 * frontend-slides Broadside 的课程画布版本。Page Builder 先读取原始设计配方，
 * 再由这里把可信 DSL 确定性地映射为海报式信息层级、代码原生图形和运行时标记。
 * 这里刻意不用圆角卡片、阴影或全局缩字，避免退化成通用课程面板。
 */
export function renderBroadsidePageFallback({
  assets,
  content,
  styleTemplate,
}: BroadsidePageFallbackInput) {
  const mergeChoiceBlocks = canMergeChoiceBlocks(content);
  const blocks = mergeChoiceBlocks
    ? ""
    : content.blocks
        .map((block, index) => renderBroadsideBlock(block, index))
        .join("");
  const interaction = renderInteraction(content, mergeChoiceBlocks);
  const assetMarkup = renderAssets(content, assets);
  const primitive = renderBroadsidePrimitive(content);
  const templateLabel = resolveTemplateLabel(content.functionalTemplateId);

  return `<!doctype html>
<html lang="zh-CN" data-keya-canvas-mode="fluid" data-keya-renderer="broadside-structural">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlText(content.title)}</title>
  <style>
    :root {
      --ink: ${styleTemplate.colorTokens.background};
      --paper: ${styleTemplate.colorTokens.text};
      --flame: ${styleTemplate.colorTokens.primary};
      --ash: ${styleTemplate.colorTokens.mutedText};
      --rule: ${styleTemplate.colorTokens.border};
      --success: ${styleTemplate.colorTokens.success};
      --warning: ${styleTemplate.colorTokens.warning};
      --heading: ${styleTemplate.typography.headingFont};
      --body: ${styleTemplate.typography.bodyFont};
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      color: var(--paper);
      background: var(--ink);
      font-family: var(--body);
      font-size: clamp(13px, 1.8vmin, 17px);
      line-height: 1.42;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .52;
      background-image:
        linear-gradient(rgba(240, 236, 229, .045) 1px, transparent 1px),
        linear-gradient(90deg, rgba(240, 236, 229, .045) 1px, transparent 1px);
      background-size: clamp(22px, 4vw, 48px) clamp(22px, 4vw, 48px);
      mask-image: linear-gradient(110deg, #000, rgba(0,0,0,.2) 72%, transparent);
    }
    body::after {
      content: "";
      position: fixed;
      width: min(38vw, 360px);
      aspect-ratio: 1;
      right: -12vw;
      top: -46%;
      border: clamp(34px, 6vw, 72px) solid var(--flame);
      border-radius: 50%;
      opacity: .14;
      pointer-events: none;
    }
    button, input, textarea { font: inherit; }
    button, summary, label, [role="button"] { -webkit-tap-highlight-color: transparent; }
    main {
      position: relative;
      isolation: isolate;
      width: 100%;
      height: 100%;
      min-height: 0;
      padding: clamp(10px, 2.2vmin, 22px) clamp(12px, 2.7vw, 30px);
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: clamp(7px, 1.35vmin, 13px);
      overflow: hidden;
    }
    .masthead {
      min-height: 24px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: .8rem;
      padding-bottom: clamp(5px, .9vmin, 9px);
      border-bottom: 1px solid var(--paper);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: clamp(10px, 1.25vmin, 12px);
      font-weight: 700;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .masthead__brand { color: var(--flame); }
    .masthead__rail { height: 1px; background: var(--rule); }
    .masthead__folio { color: var(--ash); }
    .title-row {
      min-width: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(10rem, 34%);
      align-items: end;
      gap: clamp(10px, 2.3vw, 28px);
    }
    h1 {
      max-width: 15em;
      margin: 0;
      color: var(--paper);
      font-family: var(--heading);
      font-size: clamp(34px, 7.4vmin, 68px);
      font-weight: 900;
      line-height: .91;
      letter-spacing: -.055em;
      text-wrap: balance;
    }
    h1::first-letter { color: var(--flame); }
    .course-narration {
      min-width: 0;
      display: grid;
      align-content: end;
      gap: .24rem;
      padding-left: .75rem;
      border-left: 4px solid var(--flame);
      color: var(--ash);
      font-size: clamp(11px, 1.45vmin, 14px);
      line-height: 1.35;
    }
    .course-narration p { margin: 0; }
    .stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1.13fr) minmax(17rem, .87fr);
      border-top: 1px solid var(--rule);
      border-bottom: 1px solid var(--rule);
      overflow: hidden;
    }
    .context-pane,
    .interaction-panel {
      position: relative;
      min-width: 0;
      min-height: 0;
    }
    .context-pane {
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      padding: clamp(9px, 1.7vmin, 16px) clamp(10px, 1.8vw, 20px) clamp(8px, 1.4vmin, 13px) 0;
      border-right: 1px solid var(--rule);
      overflow: hidden;
    }
    .context-pane::before {
      content: attr(data-scene);
      position: absolute;
      top: clamp(8px, 1.4vmin, 14px);
      left: 0;
      color: var(--flame);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: clamp(9px, 1.15vmin, 11px);
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    .course-native-visual {
      position: relative;
      min-height: 0;
      width: 100%;
      overflow: hidden;
      color: var(--paper);
    }
    .course-native-visual svg {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 84px;
    }
    .visual-word {
      display: none;
    }
    .block-index {
      position: relative;
      z-index: 2;
      display: grid;
      grid-template-columns: repeat(var(--block-count, 1), minmax(0, 1fr));
      border-top: 1px solid var(--paper);
      background: color-mix(in srgb, var(--ink) 94%, transparent);
    }
    .lesson-strip {
      position: relative;
      min-width: 0;
      margin: 0;
      border: 0;
      border-right: 1px solid var(--rule);
    }
    .lesson-strip:last-child { border-right: 0; }
    .lesson-strip summary {
      min-height: 44px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: .55rem;
      padding: .42rem .55rem;
      color: var(--paper);
      cursor: pointer;
      list-style: none;
      font-size: clamp(11px, 1.45vmin, 14px);
      font-weight: 800;
      line-height: 1.16;
    }
    .lesson-strip summary::-webkit-details-marker { display: none; }
    .lesson-number {
      color: var(--flame);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: .76em;
      letter-spacing: .08em;
    }
    .lesson-copy {
      position: fixed;
      z-index: 20;
      left: clamp(12px, 2.7vw, 30px);
      right: clamp(12px, 2.7vw, 30px);
      bottom: clamp(10px, 2.2vmin, 22px);
      max-height: min(46vh, 240px);
      display: none;
      overflow: auto;
      padding: clamp(13px, 2.1vmin, 20px);
      border: 1px solid var(--paper);
      border-left: 8px solid var(--flame);
      color: var(--paper);
      background: color-mix(in srgb, var(--ink) 96%, var(--flame));
    }
    .lesson-strip[open] .lesson-copy { display: block; }
    .lesson-copy h2 { margin: 0 0 .35rem; font: 900 clamp(18px, 3vmin, 28px)/1 var(--heading); }
    .lesson-copy p { margin: 0 0 .35rem; }
    .lesson-copy ul { margin: .25rem 0 0; padding-left: 1.2rem; color: var(--ash); }
    .interaction-panel {
      display: grid;
      align-content: center;
      gap: clamp(5px, 1vmin, 9px);
      padding: clamp(9px, 1.7vmin, 16px) 0 clamp(8px, 1.4vmin, 13px) clamp(10px, 1.8vw, 20px);
      overflow: hidden;
    }
    .interaction-panel::before {
      content: "ACTION / 互动";
      color: var(--flame);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: clamp(9px, 1.15vmin, 11px);
      font-weight: 800;
      letter-spacing: .15em;
    }
    .interaction-prompt,
    .interaction-panel > p:not(.feedback),
    fieldset > p {
      margin: 0;
      font-family: var(--heading);
      font-size: clamp(14px, 2.2vmin, 20px);
      font-weight: 800;
      line-height: 1.08;
    }
    .interaction-items {
      min-height: 0;
      display: grid;
      gap: 0;
      margin: 0;
      padding: 0;
      list-style: none;
      overflow: hidden;
    }
    .interaction-items > details,
    .explore-item,
    .sort-item,
    fieldset {
      min-width: 0;
      margin: 0;
      padding: 0;
      border: 0;
      border-top: 1px solid var(--rule);
      background: transparent;
    }
    .interaction-items > details:last-child,
    .explore-item:last-child,
    .sort-item:last-child,
    fieldset:last-child { border-bottom: 1px solid var(--rule); }
    .interaction-items summary,
    .explore-item,
    .sort-item,
    .option {
      min-height: 44px;
    }
    .interaction-items summary,
    .explore-item,
    .sort-item {
      display: grid;
      align-items: center;
      padding: .42rem .5rem;
      color: var(--paper);
      cursor: pointer;
      font-size: clamp(11px, 1.45vmin, 14px);
      line-height: 1.18;
    }
    .interaction-items summary { list-style: none; font-weight: 800; }
    .interaction-items summary::-webkit-details-marker { display: none; }
    .interaction-items details > p,
    .explore-item p,
    .sort-item span {
      display: none;
      margin: 0;
      padding: .45rem .5rem .6rem;
      color: var(--ash);
      font-size: clamp(11px, 1.35vmin, 13px);
      line-height: 1.3;
    }
    .interaction-items details[open] > p,
    .explore-item:is(:hover, :focus, :focus-within) p,
    .sort-item:is(:hover, :focus, :focus-within) span { display: block; }
    .sort-item { grid-template-columns: minmax(5rem, .4fr) minmax(0, 1fr); gap: .5rem; }
    .sort-item::before { content: "↕"; color: var(--flame); }
    .sort-item span { grid-column: 2; }
    fieldset { min-width: 0; }
    legend {
      padding: .25rem 0;
      color: var(--flame);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    fieldset > h2 { margin: 0 0 .2rem; font: 900 clamp(14px, 2vmin, 18px)/1.05 var(--heading); }
    fieldset > ul { display: none; }
    .option {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr);
      align-items: center;
      gap: .55rem;
      padding: .3rem .4rem;
      border-top: 1px solid var(--rule);
      cursor: pointer;
      font-size: clamp(11px, 1.45vmin, 14px);
      line-height: 1.18;
    }
    .option:last-of-type { border-bottom: 1px solid var(--rule); }
    .option:hover,
    .option:has(input:checked) { color: var(--ink); background: var(--flame); }
    input[type="radio"] {
      width: 18px;
      height: 18px;
      margin: 0;
      accent-color: var(--flame);
    }
    textarea {
      width: 100%;
      min-height: clamp(64px, 14vmin, 96px);
      resize: none;
      padding: .65rem;
      border: 1px solid var(--paper);
      border-radius: 0;
      color: var(--paper);
      background: transparent;
    }
    .criteria { margin: 0; padding-left: 1.1rem; color: var(--ash); font-size: .85em; }
    button {
      min-width: 44px;
      min-height: 44px;
      width: 100%;
      padding: .55rem .85rem;
      border: 1px solid var(--flame);
      border-radius: 0;
      color: var(--ink);
      background: var(--flame);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: clamp(11px, 1.4vmin, 13px);
      font-weight: 900;
      letter-spacing: .09em;
      text-transform: uppercase;
      cursor: pointer;
    }
    button:hover { color: var(--flame); background: transparent; }
    .feedback {
      margin: 0;
      padding: .45rem .55rem;
      border-left: 4px solid var(--success);
      color: var(--paper);
      background: color-mix(in srgb, var(--success) 12%, transparent);
      font-size: clamp(11px, 1.35vmin, 13px);
    }
    [data-feedback-kind="retry"] { border-left-color: var(--warning); }
    [hidden] { display: none !important; }
    .asset-panel {
      position: absolute;
      z-index: 0;
      inset: 0;
      opacity: .3;
      pointer-events: none;
      overflow: hidden;
    }
    .asset-panel figure { width: 100%; height: 100%; margin: 0; }
    .course-asset { width: 100%; height: 100%; object-fit: cover; filter: grayscale(1) contrast(1.2); }
    .asset-fallback { display: none; }
    main[data-interaction="navigate"] .interaction-panel { align-content: end; }
    main[data-interaction="navigate"] .interaction-panel::after {
      content: "→";
      position: absolute;
      top: 10%;
      right: .03em;
      color: var(--flame);
      font: 900 clamp(70px, 20vmin, 170px)/1 var(--heading);
      opacity: .2;
      pointer-events: none;
    }
    main[data-interaction="choice"] .interaction-panel { align-content: start; }
    main[data-interaction="choice"] .interaction-items { overflow: visible; }
    main[data-interaction="choice"] .interaction-panel > button { margin-top: auto; }
    @media (max-width: 640px) {
      main {
        padding: 9px 11px;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 6px;
      }
      .masthead { min-height: 21px; gap: .45rem; padding-bottom: 4px; font-size: 9px; }
      .masthead__rail { display: none; }
      .masthead__brand { grid-column: 1 / 3; }
      .title-row { grid-template-columns: minmax(0, 1fr); gap: 4px; }
      h1 { max-width: none; font-size: clamp(31px, 10.5vw, 40px); line-height: .9; }
      .course-narration {
        max-height: 34px;
        display: block;
        overflow: hidden;
        padding-left: .5rem;
        border-left-width: 3px;
        font-size: 10px;
      }
      .course-narration p:not(:first-child) { display: none; }
      .stage {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: 70px minmax(0, 1fr);
      }
      .context-pane {
        grid-row: 1;
        display: block;
        padding: 0;
        border-right: 0;
        border-bottom: 1px solid var(--rule);
        overflow: visible;
      }
      .context-pane::before { display: none; }
      .course-native-visual {
        position: absolute;
        inset: 0 0 auto auto;
        width: 38%;
        height: 69px;
        opacity: .38;
      }
      .course-native-visual svg { min-height: 69px; }
      .visual-word { display: none; }
      .block-index {
        width: 72%;
        height: 69px;
        display: flex;
        overflow: hidden;
        border-top: 0;
        background: transparent;
      }
      .lesson-strip { flex: 1 1 0; overflow: hidden; }
      .lesson-strip summary {
        min-height: 69px;
        display: flex;
        gap: .2rem;
        padding: .25rem .32rem;
        font-size: 10px;
      }
      .lesson-number { font-size: 8px; }
      .lesson-copy {
        left: 11px;
        right: 11px;
        bottom: 9px;
        max-height: 48vh;
      }
      .interaction-panel {
        grid-row: 2;
        gap: 4px;
        padding: 7px 0 0;
        overflow: hidden;
      }
      .interaction-panel::before { font-size: 8px; }
      .interaction-prompt,
      .interaction-panel > p:not(.feedback),
      fieldset > p { font-size: clamp(13px, 4.1vw, 16px); }
      .interaction-items summary,
      .explore-item,
      .sort-item,
      .option { font-size: 11px; }
      main[data-interaction="choice"] .option { min-height: 40px; }
      main[data-interaction="choice"] .interaction-panel > button { min-height: 42px; }
      fieldset > h2 { display: none; }
      fieldset > p { margin-bottom: 2px; }
      .asset-panel { opacity: .16; }
    }
    @media (max-height: 520px) and (min-width: 641px) {
      .masthead { min-height: 20px; padding-bottom: 4px; }
      h1 { font-size: clamp(32px, 10vmin, 49px); }
      .course-narration { font-size: 11px; }
      .context-pane,
      .interaction-panel { padding-top: 7px; padding-bottom: 7px; }
      .interaction-panel { gap: 4px; }
      .interaction-items summary,
      .explore-item,
      .sort-item,
      .option { min-height: 40px; padding-block: .25rem; }
      button { min-height: 40px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <main data-page-id="${escapeHtmlAttribute(content.pageId)}" data-template="${escapeHtmlAttribute(content.functionalTemplateId)}" data-interaction="${escapeHtmlAttribute(content.interaction.type)}" data-block-count="${content.blocks.length}">
    <header class="masthead">
      <span class="masthead__brand">${escapeHtmlText(templateLabel)}</span>
      <span class="masthead__rail" aria-hidden="true"></span>
      <span class="masthead__folio">${escapeHtmlText(content.pageId.replace("page-", "NO."))}</span>
    </header>
    <div class="title-row">
      <h1>${escapeHtmlText(content.title)}</h1>
      ${renderNarration(content)}
    </div>
    <section class="stage">
      <section class="context-pane" data-scene="${escapeHtmlAttribute(content.runtime.sceneKind)}">
        ${primitive}
        <div class="block-index" style="--block-count:${Math.max(content.blocks.length, 1)}">${blocks}</div>
        ${assetMarkup}
      </section>
      ${interaction || '<section class="interaction-panel"><p>继续探索这一页的核心关系。</p></section>'}
    </section>
  </main>
</body>
</html>`;
}

function renderNarration(content: PageContentDSL) {
  return `<div class="course-narration">${content.narration
    .map((paragraph) => `<p>${escapeHtmlText(paragraph)}</p>`)
    .join("")}</div>`;
}

function renderBroadsideBlock(
  block: PageContentDSL["blocks"][number],
  index: number,
) {
  const label =
    block.label && block.label !== block.heading
      ? `<p>${escapeHtmlText(block.label)}</p>`
      : "";
  const points =
    block.supportingPoints.length > 0
      ? `<ul>${block.supportingPoints
          .map((point) => `<li>${escapeHtmlText(point)}</li>`)
          .join("")}</ul>`
      : "";
  return `<details class="lesson-strip" data-block-id="${escapeHtmlAttribute(block.id)}" data-runtime-target-id="${escapeHtmlAttribute(block.id)}">
    <summary><span class="lesson-number">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtmlText(block.heading)}</span></summary>
    <div class="lesson-copy">${label}<h2>${escapeHtmlText(block.heading)}</h2><p>${escapeHtmlText(block.body)}</p>${points}</div>
  </details>`;
}

function renderBroadsidePrimitive(content: PageContentDSL) {
  const primitive = content.runtime.visualPrimitive;
  if (primitive === "none") {
    return `<div class="course-native-visual" aria-hidden="true">${baseSignalSvg("none")}</div>`;
  }

  return `<div class="course-native-visual" data-visual-primitive="${escapeHtmlAttribute(primitive)}" aria-label="${escapeHtmlAttribute(content.title)}的代码原生图示">
    ${baseSignalSvg(primitive)}
    <span class="visual-word" aria-hidden="true">${visualWord(primitive)}</span>
  </div>`;
}

function baseSignalSvg(primitive: PageContentDSL["runtime"]["visualPrimitive"]) {
  if (primitive === "function-graph") {
    return `<svg viewBox="0 0 620 240" preserveAspectRatio="none" aria-hidden="true"><path d="M24 204H596M56 224V22" fill="none" stroke="var(--rule)"/><path d="M56 188C142 188 154 52 240 52s98 136 184 136 98-136 172-136" fill="none" stroke="var(--flame)" stroke-width="7"/><path d="M56 118H596" fill="none" stroke="var(--paper)" stroke-dasharray="2 14" opacity=".45"/></svg>`;
  }
  if (primitive === "venn") {
    return `<svg viewBox="0 0 620 240" preserveAspectRatio="xMidYMid meet" aria-hidden="true"><circle cx="258" cy="120" r="92" fill="none" stroke="var(--paper)" stroke-width="2"/><circle cx="362" cy="120" r="92" fill="var(--flame)" fill-opacity=".22" stroke="var(--flame)" stroke-width="7"/><path d="M46 120H574" stroke="var(--rule)" stroke-dasharray="3 12"/></svg>`;
  }
  if (primitive === "process" || primitive === "timeline") {
    return `<svg viewBox="0 0 620 240" preserveAspectRatio="none" aria-hidden="true"><path d="M40 120H580" stroke="var(--paper)" stroke-width="2"/><path d="M40 120H390" stroke="var(--flame)" stroke-width="8"/><g fill="var(--ink)" stroke="var(--paper)" stroke-width="2"><circle cx="78" cy="120" r="22"/><circle cx="250" cy="120" r="22"/><circle cx="422" cy="120" r="22"/><circle cx="560" cy="120" r="22"/></g><g fill="var(--flame)"><circle cx="78" cy="120" r="8"/><circle cx="250" cy="120" r="8"/><circle cx="422" cy="120" r="8"/></g><path d="M542 96L580 120 542 144" fill="none" stroke="var(--paper)" stroke-width="2"/></svg>`;
  }
  if (primitive === "comparison") {
    return `<svg viewBox="0 0 620 240" preserveAspectRatio="none" aria-hidden="true"><path d="M46 210H590M46 210V24" stroke="var(--paper)" stroke-width="2"/><g fill="var(--flame)"><rect x="94" y="48" width="82" height="162"/><rect x="270" y="108" width="82" height="102" opacity=".72"/><rect x="446" y="162" width="82" height="48" opacity=".42"/></g><path d="M94 48C240 62 350 132 528 162" fill="none" stroke="var(--paper)" stroke-width="3" stroke-dasharray="5 11"/></svg>`;
  }
  if (primitive === "concept-map") {
    return `<svg viewBox="0 0 620 240" preserveAspectRatio="none" aria-hidden="true"><g fill="none"><path d="M310 120L86 48M310 120L86 194M310 120L534 48M310 120L534 194" stroke="var(--rule)" stroke-width="2"/><circle cx="310" cy="120" r="50" stroke="var(--flame)" stroke-width="8"/><g stroke="var(--paper)" stroke-width="2"><circle cx="86" cy="48" r="24"/><circle cx="86" cy="194" r="24"/><circle cx="534" cy="48" r="24"/><circle cx="534" cy="194" r="24"/></g></g></svg>`;
  }
  return `<svg viewBox="0 0 620 240" preserveAspectRatio="none" aria-hidden="true"><path d="M20 200L190 38 306 154 414 58 600 200" fill="none" stroke="var(--flame)" stroke-width="8"/><path d="M20 200H600" stroke="var(--paper)" stroke-width="2"/><path d="M70 30V214M310 30V214M550 30V214" stroke="var(--rule)" stroke-dasharray="2 12"/></svg>`;
}

function visualWord(primitive: PageContentDSL["runtime"]["visualPrimitive"]) {
  const words: Record<PageContentDSL["runtime"]["visualPrimitive"], string> = {
    "concept-map": "关系",
    "function-graph": "曲线",
    comparison: "对比",
    none: "发现",
    process: "过程",
    timeline: "时间",
    venn: "交集",
  };
  return words[primitive];
}
