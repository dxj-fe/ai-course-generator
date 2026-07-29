import type {
  AssetGenerationResult,
  PageContentDSL,
} from "@/shared/course-schema";
import {
  styleTemplateToCssText,
  type StyleTemplate,
} from "@/shared/templates/style";

export type DeterministicPageFallbackInput = {
  content: PageContentDSL;
  assets?: AssetGenerationResult[];
  styleTemplate: StyleTemplate;
};

export const DETERMINISTIC_PAGE_RENDERER_VERSION = 4;

/**
 * 当模型 HTML 没有通过合同校验时，用已经通过 Schema 校验的服务端事实生成
 * 一份无脚本、可验证的页面。这里不复用任何模型标记，避免把残缺或危险片段
 * 带入最终课程。
 */
export function renderDeterministicPageFallback({
  assets = [],
  content,
  styleTemplate,
}: DeterministicPageFallbackInput) {
  const mergeChoiceBlocks = canMergeChoiceBlocks(content);
  const blocks = mergeChoiceBlocks
    ? ""
    : content.blocks.map((block) => renderBlock(block, content)).join("");
  const interaction = renderInteraction(content, mergeChoiceBlocks);
  const assetMarkup = renderAssets(content, assets);
  const visualPrimitive = renderVisualPrimitive(content);
  const density = resolveDensity(content);
  const sceneKind =
    content.version === 2 ? content.runtime?.sceneKind : undefined;
  const templateLabel = resolveTemplateLabel(content.functionalTemplateId);

  return `<!doctype html>
<html lang="zh-CN" data-keya-canvas-mode="fluid" data-keya-renderer="deterministic" data-keya-renderer-version="${DETERMINISTIC_PAGE_RENDERER_VERSION}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtmlText(content.title)}</title>
  <style>
${styleTemplateToCssText(styleTemplate)}
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      position: relative;
      color: var(--course-color-text);
      background:
        radial-gradient(circle at 92% 9%, color-mix(in srgb, var(--course-color-accent) 17%, transparent) 0 9%, transparent 9.5%),
        radial-gradient(circle at 7% 92%, color-mix(in srgb, var(--course-color-primary) 12%, transparent) 0 13%, transparent 13.5%),
        linear-gradient(142deg, var(--course-color-background), color-mix(in srgb, var(--course-color-surface-alt) 72%, var(--course-color-background)));
      font-family: var(--course-font-body);
      font-size: clamp(13px, 1.65vmin, var(--course-font-size-base));
      font-weight: var(--course-font-weight-body);
      line-height: var(--course-line-height-body);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .42;
      background-image: radial-gradient(color-mix(in srgb, var(--course-color-primary) 34%, transparent) .7px, transparent .7px);
      background-size: 18px 18px;
      mask-image: linear-gradient(110deg, #000, transparent 42%, transparent 72%, #000);
    }
    button, input, textarea { font: inherit; }
    main {
      position: relative;
      isolation: isolate;
      width: 100%;
      height: 100%;
      min-height: 100%;
      padding: clamp(12px, 2.25vmin, 28px);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: clamp(10px, 1.6vmin, 20px);
    }
    .course-header {
      display: grid;
      grid-template-columns: minmax(0, .9fr) minmax(18rem, 1.1fr);
      align-items: center;
      gap: clamp(10px, 2vw, 28px);
      padding: 0 .3rem clamp(10px, 1.5vmin, 18px);
      border-bottom: 1px solid color-mix(in srgb, var(--course-color-border) 78%, transparent);
    }
    .course-kicker {
      margin: 0 0 .35rem;
      color: var(--course-color-primary);
      font-size: .72em;
      font-weight: 800;
      letter-spacing: .14em;
      text-transform: uppercase;
    }
    h1, h2, h3, p { margin-top: 0; }
    h1 {
      margin-bottom: 0;
      font-family: var(--course-font-heading);
      font-size: clamp(1.7em, 4.1vmin, 3.35em);
      font-weight: var(--course-font-weight-heading);
      line-height: 1.04;
      letter-spacing: -.025em;
      text-wrap: balance;
    }
    h2 { margin-bottom: .42em; font-size: clamp(1.08em, 2.1vmin, 1.55em); }
    h3 { margin-bottom: .36em; font-size: 1.05em; }
    p { margin-bottom: .62em; }
    ul, ol { margin: .45em 0 0; padding-left: 1.3em; }
    li + li { margin-top: .24em; }
    .course-narration {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(12rem, 100%), 1fr));
      gap: .35rem 1rem;
      color: var(--course-color-muted);
      font-size: .92em;
    }
    .course-narration p {
      margin-bottom: 0;
      padding-left: .8rem;
      border-left: 2px solid color-mix(in srgb, var(--course-color-accent) 58%, transparent);
    }
    .course-stage {
      position: relative;
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1.48fr) minmax(17rem, .92fr);
      gap: clamp(10px, 1.7vmin, 22px);
      align-items: stretch;
    }
    .course-content,
    .course-action {
      min-width: 0;
      min-height: 0;
      display: grid;
      align-content: stretch;
      gap: clamp(8px, 1.15vmin, 14px);
    }
    .course-content {
      position: relative;
      grid-template-columns: repeat(auto-fit, minmax(min(15rem, 100%), 1fr));
      align-content: center;
      align-items: stretch;
    }
    .lesson-card,
    .interaction-panel,
    .asset-panel {
      position: relative;
      min-width: 0;
      overflow: hidden;
      padding: clamp(11px, 1.55vmin, 20px);
      border: 1px solid color-mix(in srgb, var(--course-color-border) 84%, transparent);
      border-radius: var(--course-radius-card);
      background: color-mix(in srgb, var(--course-color-surface) 92%, transparent);
      box-shadow:
        0 22px 50px -34px color-mix(in srgb, var(--course-color-text) 48%, transparent),
        inset 0 1px 0 color-mix(in srgb, #fff 76%, transparent);
    }
    .lesson-card {
      z-index: 1;
      display: grid;
      align-content: start;
      min-height: 0;
      height: auto;
      overflow: visible;
      border-top: 4px solid var(--course-color-primary);
      background:
        linear-gradient(155deg, color-mix(in srgb, var(--course-color-surface) 98%, transparent), color-mix(in srgb, var(--course-color-surface-alt) 45%, var(--course-color-surface)));
    }
    .lesson-card::after {
      content: attr(data-block-index);
      position: absolute;
      top: .75rem;
      right: .8rem;
      display: grid;
      place-items: center;
      width: 2rem;
      aspect-ratio: 1;
      border-radius: 50%;
      color: var(--course-color-primary);
      background: color-mix(in srgb, var(--course-color-primary) 11%, var(--course-color-surface));
      font-size: .7em;
      font-weight: 800;
    }
    .course-block-summary {
      min-height: 34px;
      display: flex;
      align-items: center;
      padding-right: 2.1rem;
    }
    .course-block-summary h2 { margin: 0; }
    .course-block-body { min-height: 0; padding-top: .55rem; }
    .course-block-body > p:not(.lesson-label) {
      display: block;
      overflow: visible;
      overflow-wrap: anywhere;
    }
    .course-block-body > :last-child { margin-bottom: 0; }
    .lesson-label {
      margin: 0 0 .3em;
      color: var(--course-color-accent);
      font-size: .75em;
      font-weight: 800;
      letter-spacing: .1em;
    }
    .course-action {
      position: relative;
      display: grid;
      grid-template: minmax(0, 1fr) / minmax(0, 1fr);
      border-radius: var(--course-radius-card);
    }
    .asset-panel {
      grid-area: 1 / 1;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      height: 100%;
      min-height: 0;
      padding: 0;
      background:
        radial-gradient(circle at 68% 24%, color-mix(in srgb, var(--course-color-accent) 24%, transparent), transparent 34%),
        linear-gradient(145deg, color-mix(in srgb, var(--course-color-primary) 11%, var(--course-color-surface)), var(--course-color-surface-alt));
    }
    .asset-panel figure {
      min-width: 0;
      min-height: 0;
      height: 100%;
      margin: 0;
      text-align: center;
    }
    .course-asset {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 100%;
      object-fit: contain;
      object-position: center;
      border-radius: inherit;
    }
    .asset-panel--background .course-asset,
    .asset-panel--opaque-sticker .course-asset {
      object-fit: cover;
    }
    .asset-panel--background .course-asset {
      width: 68%;
      margin-left: auto;
    }
    .asset-panel--character_sticker:not(.asset-panel--opaque-sticker) .course-asset {
      padding: clamp(10px, 2vmin, 28px);
      filter: drop-shadow(0 18px 18px color-mix(in srgb, var(--course-color-text) 18%, transparent));
    }
    .course-stage:has(.asset-panel--background) {
      grid-template-columns: minmax(0, 1.35fr) minmax(17rem, .82fr);
    }
    .course-stage:has(.asset-panel--background) .course-content {
      z-index: 2;
      grid-area: 1 / 1;
      align-content: center;
      padding: clamp(8px, 1.4vmin, 16px);
    }
    .course-stage:has(.asset-panel--background) .course-action {
      display: contents;
    }
    .course-stage:has(.asset-panel--background) .asset-panel {
      z-index: 0;
      grid-area: 1 / 1 / 2 / 3;
      border: 0;
      border-radius: var(--course-radius-card);
    }
    .course-stage:has(.asset-panel--background) .asset-panel::after {
      content: "";
      position: absolute;
      z-index: 1;
      inset: 0;
      pointer-events: none;
      border-radius: inherit;
      background: linear-gradient(90deg, color-mix(in srgb, var(--course-color-background) 58%, transparent), transparent 58%);
    }
    .course-stage:has(.asset-panel--background) .interaction-panel {
      z-index: 3;
      grid-area: 1 / 2;
      align-self: end;
    }
    .asset-fallback {
      min-height: 100%;
      display: grid;
      place-items: center;
      padding: 1.2rem;
      border: 0;
      border-radius: inherit;
      background:
        radial-gradient(circle at 28% 34%, color-mix(in srgb, var(--course-color-accent) 28%, transparent) 0 11%, transparent 12%),
        linear-gradient(135deg, color-mix(in srgb, var(--course-color-primary) 18%, var(--course-color-surface)), var(--course-color-surface-alt));
      color: var(--course-color-muted);
    }
    .interaction-panel {
      z-index: 2;
      grid-area: 1 / 1;
      align-self: end;
      max-height: calc(100% - 1.3rem);
      margin: .65rem;
      overflow: visible;
      padding: clamp(10px, 1.35vmin, 17px);
      background: color-mix(in srgb, var(--course-color-surface) 88%, transparent);
      backdrop-filter: blur(18px) saturate(1.18);
    }
    .course-action:not(:has(.asset-panel)) .interaction-panel {
      align-self: stretch;
      max-height: none;
      margin: 0;
    }
    .interaction-prompt { color: var(--course-color-primary); font-weight: 800; }
    .interaction-items { display: grid; gap: .55rem; }
    .interaction-items > :last-child { margin-bottom: 0; }
    details,
    .explore-item,
    .sort-item,
    fieldset {
      margin: 0;
      padding: .65rem .75rem;
      border: 1px solid var(--course-color-border);
      border-radius: max(.75rem, calc(var(--course-radius-card) * .55));
      background: color-mix(in srgb, var(--course-color-surface-alt) 68%, var(--course-color-surface));
    }
    summary { cursor: pointer; font-weight: 700; }
    fieldset { min-width: 0; }
    legend { padding: 0 .25rem; font-weight: 700; }
    .option {
      min-height: 44px;
      display: flex;
      align-items: center;
      gap: .55rem;
      padding: .38rem .5rem;
      border-radius: var(--course-radius-control);
      cursor: pointer;
      border: 1px solid transparent;
    }
    .option:hover {
      border-color: color-mix(in srgb, var(--course-color-primary) 34%, transparent);
      background: color-mix(in srgb, var(--course-color-primary) 9%, transparent);
    }
    input[type="radio"] { width: 1.1rem; height: 1.1rem; accent-color: var(--course-color-primary); }
    textarea {
      width: 100%;
      min-height: clamp(82px, 15vh, 142px);
      resize: none;
      padding: .7rem .8rem;
      border: 1px solid var(--course-color-border);
      border-radius: max(.85rem, calc(var(--course-radius-card) * .55));
      color: var(--course-color-text);
      background: var(--course-color-surface);
    }
    button {
      min-width: 44px;
      min-height: 44px;
      padding: .55rem 1rem;
      border: 0;
      border-radius: var(--course-radius-control);
      color: var(--course-color-surface);
      background: var(--course-color-primary);
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 10px 22px -14px color-mix(in srgb, var(--course-color-primary) 75%, transparent);
    }
    .feedback {
      margin: .65rem 0 0;
      padding: .58rem .7rem;
      border-radius: var(--course-radius-control);
      color: var(--course-color-text);
      background: color-mix(in srgb, var(--course-color-success) 14%, var(--course-color-surface));
    }
    .criteria { margin-bottom: .7rem; }
    .course-native-visual { display: none; }
    main[data-block-count="3"] .course-content {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    main[data-block-count="3"] .lesson-card {
      min-height: clamp(142px, 22vh, 220px);
    }
    main[data-template="story-intro"] .course-content {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: repeat(3, minmax(0, 1fr));
      align-content: stretch;
    }
    main[data-template="story-intro"] .lesson-card {
      min-height: 0;
      grid-template-columns: minmax(7rem, .34fr) minmax(0, 1fr);
      align-content: center;
      align-items: start;
      gap: clamp(8px, 1.2vmin, 14px);
      overflow: visible;
    }
    main[data-template="story-intro"] .course-block-summary {
      min-height: 0;
      padding-right: 0;
    }
    main[data-template="story-intro"] .course-block-body {
      padding-top: 0;
    }
    main[data-template="story-intro"] .course-block-body > p:not(.lesson-label) {
      display: block;
      overflow: visible;
      -webkit-line-clamp: unset;
    }
    main[data-template="story-intro"] .interaction-panel {
      max-height: none;
      overflow: visible;
    }
    main[data-template="story-intro"] .course-block-body > :last-child {
      margin-bottom: 0;
    }
    main[data-template="story-intro"] .course-content::before {
      content: "";
      position: absolute;
      z-index: 0;
      left: 8%;
      right: 8%;
      top: 50%;
      height: 2px;
      background: linear-gradient(90deg, var(--course-color-primary), var(--course-color-accent));
      opacity: .32;
      transform: rotate(6deg);
      transform-origin: center;
    }
    main[data-template="learning-timeline"] .lesson-card {
      transform: none;
    }
    main[data-template="learning-timeline"] .explore-item {
      min-height: 44px;
      display: grid;
      align-content: center;
      padding: .45rem .65rem;
    }
    main[data-template="learning-timeline"] .explore-item h3 {
      margin: 0;
    }
    main[data-template="learning-timeline"] .explore-item p {
      display: none;
      margin: .35em 0 0;
    }
    main[data-template="learning-timeline"] .explore-item:is(:hover, :focus, :focus-within) p {
      display: block;
    }
    main[data-template="knowledge-card-grid"] .lesson-card:nth-of-type(2) {
      transform: translateY(clamp(-32px, -4vh, -16px));
    }
    main[data-template="course-cover"] {
      padding: 0;
      grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    }
    main[data-template="course-cover"] .course-header,
    main[data-template="course-cover"] .course-stage {
      grid-area: 1 / 1;
    }
    main[data-template="course-cover"] .course-header {
      z-index: 3;
      align-self: center;
      width: min(50%, 42rem);
      margin: 0 0 4% clamp(18px, 6vw, 76px);
      padding: clamp(16px, 3vmin, 34px);
      grid-template-columns: 1fr;
      border: 1px solid color-mix(in srgb, var(--course-color-surface) 72%, transparent);
      border-radius: var(--course-radius-card);
      background: color-mix(in srgb, var(--course-color-surface) 78%, transparent);
      box-shadow: 0 32px 70px -34px color-mix(in srgb, var(--course-color-text) 65%, transparent);
      backdrop-filter: blur(20px) saturate(1.16);
    }
    main[data-template="course-cover"] .course-narration { grid-template-columns: 1fr; }
    main[data-template="course-cover"] .course-stage {
      display: grid;
      grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    }
    main[data-template="course-cover"] .course-content { display: none; }
    main[data-template="course-cover"] .course-action { display: contents; }
    main[data-template="course-cover"] .asset-panel {
      z-index: 0;
      grid-area: 1 / 1;
      border: 0;
      border-radius: 0;
    }
    main[data-template="course-cover"] .course-action .interaction-panel {
      z-index: 4;
      grid-area: 1 / 1;
      align-self: end;
      justify-self: start;
      width: auto;
      margin: 0 0 clamp(18px, 5vh, 56px) clamp(18px, 6vw, 76px);
      padding: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
      backdrop-filter: none;
    }
    main[data-template="course-cover"] .interaction-panel button {
      padding-inline: 1.5rem;
      color: var(--course-color-surface);
      background: var(--course-color-primary);
    }
    main[data-template="interactive-quiz"] .course-stage,
    main[data-template="achievement-task"] .course-stage {
      grid-template-columns: minmax(12rem, .72fr) minmax(0, 1.28fr);
      grid-template-rows: minmax(0, 1fr);
    }
    main[data-template="interactive-quiz"] .course-content,
    main[data-template="achievement-task"] .course-content {
      z-index: 2;
      grid-area: 1 / 1;
      align-content: end;
      padding: clamp(8px, 1.4vmin, 16px);
    }
    main[data-template="interactive-quiz"] .course-content .lesson-card,
    main[data-template="achievement-task"] .course-content .lesson-card {
      align-self: end;
      height: auto;
      background: color-mix(in srgb, var(--course-color-surface) 88%, transparent);
      backdrop-filter: blur(14px);
    }
    main[data-template="interactive-quiz"] .course-action,
    main[data-template="achievement-task"] .course-action {
      display: contents;
    }
    main[data-template="interactive-quiz"] .course-action .asset-panel,
    main[data-template="achievement-task"] .course-action .asset-panel {
      grid-area: 1 / 1;
    }
    main[data-template="interactive-quiz"] .course-action .asset-panel:has(.asset-panel--background),
    main[data-template="achievement-task"] .course-action .asset-panel:has(.asset-panel--background) {
      grid-area: 1 / 1 / 2 / 3;
    }
    main[data-template="interactive-quiz"] .course-action .interaction-panel,
    main[data-template="achievement-task"] .course-action .interaction-panel {
      grid-area: 1 / 2;
      align-self: stretch;
      max-height: none;
      margin: 0;
      display: grid;
      align-content: center;
      background: color-mix(in srgb, var(--course-color-surface) 95%, transparent);
    }
    main[data-template="recap-summary"] .interaction-panel {
      justify-self: center;
      width: calc(100% - 1.3rem);
    }
    main[data-density="dense"] { font-size: clamp(11px, 1.3vmin, 15px); }
    main[data-density="dense"] .lesson-card,
    main[data-density="dense"] .interaction-panel { padding: clamp(8px, 1.1vmin, 14px); }
    @media (max-height: 560px) {
      main { padding: 10px; gap: 9px; }
      .course-header { padding: 0 2px 8px; }
      .course-stage { grid-template-columns: minmax(0, 1.45fr) minmax(12rem, .9fr); gap: 9px; }
      .course-stage:has(.asset-panel--background) { grid-template-columns: minmax(0, 1.45fr) minmax(12rem, .9fr); }
      .lesson-card { padding: 9px 11px; }
      .lesson-card::after { top: .45rem; right: .55rem; width: 1.65rem; }
      .course-block-body { padding-top: .3rem; }
      .interaction-panel { margin: .45rem; padding: 9px 11px; max-height: calc(100% - .9rem); }
      .course-narration { display: none; }
      main[data-template="story-intro"] .course-narration {
        display: grid;
        font-size: .82em;
        line-height: 1.35;
      }
      main[data-template="story-intro"] .interaction-panel { max-height: none; }
    }
    @media (max-width: 760px) and (min-height: 561px) {
      .course-header { grid-template-columns: minmax(0, .9fr) minmax(12rem, 1.1fr); }
      .course-stage { grid-template-columns: minmax(0, 1.25fr) minmax(13rem, .9fr); gap: 9px; }
    }
    @media (max-width: 760px) {
      main:not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .course-content {
        grid-template-columns: minmax(0, 1fr) !important;
        grid-auto-rows: minmax(0, 1fr);
        align-content: stretch;
      }
      main:not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .lesson-card {
        grid-template-columns: minmax(7rem, .34fr) minmax(0, 1fr);
        align-content: center;
        align-items: start;
        gap: 6px;
        padding: 7px 9px;
        font-size: .86em;
        line-height: 1.35;
      }
      main:not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .course-block-summary {
        min-height: 0;
        padding-right: 0;
      }
      main:not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .course-block-body {
        padding-top: 0;
      }
      .interaction-panel { max-height: none; }
      .interaction-items { gap: .35rem; }
      .explore-item,
      details,
      .sort-item,
      fieldset { padding: .5rem .6rem; }
      main[data-template="interactive-quiz"] fieldset {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 4px 6px;
      }
      main[data-template="interactive-quiz"] fieldset > :not(.option) {
        grid-column: 1 / -1;
      }
      main[data-template="interactive-quiz"] .option {
        min-height: 44px;
        padding: 3px 5px;
      }
    }
    @media (max-width: 560px) {
      main { padding: 9px; gap: 8px; }
      .course-header {
        grid-template-columns: minmax(0, .88fr) minmax(0, 1.12fr);
        gap: 7px;
        padding: 0 2px 7px;
      }
      .course-stage { grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); gap: 7px; }
      .course-stage:has(.asset-panel--background) { grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr); }
      .course-content {
        grid-template-columns: 1fr !important;
        align-content: center;
        gap: 6px;
      }
      .lesson-card { padding: 7px 8px; }
      .lesson-card::after { display: none; }
      main[data-block-count="3"] .lesson-card {
        min-height: 0;
        transform: none !important;
      }
      .course-block-summary { min-height: 25px; padding-right: 0; }
      .course-block-body { padding-top: .35rem; }
      .course-action { align-content: stretch; }
      .interaction-panel { margin: 5px; padding: 8px; max-height: calc(100% - 10px); }
      .interaction-items { gap: .32rem; }
      .course-native-visual { display: none; }
      .course-narration { display: none; }
      main[data-template="story-intro"] .course-narration {
        display: grid;
        font-size: .78em;
        line-height: 1.3;
      }
      main[data-template="story-intro"] .course-narration p {
        padding-left: .45rem;
      }
      main[data-template="course-cover"] .course-header {
        width: calc(100% - 30px);
        margin: 0 15px 14%;
        padding: 15px;
      }
      main[data-template="course-cover"] .course-action .interaction-panel {
        margin: 0 0 18px 15px;
      }
      main[data-template="interactive-quiz"] .course-stage,
      main[data-template="achievement-task"] .course-stage {
        grid-template-columns: minmax(7.5rem, .75fr) minmax(0, 1.25fr);
      }
      main:not([data-template="course-cover"]):not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .course-stage:has(.asset-panel--background) {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1fr) auto;
      }
      main:not([data-template="course-cover"]):not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .course-stage:has(.asset-panel--background) .course-content {
        grid-area: 1 / 1;
        padding: 3px;
      }
      main:not([data-template="course-cover"]):not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .course-stage:has(.asset-panel--background) .asset-panel {
        grid-area: 1 / 1 / 3 / 2;
      }
      main:not([data-template="course-cover"]):not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .course-stage:has(.asset-panel--background) .interaction-panel {
        grid-area: 2 / 1;
        align-self: end;
        margin: 3px;
        padding: 6px 7px;
        font-size: .76em;
        line-height: 1.25;
      }
      main:not([data-template="course-cover"]):not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .interaction-panel .interaction-items {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 3px;
      }
      main:not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .lesson-card {
        grid-template-columns: minmax(6rem, .32fr) minmax(0, 1fr);
        gap: 3px;
        padding: 4px 6px;
        font-size: .72em;
        line-height: 1.2;
      }
      main:not([data-template="story-intro"]):not([data-template="interactive-quiz"]):not([data-template="achievement-task"]) .lesson-label {
        display: none;
      }
      main[data-template="interactive-quiz"] .course-action .interaction-panel {
        padding: 6px;
        font-size: .78em;
        line-height: 1.25;
      }
      main[data-template="interactive-quiz"] .interaction-items { gap: 3px; }
      main[data-template="interactive-quiz"] fieldset { padding: 4px; }
      main[data-template="interactive-quiz"] fieldset > p { margin-bottom: 2px; }
      main[data-template="interactive-quiz"] .option { padding: 2px 3px; }
      main[data-template="interactive-quiz"] .interaction-panel button {
        min-height: 44px;
        padding: 4px 6px;
      }
      main[data-template="story-intro"] .course-stage:has(.asset-panel--background) {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: minmax(0, 1.18fr) minmax(0, .82fr);
      }
      main[data-template="story-intro"] .course-stage:has(.asset-panel--background) .course-content {
        grid-area: 1 / 1;
        grid-template-columns: minmax(0, 1fr) !important;
        grid-template-rows: repeat(3, minmax(0, 1fr));
        padding: 4px;
      }
      main[data-template="story-intro"] .lesson-card {
        grid-template-columns: minmax(5.8rem, .32fr) minmax(0, 1fr);
        gap: 3px;
        padding: 3px 5px;
        font-size: .72em;
        line-height: 1.18;
      }
      main[data-template="story-intro"] .course-stage:has(.asset-panel--background) .asset-panel {
        grid-area: 1 / 1 / 3 / 2;
      }
      main[data-template="story-intro"] .course-stage:has(.asset-panel--background) .interaction-panel {
        grid-area: 2 / 1;
        align-self: stretch;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
        gap: 4px;
        margin: 4px;
        padding: 6px 8px;
        font-size: .78em;
        line-height: 1.25;
      }
      main[data-template="story-intro"] .interaction-panel fieldset {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 3px;
        padding: 4px;
      }
      main[data-template="story-intro"] .interaction-panel fieldset > p {
        grid-column: 1 / -1;
        margin-bottom: 2px;
      }
      main[data-template="story-intro"] .interaction-panel .option {
        min-height: 44px;
        padding: 3px 4px;
      }
      main[data-template="story-intro"] .interaction-panel button {
        padding: 5px 7px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
    }
  </style>
</head>
<body>
  <main data-page-id="${escapeHtmlAttribute(content.pageId)}" data-density="${density}" data-template="${escapeHtmlAttribute(content.functionalTemplateId)}" data-scene="${escapeHtmlAttribute(sceneKind ?? "explain")}" data-block-count="${content.blocks.length}" data-has-assets="${content.assetSlots.length > 0 ? "true" : "false"}">
    <header class="course-header">
      <div>
        <p class="course-kicker">${escapeHtmlText(templateLabel)}</p>
        <h1>${escapeHtmlText(content.title)}</h1>
      </div>
      ${renderNarration(content)}
    </header>
    <div class="course-stage">
      <section class="course-content">
        ${visualPrimitive}
        ${blocks}
      </section>
      <aside class="course-action">
        ${assetMarkup}
        ${interaction}
      </aside>
    </div>
  </main>
</body>
</html>`;
}

function renderNarration(content: PageContentDSL) {
  if (content.narration.length === 0) return '<div class="course-narration"></div>';
  return `<div class="course-narration">${content.narration
    .map((paragraph) => `<p>${escapeHtmlText(paragraph)}</p>`)
    .join("")}</div>`;
}

function renderBlock(
  block: PageContentDSL["blocks"][number],
  content: PageContentDSL,
) {
  const runtimeTarget =
    content.version === 2
      ? ` data-runtime-target-id="${escapeHtmlAttribute(block.id)}"`
      : "";
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

  const blockIndex = content.blocks.findIndex(({ id }) => id === block.id) + 1;

  return `<article class="lesson-card" data-block-index="${String(blockIndex).padStart(2, "0")}" data-block-id="${escapeHtmlAttribute(block.id)}"${runtimeTarget}>
    <div class="course-block-summary"><h2>${escapeHtmlText(block.heading)}</h2></div>
    <div class="course-block-body">
      ${label}
      <p>${escapeHtmlText(block.body)}</p>
      ${points}
    </div>
  </article>`;
}

function renderInteraction(content: PageContentDSL, mergeChoiceBlocks: boolean) {
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
          [...new Set(interaction.questions.map(({ feedback }) => feedback.success))].join(
            " ",
          ),
        )}</p>
        <p class="feedback" data-feedback-kind="retry" hidden>${escapeHtmlText(
          [...new Set(interaction.questions.map(({ feedback }) => feedback.retry))].join(
            " ",
          ),
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
    ? ` data-block-id="${escapeHtmlAttribute(block.id)}"${
        content.version === 2
          ? ` data-runtime-target-id="${escapeHtmlAttribute(block.id)}"`
          : ""
      }`
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
  const prompt = isChoicePromptRepresentedByBlock(question.prompt, block, index)
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

function renderAssets(
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

function renderVisualPrimitive(content: PageContentDSL) {
  const primitive =
    content.version === 2 ? content.runtime?.visualPrimitive : undefined;
  if (!primitive || primitive === "none") return "";

  return `<div class="course-native-visual" data-visual-primitive="${escapeHtmlAttribute(primitive)}" aria-hidden="true"></div>`;
}

function canMergeChoiceBlocks(content: PageContentDSL) {
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

function isTextRepresentedByBlock(text: string, content: PageContentDSL) {
  const normalized = normalizeText(text);
  return content.blocks.some((block) =>
    [block.heading, block.body, ...block.supportingPoints].some(
      (candidate) => normalizeText(candidate) === normalized,
    ),
  );
}

function resolveDensity(content: PageContentDSL) {
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
  return content.blocks.length > 4 || textLength > 1_400 ? "dense" : "balanced";
}

function resolveTemplateLabel(templateId: PageContentDSL["functionalTemplateId"]) {
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

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
