import type { PageContentDSL } from "@/shared/course-schema";

import type { HtmlEngineerInput } from "./html-engineer-model-step";
import {
  collectRequiredStaticContentText,
  isRevealItemRepresentedByBlock,
} from "./html-engineer-content-text";
import {
  escapeHtmlAttribute,
  findReadyCssAssetConsumer,
  findTagMatchesWithAttributes,
  findUniqueDescendantImage,
  getAttributeValues,
  getElementHtml,
  hasAccessibleBackgroundContract,
  hasAttributeValue,
  hasDataAttribute,
  isOpeningTagInsideElement,
  setBackgroundAccessibility,
  type OpeningTagMatch,
} from "./html-engineer-dom-assets";
import {
  containsTrustedText,
  normalizeText,
  normalizeVisibleText,
} from "./html-engineer-text";

const TRUSTED_PLAYER_LAYOUT_GUARD = `<style data-keya-layout-guard="current">
html,body{width:100%!important;height:100%!important;margin:0!important;padding:0!important;overflow:visible!important;box-sizing:border-box}
main[data-page-id]{position:relative;width:100%!important;height:100%!important;min-width:0;min-height:0;margin:0 auto!important;overflow:visible!important;box-sizing:border-box}
main[data-page-id]>*{min-width:0;box-sizing:border-box}
[data-asset-slot-id],[data-asset-slot-id] img{max-width:100%;box-sizing:border-box}
@media (max-height:700px){
  main[data-page-id]{padding:clamp(.5rem,1.6vh,.875rem)!important;gap:clamp(.5rem,2vh,1rem)!important}
  main[data-page-id] h1{font-size:clamp(1.5rem,5vh,2.25rem)!important;line-height:1.08!important}
  main[data-page-id] h2,main[data-page-id] h3{font-size:clamp(1.0625rem,3.5vh,1.625rem)!important;line-height:1.15!important}
  main[data-page-id] p,main[data-page-id] li,main[data-page-id] label,main[data-page-id] summary{font-size:clamp(.875rem,2.5vh,1.0625rem)!important;line-height:1.35!important}
  main[data-page-id]>:not([data-block-id]):not([data-asset-slot-id]){margin-block:0!important}
  main[data-page-id] [data-block-id]{grid-column:auto!important;grid-row:auto!important;min-height:0;margin:0!important;padding:clamp(.5rem,1.5vh,.875rem)!important;font-size:clamp(.875rem,2.5vh,1.0625rem)!important;line-height:1.35!important}
  main[data-page-id] [data-block-id]:has(>details){padding:0!important}
  main[data-page-id] [data-block-id]>details:not([open]){min-height:44px!important;padding:0!important}
  main[data-page-id] [data-block-id]>*{margin-block:.25rem!important}
  main[data-page-id] *:has(>[data-block-id]){width:100%!important;min-height:0!important;max-height:none!important;overflow:visible!important;margin-block:clamp(.375rem,1vh,.625rem)!important}
  main[data-page-id] [data-interaction-type]{margin:0!important;padding:clamp(.5rem,1.5vh,.875rem)!important}
  main[data-page-id] [data-interaction-type]>p{margin-block:.25rem!important}
  main[data-page-id] [data-interaction-type="navigate"],main[data-page-id] [data-interaction-type="navigate"] button,main[data-page-id] button[data-interaction-type="navigate"]{min-width:44px!important;min-height:44px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important}
  main[data-page-id] *:has(>[data-interaction-item-id]){display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(7rem,45%),1fr))!important;gap:clamp(.375rem,1vh,.625rem)!important}
  main[data-page-id] *:has(>[data-interaction-item-id])>:not([data-interaction-item-id]){grid-column:1/-1}
  main[data-page-id] [data-interaction-item-id]{width:auto!important;min-width:0!important;max-width:100%!important;min-height:44px;margin:0!important;padding:clamp(.375rem,1vh,.625rem)!important}
  main[data-page-id] [data-interaction-item-id]>summary{width:100%!important;min-height:44px!important;padding:.375rem!important;justify-content:center!important;text-align:center!important}
  main[data-page-id] details>summary{display:flex!important;align-items:center!important;min-height:44px!important;padding:.375rem!important;cursor:pointer!important}
  main[data-page-id] details:not([open])>summary{margin:0!important}
  main[data-page-id]>details[data-block-id]:not([open]){min-height:44px!important;padding:0!important}
  main[data-page-id] details:not([open])>:not(summary){display:none!important}
  main[data-page-id] details[open]>:not(summary){display:block!important;margin-top:.25rem!important;padding:.5rem!important;font-size:.8125rem!important;line-height:1.3!important}
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"]){display:grid!important;grid-template-columns:minmax(7rem,.75fr) minmax(0,1.25fr)!important;grid-template-rows:auto auto minmax(0,1fr)!important;align-items:start!important;gap:.375rem .5rem!important;width:100%!important;max-width:none!important;margin:0!important;padding:0!important}
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])>h1,
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])>.narration{grid-column:1/-1!important;margin:0!important}
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])>*:has(>[data-block-id]){grid-column:1!important;margin:0!important;align-self:start!important}
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])>[data-interaction-type="sort"]{grid-column:2!important;margin:0!important;align-self:start!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"]){display:grid!important;grid-template-columns:minmax(7rem,.75fr) minmax(0,1.25fr)!important;grid-template-rows:auto auto repeat(6,minmax(44px,auto))!important;align-items:start!important;gap:.25rem .5rem!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>h1,
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>.narration{grid-column:1/-1!important;margin:0!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-block-id]{grid-column:1!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-block-id]:nth-of-type(1){grid-row:3!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-block-id]:nth-of-type(2){grid-row:4!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-block-id]:nth-of-type(3){grid-row:5!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-block-id]:nth-of-type(4){grid-row:6!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-block-id]:nth-of-type(5){grid-row:7!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-block-id]:nth-of-type(6){grid-row:8!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-interaction-type="sort"]{grid-column:2!important;grid-row:3/9!important;margin:0!important;align-self:start!important}
  main[data-page-id] [data-interaction-type="sort"]{display:grid!important;align-content:start!important;gap:.25rem!important}
  main[data-page-id] [data-interaction-type="sort"]>*{margin-block:0!important}
  main[data-page-id] [data-interaction-type="sort"],main[data-page-id] [data-interaction-type="sort"] *{min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}
  main[data-page-id] [data-interaction-type="sort"]>*:has(>*>[data-interaction-item-id]){display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:.375rem!important}
  main[data-page-id] [data-interaction-type="sort"]>*:has(>[data-interaction-item-id]){margin:0!important}
  main[data-page-id] [data-interaction-type="sort"] *:has(>[data-interaction-item-id]){display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;align-content:start!important;gap:.25rem!important;padding:.375rem!important}
  main[data-page-id] [data-interaction-type="sort"] *:has(>[data-interaction-item-id])>:not([data-interaction-item-id]){grid-column:1/-1!important;margin:0!important}
  main[data-page-id] [data-interaction-type="sort"] button[data-runtime-submit="true"]{min-height:44px!important;margin:0!important;padding:.375rem .75rem!important}
  main[data-page-id] *:has(>[data-block-id]):has(>[data-interaction-type="choice"]){display:grid!important;grid-template-columns:minmax(10rem,.65fr) minmax(0,1.35fr)!important;grid-template-rows:minmax(0,1fr)!important;align-items:start!important;gap:.5rem!important}
  main[data-page-id] *:has(>[data-block-id]):has(>[data-interaction-type="choice"])>:not([data-block-id]):not([data-interaction-type="choice"]){display:none!important}
  main[data-page-id] *:has(>[data-block-id]):has(>[data-interaction-type="choice"])>[data-block-id]{grid-column:1!important}
  main[data-page-id] *:has(>[data-block-id]):has(>[data-interaction-type="choice"])>[data-interaction-type="choice"]{grid-column:2!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="choice"]){display:grid!important;grid-template-columns:minmax(10rem,.65fr) minmax(0,1.35fr)!important;grid-template-rows:auto minmax(0,1fr)!important;align-items:start!important;gap:.5rem!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="choice"])>h1{grid-column:1/-1!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="choice"])>:not(h1):not([data-block-id]):not([data-interaction-type="choice"]):not([data-asset-slot-id]){display:none!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="choice"])>[data-block-id]{grid-column:1!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="choice"])>[data-interaction-type="choice"]{grid-column:2!important}
  main[data-page-id] [data-interaction-type="choice"]{display:grid!important;align-content:start!important;gap:.375rem!important;font-size:.8125rem!important;line-height:1.25!important}
  main[data-page-id] [data-interaction-type="choice"] [data-question-id]{display:grid!important;gap:.25rem!important;margin:0!important;padding:0!important}
  main[data-page-id] [data-interaction-type="choice"] label{min-height:44px!important;margin:0!important;padding:.25rem .5rem!important;font-size:.75rem!important;line-height:1.2!important}
  main[data-page-id] [data-interaction-type="choice"] button[data-runtime-submit="true"]{min-height:44px!important;margin:0!important;padding:.375rem .75rem!important}
  main[data-page-id] [data-visual-primitive]:has([data-block-id]):has([data-interaction-type]){display:flex!important;flex-direction:column!important;gap:clamp(.375rem,1vh,.625rem)!important}
  main[data-page-id] [data-visual-primitive] *:has(>[data-block-id]){display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:clamp(.375rem,1vh,.625rem)!important}
  main[data-page-id] [data-visual-primitive] [data-interaction-type]{width:100%!important}
  main[data-page-id] [data-visual-primitive="timeline"]:has(>.timeline-dot){display:flex!important;flex-direction:column!important;justify-content:space-between!important;max-height:calc(100% - 3rem)!important}
  main[data-page-id] [data-visual-primitive="timeline"]>.timeline-dot{position:relative!important;top:auto!important;flex:0 0 auto}
  main[data-page-id] [data-asset-slot-id]{min-height:0!important;max-height:min(30vh,12rem)!important}
  main[data-page-id] [data-keya-asset-type="icon"]{position:absolute!important;right:.75rem!important;top:.75rem!important;z-index:0!important;width:min(15vw,4.5rem)!important;height:min(15vw,4.5rem)!important;max-width:4.5rem!important;max-height:4.5rem!important;margin:0!important;opacity:.72!important;pointer-events:none!important}
  main[data-page-id] [data-keya-asset-type="icon"] img{width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important}
  main[data-page-id] [data-keya-asset-role="hero"]:not([data-keya-asset-type="icon"]){min-width:min(32vw,20rem)!important;max-width:min(100%,22rem)!important}
  main[data-page-id] img[data-asset-slot-id],main[data-page-id] [data-asset-slot-id]>img{width:auto!important;height:auto!important;max-height:min(30vh,12rem)!important;object-fit:contain!important}
  main[data-page-id] img[data-asset-slot-id][alt=""],main[data-page-id] [data-asset-slot-id][aria-hidden="true"]{position:absolute!important;right:clamp(.5rem,2vw,1.25rem);bottom:clamp(.5rem,2vh,1rem);width:min(18vw,6rem)!important;height:auto!important;margin:0!important;pointer-events:none}
  main[data-page-id]>[data-asset-slot-id][role="img"]{position:absolute!important;inset:0 0 auto 0!important;z-index:0!important;width:100%!important;height:22%!important;min-height:4rem!important;margin:0!important;opacity:.55!important;background-position:right center!important;background-size:contain!important;background-repeat:no-repeat!important}
  main[data-page-id]>[data-asset-slot-id][data-keya-asset-role="hero"][role="img"]{width:100%!important;height:32%!important;max-width:100%!important;max-height:none!important;background-size:contain!important}
  main[data-page-id]>:not([data-asset-slot-id]):not([data-visual-primitive]){position:relative;z-index:1}
}
@media (max-width:480px){
  main[data-page-id]{padding:.5rem!important;gap:clamp(.375rem,1.6vh,.75rem)!important}
  main[data-page-id] h1{font-size:clamp(1.375rem,7vw,1.75rem)!important}
  main[data-page-id]>p{font-size:.75rem!important;line-height:1.15!important;margin-block:.125rem!important}
  main[data-page-id] [data-block-id]{padding:.25rem!important;font-size:.75rem!important;line-height:1.15!important}
  main[data-page-id] [data-block-id] h2,main[data-page-id] [data-block-id] h3{font-size:.75rem!important;line-height:1.05!important}
  main[data-page-id] [data-block-id] p{font-size:.75rem!important;line-height:1.15!important}
  main[data-page-id] [data-block-id] ul,main[data-page-id] [data-block-id] ol{padding-inline-start:.5rem!important}
  main[data-page-id] [data-block-id] li{font-size:.6875rem!important;line-height:1.1!important}
  main[data-page-id] *:has(>[data-block-id]){margin-block:0!important;gap:.25rem!important}
  main[data-page-id] *:has(>[data-interaction-item-id]){grid-template-columns:repeat(auto-fit,minmax(min(4.5rem,22%),1fr))!important}
  main[data-page-id] [data-interaction-type]{padding:.375rem!important}
  main[data-page-id] [data-interaction-item-id]{padding:0!important}
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"]),
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"]){display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto!important}
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])>*:has(>[data-block-id]),
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-block-id]{display:none!important}
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])>h1,
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])>.narration,
  main[data-page-id] *:has(>*>[data-block-id]):has(>[data-interaction-type="sort"])>[data-interaction-type="sort"],
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>h1,
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>.narration,
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="sort"])>[data-interaction-type="sort"]{grid-column:1!important;grid-row:auto!important}
  main[data-page-id] [data-interaction-type="sort"]{width:100%!important;padding:.25rem!important;gap:.25rem!important}
  main[data-page-id] [data-interaction-type="sort"]>p{font-size:.6875rem!important;line-height:1.1!important;margin:0!important}
  main[data-page-id] [data-interaction-type="sort"]>*:has(>*>[data-interaction-item-id]){grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:.25rem!important}
  main[data-page-id] [data-interaction-type="sort"] *:has(>[data-interaction-item-id]){grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:.125rem!important;padding:.25rem!important}
  main[data-page-id] [data-interaction-type="sort"] [data-interaction-item-id]{min-height:44px!important;padding:.1875rem!important;font-size:.625rem!important;line-height:1.08!important}
  main[data-page-id] [data-interaction-type="sort"] [data-interaction-item-id] strong,
  main[data-page-id] [data-interaction-type="sort"] [data-interaction-item-id] p{font-size:.625rem!important;line-height:1.08!important;margin:.0625rem 0!important}
  main[data-page-id] [data-interaction-type="sort"] button[data-runtime-submit="true"]{width:100%!important;min-height:44px!important;padding:.25rem .5rem!important}
  main[data-page-id] *:has(>[data-block-id]):has(>[data-interaction-type="choice"]){grid-template-columns:minmax(0,1fr)!important}
  main[data-page-id] *:has(>[data-block-id]):has(>[data-interaction-type="choice"])>[data-block-id]{display:none!important}
  main[data-page-id] *:has(>[data-block-id]):has(>[data-interaction-type="choice"])>[data-interaction-type="choice"]{grid-column:1!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="choice"]){grid-template-columns:minmax(0,1fr)!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="choice"])>[data-block-id]{display:none!important}
  main[data-page-id]:has(>[data-block-id]):has(>[data-interaction-type="choice"])>[data-interaction-type="choice"]{grid-column:1!important}
  main[data-page-id] [data-interaction-type="choice"]{padding:.25rem!important;font-size:.75rem!important;gap:.25rem!important}
  main[data-page-id] [data-interaction-type="choice"] label{font-size:.6875rem!important;line-height:1.1!important;padding:.125rem .25rem!important}
  main[data-page-id] [data-asset-slot-id]{max-height:26vh!important}
  main[data-page-id] img[data-asset-slot-id],main[data-page-id] [data-asset-slot-id]>img{max-height:26vh!important}
}
@media (min-width:600px) and (max-height:520px){
  main[data-page-id]{padding:.5rem 1rem!important;gap:.5rem!important}
  main[data-page-id] h1{font-size:clamp(1.5rem,6vh,1.875rem)!important}
  main[data-page-id] [data-asset-slot-id]{max-height:30vh!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"]){display:grid!important;grid-template-columns:minmax(9rem,.6fr) minmax(0,1.4fr)!important;grid-template-rows:auto repeat(6,minmax(44px,1fr))!important;align-items:stretch!important;gap:.25rem .5rem!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>h1{grid-column:1/-1!important;grid-row:1!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>details[data-block-id]:not([data-interaction-type]){grid-column:1!important;min-height:0!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>details[data-block-id]:nth-of-type(1){grid-row:2!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>details[data-block-id]:nth-of-type(2){grid-row:3!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>details[data-block-id]:nth-of-type(3){grid-row:4!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>details[data-block-id]:nth-of-type(4){grid-row:5!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>details[data-block-id]:nth-of-type(5){grid-row:6!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>details[data-block-id]:nth-of-type(6){grid-row:7!important}
  main[data-page-id]:has(>details[data-block-id]):has(>[data-interaction-type="choice"])>[data-interaction-type="choice"]{grid-column:2!important;grid-row:2/8!important;height:100%!important;min-height:0!important;align-self:stretch!important}
}
</style>`;

/**
 * HTML 模型负责构图，但固定播放器还有一组不可协商的根画布与低高度边界。
 * 这里注入窄范围的可信 CSS 护栏，保留模型布局，只约束根尺寸、低高度间距、
 * 字号和素材上限，避免全宽 16:9 素材自然高度把主操作推出播放器。
 */
export function normalizeTrustedPlayerLayout(output: unknown) {
  if (
    typeof output !== "string" ||
    output.includes('data-keya-layout-guard="current"')
  ) {
    return output;
  }

  const headClose = output.match(/<\/head\s*>/i);
  if (headClose?.index === undefined) return output;
  return (
    output.slice(0, headClose.index) +
    TRUSTED_PLAYER_LAYOUT_GUARD +
    output.slice(headClose.index)
  );
}

/**
 * 模型偶尔会把同一个素材槽同时标在语义 wrapper 与其唯一的 img 上。仅当
 * main 内存在唯一、直接消费已批准 URI 的节点时，将技术槽位标记收敛到
 * 真实 consumer；若有多个 URI consumer 或标记跨出 main，则保持原样并由
 * 严格校验拒绝。
 */
export function normalizeUniqueReadyAssetSlotRoots(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;

  let html = output;
  for (const result of input.assets ?? []) {
    if (result.status !== "ready" || !result.asset?.uri) continue;
    const { assetSlotId } = result.request;
    const uri = result.asset.uri;
    let markers = findTagMatchesWithAttributes(html, {
      "data-asset-slot-id": assetSlotId,
    });
    let main = findTagMatchesWithAttributes(html, {
      "data-page-id": input.content.pageId,
    }).filter(({ tag }) => /^<main\b/i.test(tag));
    if (main.length !== 1) continue;
    if (markers.length > 1) {
      const directConsumers = markers.filter((marker) => {
        if (!isOpeningTagInsideElement(html, marker, main[0]!)) return false;
        const tagName = marker.tag
          .match(/^<\s*([a-z][\w:-]*)/i)?.[1]
          ?.toLowerCase();
        if (
          tagName === "img" &&
          hasAttributeValue(marker.tag, "src", uri)
        ) {
          return true;
        }
        return (
          findReadyCssAssetConsumer(html, marker, uri)?.index ===
          marker.index
        );
      });
      if (directConsumers.length !== 1) continue;
      const consumer = directConsumers[0]!;
      const allInsideMain = markers.every((marker) =>
        isOpeningTagInsideElement(html, marker, main[0]!),
      );
      if (!allInsideMain) continue;

      for (const marker of [...markers]
        .filter(({ index }) => index !== consumer.index)
        .sort((left, right) => right.index - left.index)) {
        html = replaceOpeningTag(
          html,
          marker,
          removeAttribute(marker.tag, "data-asset-slot-id"),
        );
      }
    }

    markers = findTagMatchesWithAttributes(html, {
      "data-asset-slot-id": assetSlotId,
    });
    main = findTagMatchesWithAttributes(html, {
      "data-page-id": input.content.pageId,
    }).filter(({ tag }) => /^<main\b/i.test(tag));
    if (
      markers.length !== 1 ||
      main.length !== 1 ||
      !isOpeningTagInsideElement(html, markers[0]!, main[0]!)
    ) {
      continue;
    }
    const slot = input.content.assetSlots.find(
      ({ id }) => id === assetSlotId,
    );
    if (!slot) continue;
    html = replaceOpeningTag(
      html,
      markers[0]!,
      setAttributeValue(
        setAttributeValue(
          markers[0]!.tag,
          "data-keya-asset-type",
          slot.type,
        ),
        "data-keya-asset-role",
        slot.role,
      ),
    );
  }

  return html;
}

/**
 * DSL 正文是服务端事实，模型只负责布局。对可由稳定 block/item 标记唯一
 * 定位的改写或遗漏，以可信 DSL 重建该节点内部正文，避免保留模型同义改写
 * 形成重复内容；无法唯一定位的结构仍交给严格校验。数学比较符同时按 HTML
 * 文本规则转义。
 */
export function normalizeTrustedDslMarkup(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;

  const cleaned = removeRedundantRestoredDslMarkup(output, input);
  let html = typeof cleaned === "string" ? cleaned : output;
  if (input.content.interaction.type !== "choice") {
    html = restoreTrustedBlockMarkup(html, input.content);
  }
  html = restoreTrustedInteractionItemMarkup(html, input.content);
  html = restoreTrustedInteractionPrompt(html, input.content);
  html = restoreTrustedNarration(html, input.content);

  const requiredText = collectRequiredStaticContentText(input.content);
  for (const text of requiredText) {
    if (/[&<>]/.test(text) && html.includes(text)) {
      html = html.replaceAll(text, escapeHtmlText(text));
    }
  }
  return html;
}

function restoreTrustedBlockMarkup(
  html: string,
  content: PageContentDSL,
) {
  let normalized = html;
  for (const block of content.blocks) {
    const markers = findTagMatchesWithAttributes(normalized, {
      "data-block-id": block.id,
    });
    if (markers.length !== 1) continue;
    const element = getElementHtml(normalized, markers[0]!);
    if (!element) continue;
    const visible = normalizeVisibleText(element);
    const required = [
      block.heading,
      block.body,
      ...block.supportingPoints,
    ];
    if (required.every((text) => containsTrustedText(visible, text))) {
      continue;
    }

    const label =
      block.label &&
      normalizeText(block.label) !== normalizeText(block.heading)
        ? `<span data-keya-trusted-block-label="true">${escapeHtmlText(block.label)}</span>`
        : "";
    const points =
      block.supportingPoints.length > 0
        ? `<ul>${block.supportingPoints
            .map((point) => `<li>${escapeHtmlText(point)}</li>`)
            .join("")}</ul>`
        : "";
    normalized = replaceElementInnerHtml(
      normalized,
      markers[0]!,
      `<div data-course-contract-restored="block">${label}<h2>${escapeHtmlText(block.heading)}</h2><p>${escapeHtmlText(block.body)}</p>${points}</div>`,
    );
  }
  return normalized;
}

function restoreTrustedInteractionItemMarkup(
  html: string,
  content: PageContentDSL,
) {
  if (
    content.interaction.type !== "reveal" &&
    content.interaction.type !== "explore" &&
    content.interaction.type !== "sort"
  ) {
    return html;
  }

  let normalized = html;
  for (const [index, item] of content.interaction.items.entries()) {
    if (
      content.interaction.type === "reveal" &&
      isRevealItemRepresentedByBlock(item, content.blocks[index])
    ) {
      continue;
    }
    const markers = findTagMatchesWithAttributes(normalized, {
      "data-interaction-item-id": item.id,
    });
    if (markers.length !== 1) continue;
    const marker = markers[0]!;
    const element = getElementHtml(normalized, marker);
    if (!element) continue;
    const visible = normalizeVisibleText(element);
    if (
      containsTrustedText(visible, item.label) &&
      containsTrustedText(visible, item.content)
    ) {
      continue;
    }

    const alignedBlock = content.blocks[index];
    const blockRoots = alignedBlock
      ? findTagMatchesWithAttributes(normalized, {
          "data-block-id": alignedBlock.id,
        })
      : [];
    const containsAlignedBlock =
      blockRoots.length === 1 &&
      (blockRoots[0]!.index === marker.index ||
        isOpeningTagInsideElement(normalized, blockRoots[0]!, marker));
    if (containsAlignedBlock) {
      normalized = insertBeforeElementClose(
        normalized,
        marker,
        `<div data-course-contract-restored="interaction-item"><strong>${escapeHtmlText(item.label)}</strong><p>${escapeHtmlText(item.content)}</p></div>`,
      );
      continue;
    }

    const inner = /^<details\b/i.test(marker.tag)
      ? `<summary>${escapeHtmlText(item.label)}</summary><div data-course-contract-restored="interaction-item">${escapeHtmlText(item.content)}</div>`
      : `<strong>${escapeHtmlText(item.label)}</strong><p data-course-contract-restored="interaction-item">${escapeHtmlText(item.content)}</p>`;
    normalized = replaceElementInnerHtml(normalized, marker, inner);
  }
  return normalized;
}

function restoreTrustedInteractionPrompt(
  html: string,
  content: PageContentDSL,
) {
  const interaction = content.interaction;
  if (
    interaction.type === "none" ||
    interaction.type === "navigate" ||
    interaction.type === "choice"
  ) {
    return html;
  }
  const root = findUniqueInteractionRoot(html, content);
  const rootHtml = root ? getElementHtml(html, root) : undefined;
  if (
    !root ||
    !rootHtml ||
    containsTrustedText(
      normalizeVisibleText(rootHtml),
      interaction.prompt,
    )
  ) {
    return html;
  }

  return insertAfterOpeningTag(
    html,
    root,
    `<p data-course-contract-restored="interaction-prompt">${escapeHtmlText(interaction.prompt)}</p>`,
  );
}

function restoreTrustedNarration(
  html: string,
  content: PageContentDSL,
) {
  const main = findTagMatchesWithAttributes(html, {
    "data-page-id": content.pageId,
  }).filter(({ tag }) => /^<main\b/i.test(tag));
  if (main.length !== 1) return html;
  const mainHtml = getElementHtml(html, main[0]!);
  if (!mainHtml) return html;
  const visible = normalizeVisibleText(mainHtml);
  const missing = content.narration.filter(
    (line) => !containsTrustedText(visible, line),
  );
  if (missing.length === 0) return html;

  return insertAfterOpeningTag(
    html,
    main[0]!,
    `<div data-course-contract-restored="narration">${missing
      .map((line) => `<p>${escapeHtmlText(line)}</p>`)
      .join("")}</div>`,
  );
}

/**
 * 页面标题来自封口 DSL，不属于模型可改写的文案。pageId 根唯一且已有唯一
 * h1 时规范化其正文；模型完全漏掉 h1 时在主内容根起始处补入可信标题。
 * 多个 h1 的歧义结构仍交给严格校验，不猜测哪一个是主标题。
 */
export function normalizeTrustedPageTitle(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content">,
) {
  if (typeof output !== "string") return output;

  const pageRoots = findTagMatchesWithAttributes(output, {
    "data-page-id": input.content.pageId,
  });
  if (pageRoots.length !== 1) return output;
  const pageHtml = getElementHtml(output, pageRoots[0]!);
  if (!pageHtml) return output;

  const headings = [...pageHtml.matchAll(/<h1\b([^>]*)>[\s\S]*?<\/h1\s*>/gi)];
  if (headings.length === 0) {
    const insertionIndex = pageRoots[0]!.index + pageRoots[0]!.tag.length;
    const trustedHeading = `<h1 data-keya-trusted-page-title="true">${escapeHtmlText(input.content.title)}</h1>`;
    return (
      output.slice(0, insertionIndex) +
      trustedHeading +
      output.slice(insertionIndex)
    );
  }
  if (headings.length !== 1) return output;
  const heading = headings[0]!;
  if (heading.index === undefined) return output;
  const openingTag = `<h1${heading[1] ?? ""}>`;
  const normalizedHeading = `${openingTag}${escapeHtmlText(input.content.title)}</h1>`;
  const index = pageRoots[0]!.index + heading.index;

  return (
    output.slice(0, index) +
    normalizedHeading +
    output.slice(index + heading[0].length)
  );
}

/**
 * 正文合同恢复可能把 Markdown 反引号与等价的 <code> 文本误判为缺失并在
 * block 内追加重复内容。仅当删除恢复节点后，该 block 仍完整包含可信 DSL
 * 正文时移除它；真实缺失内容继续保留。
 */
export function removeRedundantRestoredDslMarkup(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content">,
) {
  if (typeof output !== "string") return output;

  let html = output;
  for (const block of input.content.blocks) {
    const blockMarkers = findTagMatchesWithAttributes(html, {
      "data-block-id": block.id,
    });
    if (blockMarkers.length !== 1) continue;
    const blockMarker = blockMarkers[0]!;
    const blockHtml = getElementHtml(html, blockMarker);
    if (!blockHtml) continue;
    const restored = findTagMatchesWithAttributes(blockHtml, {
      "data-course-contract-restored": "block",
    });
    if (restored.length === 0) continue;

    let candidate = html;
    for (const marker of [...restored].sort(
      (left, right) => right.index - left.index,
    )) {
      candidate = removeElement(candidate, {
        ...marker,
        index: blockMarker.index + marker.index,
      });
    }
    const candidateBlock = findTagMatchesWithAttributes(candidate, {
      "data-block-id": block.id,
    });
    if (candidateBlock.length !== 1) continue;
    const candidateHtml = getElementHtml(candidate, candidateBlock[0]!);
    if (!candidateHtml) continue;
    const visible = normalizeVisibleText(candidateHtml);
    if (
      [block.heading, block.body, ...block.supportingPoints].every((text) =>
        containsTrustedText(visible, text),
      )
    ) {
      html = candidate;
    }
  }

  return html;
}

/**
 * reveal 页面若已有完整 details 结构，仍由严格 marker 规范化处理；若模型只
 * 生成了普通卡片，则在所有唯一、互不嵌套的 block 根节点外包原生 details，
 * 保留模型内容与样式，并提供无脚本可操作的确定性降级。
 */
export function normalizeRevealCardInteraction(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (
    typeof output !== "string" ||
    input.content.interaction.type !== "reveal" ||
    hasDataAttribute(output, "data-interaction-type", "reveal") ||
    /<details\b/i.test(output)
  ) {
    return output;
  }

  const blocks = input.content.blocks.map((block, index) => {
    const markers = findTagMatchesWithAttributes(output, {
      "data-block-id": block.id,
    });
    if (markers.length !== 1) return undefined;
    const marker = markers[0]!;
    const element = getElementHtml(output, marker);
    return element
      ? { block, element, index, start: marker.index, end: marker.index + element.length }
      : undefined;
  });
  if (blocks.some((block) => !block)) return output;

  const ranges = blocks
    .filter((block): block is NonNullable<typeof block> => Boolean(block))
    .sort((left, right) => left.start - right.start);
  if (ranges.some((block, index) => index > 0 && ranges[index - 1]!.end > block.start)) {
    return output;
  }

  let html = output;
  for (const { block, element, index, start } of [...ranges].reverse()) {
    const interactionMarker =
      index === 0 ? ' data-interaction-type="reveal"' : "";
    const summary = escapeHtmlText(block.label ?? block.heading);
    const details = `<details${interactionMarker}><summary>${summary}</summary>${element}</details>`;
    html = `${html.slice(0, start)}${details}${html.slice(start + element.length)}`;
  }
  return html;
}

function insertBeforeElementClose(
  html: string,
  marker: OpeningTagMatch,
  markup: string,
) {
  const element = getElementHtml(html, marker);
  const tagName = marker.tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1];
  if (!element || !tagName) return html;

  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const closing = new RegExp(`</${escapedTagName}\\s*>\\s*$`, "i").exec(element);
  if (!closing?.index) return html;

  const insertionIndex = marker.index + closing.index;
  return `${html.slice(0, insertionIndex)}${markup}${html.slice(insertionIndex)}`;
}

function replaceElementInnerHtml(
  html: string,
  marker: OpeningTagMatch,
  innerHtml: string,
) {
  const element = getElementHtml(html, marker);
  const tagName = marker.tag.match(/^<\s*([a-z][\w:-]*)/i)?.[1];
  if (!element || !tagName) return html;

  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const closing = new RegExp(`</${escapedTagName}\\s*>\\s*$`, "i").exec(
    element,
  );
  if (closing?.index === undefined) return html;
  const start = marker.index + marker.tag.length;
  const end = marker.index + closing.index;
  return `${html.slice(0, start)}${innerHtml}${html.slice(end)}`;
}

function removeElement(html: string, marker: OpeningTagMatch) {
  const element = getElementHtml(html, marker);
  if (!element) return html;
  return `${html.slice(0, marker.index)}${html.slice(marker.index + element.length)}`;
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * 模型遗漏 reveal 根标记时，只在完整 details/summary 结构存在唯一公共容器
 * 时补齐当前运行时要求的 type 与 id；不完整或静态伪互动仍交给严格校验拒绝。
 */
export function normalizeNativeInteractionMarker(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;
  const interaction = input.content.interaction;
  if (
    interaction.type !== "reveal" ||
    hasDataAttribute(output, "data-interaction-type", "reveal") ||
    interaction.items.length !== input.content.blocks.length
  ) {
    return output;
  }

  const details = [...output.matchAll(/<details\b[^>]*>[\s\S]*?<\/details\s*>/gi)];
  if (
    details.length !== interaction.items.length ||
    details.some((match, index) => {
      const block = input.content.blocks[index];
      const visibleText = normalizeVisibleText(match[0]);
      return (
        !block ||
        !/<summary\b[^>]*>[\s\S]*?<\/summary\s*>/i.test(match[0]) ||
        !containsTrustedText(visibleText, block.heading) ||
        !containsTrustedText(visibleText, block.body)
      );
    })
  ) {
    return output;
  }

  const detailMarkers = details.flatMap((match) => {
    const tag = match[0].match(/^<details\b[^>]*>/i)?.[0];
    return match.index === undefined || !tag
      ? []
      : [{ index: match.index, tag }];
  });
  const candidates = findTagMatchesWithAttributes(output, {})
    .filter(({ tag }) => /^<(?:main|section|article|div|form)\b/i.test(tag))
    .map((marker) => ({
      marker,
      element: getElementHtml(output, marker),
    }))
    .filter(
      (
        candidate,
      ): candidate is { marker: OpeningTagMatch; element: string } =>
        Boolean(candidate.element) &&
        detailMarkers.every((detail) =>
          isOpeningTagInsideElement(output, detail, candidate.marker),
        ),
    )
    .sort((left, right) => left.element.length - right.element.length);
  if (
    candidates.length === 0 ||
    (candidates[1] &&
      candidates[0]!.element.length === candidates[1].element.length)
  ) {
    return output;
  }

  const root = candidates[0]!.marker;
  return replaceOpeningTag(
    output,
    root,
    setAttributeValue(
      setAttributeValue(root.tag, "data-interaction-type", "reveal"),
      "data-interaction-id",
      `interaction-${input.content.pageId}`,
    ),
  );
}

/**
 * reveal 的 item id 只承担平台运行时定位职责。模型已经逐项生成完整原生
 * 控件、却漏掉 id 时，按 DSL 的 label 与 content 唯一定位最小控件根并补齐；
 * 任何文本不完整、候选重叠或一项多解都保持原样交给严格校验。
 */
export function normalizeRevealRuntimeMarkers(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (
    typeof output !== "string" ||
    input.content.interaction.type !== "reveal"
  ) {
    return output;
  }

  const root = findUniqueInteractionRoot(output, input.content);
  if (!root) return output;
  const interaction = input.content.interaction;
  const allTags = findTagMatchesWithAttributes(output, {});
  const resolved = interaction.items.map((item) => {
    const existing = findTagMatchesWithAttributes(output, {
      "data-interaction-item-id": item.id,
    }).filter((marker) => isOpeningTagInsideElement(output, marker, root));
    if (existing.length === 1) return existing[0];
    if (existing.length > 1) return undefined;

    const candidates = allTags
      .filter(
        (marker) =>
          marker.index !== root.index &&
          /^(?:<details|<section|<article|<div|<li|<button)\b/i.test(
            marker.tag,
          ) &&
          isOpeningTagInsideElement(output, marker, root) &&
          getAttributeValues(marker.tag, "data-interaction-item-id").length ===
            0,
      )
      .map((marker) => ({
        marker,
        element: getElementHtml(output, marker),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          marker: OpeningTagMatch;
          element: string;
        } => Boolean(candidate.element),
      )
      .filter(({ element }) => {
        const visible = normalizeVisibleText(element);
        return (
          containsTrustedText(visible, item.label) &&
          containsTrustedText(visible, item.content)
        );
      })
      .sort((left, right) => left.element.length - right.element.length);
    if (
      candidates.length === 0 ||
      (candidates[1] &&
        candidates[0]!.element.length === candidates[1].element.length)
    ) {
      return undefined;
    }
    return candidates[0]!.marker;
  });
  if (
    resolved.some((marker) => !marker) ||
    new Set(resolved.map((marker) => marker!.index)).size !== resolved.length
  ) {
    return output;
  }

  return resolved
    .map((marker, index) => ({
      marker: marker!,
      item: interaction.items[index]!,
    }))
    .filter(
      ({ marker, item }) =>
        !hasAttributeValue(
          marker.tag,
          "data-interaction-item-id",
          item.id,
        ),
    )
    .sort((left, right) => right.marker.index - left.marker.index)
    .reduce(
      (html, { marker, item }) =>
        replaceOpeningTag(
          html,
          marker,
          setAttributeValue(
            marker.tag,
            "data-interaction-item-id",
            item.id,
          ),
        ),
      output,
    );
}

/**
 * 豆包偶尔会把 choice 标记放到每道题上，或只漏掉互动区 id。只有当 DSL 的
 * 全部原生选项都能唯一定位，且存在唯一最小公共可提交容器时，才把该容器
 * 规范为唯一互动根；任何分叉或重复选项都会保留原样交给严格校验。
 */
export function normalizeChoiceInteractionRoot(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content"> &
    Partial<Omit<HtmlEngineerInput, "content">>,
) {
  if (
    typeof output !== "string" ||
    input.content.interaction.type !== "choice"
  ) {
    return output;
  }

  const html = output;
  const interaction = input.content.interaction;
  const expectedId = `interaction-${input.content.pageId}`;
  const main = findTagMatchesWithAttributes(html, {
    "data-page-id": input.content.pageId,
  }).filter(({ tag }) => /^<main\b/i.test(tag));
  if (main.length !== 1) return html;

  const optionIds = interaction.questions.flatMap(({ options }) =>
    options.map(({ id }) => id),
  );
  if (
    optionIds.length === 0 ||
    optionIds.some(
      (optionId) =>
        findTagMatchesWithAttributes(html, { value: optionId }).filter(
          ({ tag }) => /^<input\b/i.test(tag),
        ).length !== 1,
    )
  ) {
    return html;
  }

  const allTags = findTagMatchesWithAttributes(html, {});
  const choiceMarkers = allTags.filter(({ tag }) =>
    hasAttributeValue(tag, "data-interaction-type", "choice"),
  );
  const expectedIdMarkers = allTags.filter(({ tag }) =>
    hasAttributeValue(tag, "data-interaction-id", expectedId),
  );
  if (
    expectedIdMarkers.some(
      ({ tag }) =>
        getAttributeValues(tag, "data-interaction-type").some(
          (type) => type !== "choice",
        ),
    )
  ) {
    return html;
  }

  const relatedMarkers = [
    ...new Map(
      [...choiceMarkers, ...expectedIdMarkers].map((marker) => [
        marker.index,
        marker,
      ]),
    ).values(),
  ];
  const isWithin = (child: OpeningTagMatch, parent: OpeningTagMatch) =>
    child.index === parent.index ||
    isOpeningTagInsideElement(html, child, parent);
  const candidates = allTags
    .filter(
      (marker) =>
        /^(?:<main|<form|<section|<article|<div|<fieldset)\b/i.test(
          marker.tag,
        ) &&
        isWithin(marker, main[0]),
    )
    .map((marker) => ({
      marker,
      element: getElementHtml(html, marker),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        marker: OpeningTagMatch;
        element: string;
      } => Boolean(candidate.element),
    )
    .filter(
      ({ marker, element }) =>
        optionIds.every(
          (optionId) =>
            findTagMatchesWithAttributes(element, { value: optionId }).filter(
              ({ tag }) => /^<input\b/i.test(tag),
            ).length === 1,
        ) &&
        findTagMatchesWithAttributes(element, {}).some(
          ({ tag }) =>
            /^<button\b/i.test(tag) &&
            !/\sdisabled(?:\s|=|\/?>)/i.test(tag),
        ) &&
        relatedMarkers.every((related) => isWithin(related, marker)),
    );
  const smallestLength = Math.min(
    ...candidates.map(({ element }) => element.length),
  );
  const smallest = candidates.filter(
    ({ element }) => element.length === smallestLength,
  );
  if (smallest.length !== 1) return html;

  const root = smallest[0].marker;
  let normalized = html;
  for (const marker of [...relatedMarkers]
    .filter(({ index }) => index !== root.index)
    .sort((left, right) => right.index - left.index)) {
    normalized = replaceOpeningTag(
      normalized,
      marker,
      removeAttribute(
        removeAttribute(marker.tag, "data-interaction-type"),
        "data-interaction-id",
      ),
    );
  }

  return replaceOpeningTag(
    normalized,
    root,
    setAttributeValue(
      setAttributeValue(
        root.tag,
        "data-interaction-type",
        "choice",
      ),
      "data-interaction-id",
      expectedId,
    ),
  );
}

/**
 * choice 页面只对能够从已校验 DSL 与现有原生控件唯一证明的节点补运行时
 * 元数据。题目与选项从不创建；当全部题目控件已经完整时，缺失或重复的
 * 页面级提交按钮可按可信运行时合同机械收敛为一个。
 */
export function normalizeChoiceRuntimeMarkers(
  output: unknown,
  input: Pick<HtmlEngineerInput, "content"> &
    Partial<Omit<HtmlEngineerInput, "content">>,
) {
  if (
    typeof output !== "string" ||
    input.content.interaction.type !== "choice"
  ) {
    return output;
  }

  let html = output;
  const interaction = input.content.interaction;
  for (const question of interaction.questions) {
    let root = findUniqueInteractionRoot(html, input.content);
    if (!root) return html;
    const otherOptionIds = new Set(
      interaction.questions
        .filter(({ id }) => id !== question.id)
        .flatMap(({ options }) => options.map(({ id }) => id)),
    );
    const containsOnlyQuestionOptions = (element: string) =>
      question.options.every(({ id }) => hasInputValue(element, id)) &&
      [...otherOptionIds].every(
        (optionId) => !hasInputValue(element, optionId),
      );
    const isQuestionScope = (marker: OpeningTagMatch) =>
      isOpeningTagInsideElement(html, marker, root!) ||
      (interaction.questions.length === 1 &&
        marker.index === root!.index);
    const existing = findTagMatchesWithAttributes(html, {
      "data-question-id": question.id,
    }).filter(isQuestionScope);
    if (existing.length > 1) return html;
    if (existing.length === 1) {
      const existingElement = getElementHtml(html, existing[0]);
      if (existingElement && containsOnlyQuestionOptions(existingElement)) {
        continue;
      }
      html = replaceOpeningTag(
        html,
        existing[0],
        removeAttribute(existing[0].tag, "data-question-id"),
      );
      root = findUniqueInteractionRoot(html, input.content);
      if (!root) return html;
    }

    const candidates = findTagMatchesWithAttributes(html, {})
      .filter(
        (marker) =>
          /^(?:<fieldset|<section|<article|<div|<li)\b/i.test(
            marker.tag,
          ) &&
          (isOpeningTagInsideElement(html, marker, root) ||
            (interaction.questions.length === 1 &&
              marker.index === root.index)),
      )
      .map((marker) => ({
        marker,
        element: getElementHtml(html, marker),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          marker: OpeningTagMatch;
          element: string;
        } => Boolean(candidate.element),
      )
      .filter(({ element }) => containsOnlyQuestionOptions(element));
    const smallestLength = Math.min(
      ...candidates.map(({ element }) => element.length),
    );
    const smallest = candidates.filter(
      ({ element }) => element.length === smallestLength,
    );
    if (smallest.length !== 1) return html;

    html = replaceOpeningTag(
      html,
      smallest[0].marker,
      setAttributeValue(
        smallest[0].marker.tag,
        "data-question-id",
        question.id,
      ),
    );
    if (!containsTrustedText(normalizeVisibleText(html), question.prompt)) {
      const normalizedRoot = findUniqueInteractionRoot(
        html,
        input.content,
      );
      if (!normalizedRoot) return html;
      const questionRoot = findTagMatchesWithAttributes(html, {
        "data-question-id": question.id,
      }).find(
        (marker) =>
          isOpeningTagInsideElement(html, marker, normalizedRoot) ||
          (interaction.questions.length === 1 &&
            marker.index === normalizedRoot.index),
      );
      if (!questionRoot) return html;
      html = insertAfterOpeningTag(
        html,
        questionRoot,
        `<p data-runtime-question-prompt="${escapeHtmlAttribute(question.id)}">${escapeHtmlText(question.prompt)}</p>`,
      );
    }
  }

  let root = findUniqueInteractionRoot(html, input.content);
  if (!root) return html;
  let rootHtml = getElementHtml(html, root);
  if (!rootHtml) return html;
  const submitMarkers = findTagMatchesWithAttributes(rootHtml, {
    "data-runtime-submit": "true",
  });
  if (submitMarkers.length !== 1) {
    const interactionRoot = root;
    const buttons = findTagMatchesWithAttributes(html, {})
      .filter(
        (marker) =>
          /^<button\b/i.test(marker.tag) &&
          !/\sdisabled(?:\s|=|\/?>)/i.test(marker.tag) &&
          isOpeningTagInsideElement(html, marker, interactionRoot),
      )
      .map((marker) => ({
        marker,
        element: getElementHtml(html, marker),
      }))
      .filter(
        (
          candidate,
        ): candidate is {
          marker: OpeningTagMatch;
          element: string;
        } => Boolean(candidate.element),
      );
    const completeQuestions = hasCompleteChoiceQuestionStructure(
      rootHtml,
      interaction,
    );
    const submitCandidates = buttons.filter(({ marker, element }) =>
      /(?:提交|确认|检查|验证|完成|作答|答案|submit|check|confirm|answer)/i.test(
        [
          normalizeVisibleText(element),
          ...["aria-label", "id", "class", "name", "value", "title"].flatMap(
            (attribute) => getAttributeValues(marker.tag, attribute),
          ),
        ].join(" "),
      ),
    );

    if (completeQuestions) {
      const removableButtons = buttons.filter(
        ({ marker }) =>
          hasAttributeValue(marker.tag, "data-runtime-submit", "true") ||
          submitCandidates.some(
            ({ marker: candidate }) => candidate.index === marker.index,
          ),
      );
      for (const candidate of [...removableButtons].reverse()) {
        html = removeElement(html, candidate.marker);
      }
      root = findUniqueInteractionRoot(html, input.content);
      if (!root) return html;
      html = insertBeforeElementClose(
        html,
        root,
        '<button type="button" data-runtime-submit="true">提交答案</button>',
      );
    } else {
      if (submitMarkers.length > 1) return html;
      if (buttons.length !== 1 || submitCandidates.length !== 1) return html;
      html = replaceOpeningTag(
        html,
        submitCandidates[0].marker,
        setAttributeValue(
          submitCandidates[0].marker.tag,
          "data-runtime-submit",
          "true",
        ),
      );
    }
  }

  for (const kind of ["success", "retry"] as const) {
    root = findUniqueInteractionRoot(html, input.content);
    if (!root) return html;
    rootHtml = getElementHtml(html, root);
    if (!rootHtml) return html;
    const feedback = findTagMatchesWithAttributes(rootHtml, {
      "data-feedback-kind": kind,
    });
    if (feedback.length > 1) return html;
    if (feedback.length === 1) {
      if (!/\shidden(?:\s|=|\/?>)/i.test(feedback[0].tag)) {
        const globalMarker = {
          ...feedback[0],
          index: root.index + feedback[0].index,
        };
        html = replaceOpeningTag(
          html,
          globalMarker,
          setAttributeValue(feedback[0].tag, "hidden", "hidden"),
        );
      }
      continue;
    }

    const text = [
      ...new Set(
        interaction.questions.map(
          (question) => question.feedback[kind],
        ),
      ),
    ].join(" ");
    html = insertBeforeElementClose(
      html,
      root,
      `<div data-feedback-kind="${kind}" hidden>${escapeHtmlText(text)}</div>`,
    );
  }

  return html;
}

export function findUniqueInteractionRoot(
  html: string,
  content: PageContentDSL,
) {
  if (content.interaction.type === "none") return undefined;
  const roots = findTagMatchesWithAttributes(html, {
    "data-interaction-type": content.interaction.type,
    "data-interaction-id": `interaction-${content.pageId}`,
  });
  return roots.length === 1 ? roots[0] : undefined;
}

function hasInputValue(html: string, value: string) {
  return findTagMatchesWithAttributes(html, { value }).some(({ tag }) =>
    /^<input\b/i.test(tag),
  );
}

function hasCompleteChoiceQuestionStructure(
  rootHtml: string,
  interaction: Extract<
    PageContentDSL["interaction"],
    { type: "choice" }
  >,
) {
  return interaction.questions.every(
    (question) =>
      findTagMatchesWithAttributes(rootHtml, {
        "data-question-id": question.id,
      }).length === 1 &&
      question.options.every(({ id }) => hasInputValue(rootHtml, id)),
  );
}

/**
 * visualPrimitive 是可信 DSL 的展示元数据。豆包偶尔已经生成完整的代码原生
 * 互动图示，却只漏掉该属性；此处只在唯一、可证明的图示根节点上补齐标记，
 * 不生成新教学内容，也不把图片素材冒充代码原生图示。
 */
export function normalizeVisualPrimitiveMarker(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (
    typeof output !== "string" ||
    input.content.runtime.visualPrimitive === "none"
  ) {
    return output;
  }

  const expected = input.content.runtime.visualPrimitive;
  const allTags = findTagMatchesWithAttributes(output, {});
  const mainMarkers = findTagMatchesWithAttributes(output, {
    "data-page-id": input.content.pageId,
  }).filter(({ tag }) => /^<main\b/i.test(tag));
  if (mainMarkers.length !== 1) return output;
  const main = mainMarkers[0];
  const assetMarkers = input.content.assetSlots.flatMap(({ id }) =>
    findTagMatchesWithAttributes(output, {
      "data-asset-slot-id": id,
    }),
  );
  const isTrustedCandidate = (marker: OpeningTagMatch) =>
    isOpeningTagInsideElement(output, marker, main) &&
    !assetMarkers.some(
      (assetMarker) =>
        marker.index === assetMarker.index ||
        (assetMarker.index !== main.index &&
          isOpeningTagInsideElement(output, marker, assetMarker)),
    );

  const exact = findTagMatchesWithAttributes(output, {
    "data-visual-primitive": expected,
  }).filter(isTrustedCandidate);
  if (exact.length === 1) return output;

  const declared = allTags.filter(
    ({ tag }) => getAttributeValues(tag, "data-visual-primitive").length > 0,
  );
  if (declared.length === 1) {
    if (!isTrustedCandidate(declared[0]!)) {
      const cleaned = replaceOpeningTag(
        output,
        declared[0]!,
        removeAttribute(
          declared[0]!.tag,
          "data-visual-primitive",
        ),
      );
      return normalizeVisualPrimitiveMarker(cleaned, input);
    }
    const declaredValue = getAttributeValues(
      declared[0].tag,
      "data-visual-primitive",
    )[0];
    if (normalizeVisualPrimitiveValue(declaredValue) !== expected) {
      return output;
    }
    return replaceOpeningTag(
      output,
      declared[0],
      setAttributeValue(
        declared[0].tag,
        "data-visual-primitive",
        expected,
      ),
    );
  }
  if (declared.length > 1) return output;

  const semanticCandidates = allTags.filter(
    (marker) =>
      isTrustedCandidate(marker) &&
      isVisualPrimitiveSemanticCandidate(marker.tag, expected) &&
      hasCodeNativeVisualStructure(output, marker, input.content),
  );
  if (semanticCandidates.length === 1) {
    return replaceOpeningTag(
      output,
      semanticCandidates[0],
      setAttributeValue(
        semanticCandidates[0].tag,
        "data-visual-primitive",
        expected,
      ),
    );
  }

  const interactionContainer = findVisualInteractionContainer(
    output,
    allTags,
    input.content,
    isTrustedCandidate,
  );
  if (interactionContainer) {
    return replaceOpeningTag(
      output,
      interactionContainer,
      setAttributeValue(
        interactionContainer.tag,
        "data-visual-primitive",
        expected,
      ),
    );
  }

  const blockContainer = findVisualBlockContainer(
    output,
    allTags,
    input.content,
    isTrustedCandidate,
  );
  if (blockContainer) {
    return replaceOpeningTag(
      output,
      blockContainer,
      setAttributeValue(
        blockContainer.tag,
        "data-visual-primitive",
        expected,
      ),
    );
  }

  const fallback = buildVisualPrimitiveFallback(input.content, expected);
  return fallback
    ? insertBeforeElementClose(output, main, fallback)
    : output;
}

/**
 * timeline/comparison 等页面常把代码原生图示直接实现成一组可操作节点。只在
 * 全部稳定 interaction item 都唯一存在时，选择包含它们的最小非素材容器；
 * 外层互动区和单个 item 都不会被误标。
 */
function findVisualInteractionContainer(
  html: string,
  allTags: OpeningTagMatch[],
  content: PageContentDSL,
  isTrustedCandidate: (marker: OpeningTagMatch) => boolean,
) {
  const itemIds =
    content.interaction.type === "reveal" ||
    content.interaction.type === "explore" ||
    content.interaction.type === "sort"
      ? content.interaction.items.map(({ id }) => id)
      : [];
  if (itemIds.length < 2) return undefined;

  const itemMarkers = itemIds.map((id) =>
    findTagMatchesWithAttributes(html, {
      "data-interaction-item-id": id,
    }),
  );
  if (itemMarkers.some((markers) => markers.length !== 1)) return undefined;
  const items = itemMarkers.map(([marker]) => marker!);
  const candidates = allTags
    .filter(
      (marker) =>
        /^(?:<section|<div|<figure|<ol|<ul)\b/i.test(marker.tag) &&
        isTrustedCandidate(marker) &&
        items.every((item) =>
          isOpeningTagInsideElement(html, item, marker),
        ),
    )
    .map((marker) => ({
      marker,
      size: getElementHtml(html, marker)?.length ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.size - right.size);
  if (
    candidates.length === 0 ||
    (candidates[1] && candidates[0]!.size === candidates[1].size)
  ) {
    return undefined;
  }
  return candidates[0]!.marker;
}

/**
 * comparison、process 等页面常已用稳定内容块构成代码原生图示，只是模型把
 * primitive 错标在图片上或漏标。若至少两个 block 都唯一存在，则选择完整
 * 包含它们的最小非素材容器作为图示根，避免再追加一份重复的兜底摘要。
 */
function findVisualBlockContainer(
  html: string,
  allTags: OpeningTagMatch[],
  content: PageContentDSL,
  isTrustedCandidate: (marker: OpeningTagMatch) => boolean,
) {
  if (content.blocks.length < 2) return undefined;
  const blockMarkers = content.blocks.map(({ id }) =>
    findTagMatchesWithAttributes(html, {
      "data-block-id": id,
    }),
  );
  if (blockMarkers.some((markers) => markers.length !== 1)) return undefined;
  const blocks = blockMarkers.map(([marker]) => marker!);
  const candidates = allTags
    .filter(
      (marker) =>
        /^(?:<section|<div|<figure|<article|<ol|<ul)\b/i.test(
          marker.tag,
        ) &&
        isTrustedCandidate(marker) &&
        !blocks.some(({ index }) => index === marker.index) &&
        blocks.every((block) =>
          isOpeningTagInsideElement(html, block, marker),
        ),
    )
    .map((marker) => ({
      marker,
      size: getElementHtml(html, marker)?.length ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((left, right) => left.size - right.size);
  if (
    candidates.length === 0 ||
    (candidates[1] && candidates[0]!.size === candidates[1].size)
  ) {
    return undefined;
  }
  return candidates[0]!.marker;
}

function buildVisualPrimitiveFallback(
  content: PageContentDSL,
  primitive: NonNullable<PageContentDSL["runtime"]>["visualPrimitive"],
) {
  if (
    !["concept-map", "process", "comparison", "timeline"].includes(primitive) ||
    content.blocks.length < 2
  ) {
    return undefined;
  }
  const listTag =
    primitive === "process" || primitive === "timeline" ? "ol" : "ul";
  const labels = content.blocks
    .slice(0, 6)
    .map(({ label, heading }) => label ?? heading);

  return `<section class="course-native-visual course-native-visual--${primitive}" data-visual-primitive="${primitive}" data-course-contract-restored="visual-primitive" aria-label="${escapeHtmlAttribute(content.title)}知识结构"><${listTag}>${labels
    .map((label) => `<li>${escapeHtmlText(label)}</li>`)
    .join("")}</${listTag}></section>`;
}

function normalizeVisualPrimitiveValue(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function isVisualPrimitiveSemanticCandidate(
  tag: string,
  primitive: NonNullable<PageContentDSL["runtime"]>["visualPrimitive"],
) {
  if (
    !/^<(?:section|div|figure|svg|ol|ul)\b/i.test(tag) ||
    getAttributeValues(tag, "data-asset-slot-id").length > 0
  ) {
    return false;
  }

  const identifier = [
    ...getAttributeValues(tag, "id"),
    ...getAttributeValues(tag, "class"),
  ]
    .join(" ")
    .toLowerCase();
  const patterns = {
    "concept-map": /(?:concept|mind|knowledge)[-_ ]?(?:map|graph)|card[-_ ]?map/,
    "function-graph": /(?:function|equation)[-_ ]?(?:graph|plot)|graph[-_ ]?canvas/,
    venn: /(?:^|[-_ ])venn(?:$|[-_ ])/,
    timeline: /(?:^|[-_ ])time[-_ ]?line(?:$|[-_ ])/,
    process: /(?:^|[-_ ])(?:process|flow|steps?)(?:$|[-_ ])/,
    comparison: /(?:^|[-_ ])(?:comparison|compare)(?:$|[-_ ])/,
    none: /$^/,
  } as const;

  return patterns[primitive].test(identifier);
}

function hasCodeNativeVisualStructure(
  html: string,
  marker: OpeningTagMatch,
  content: PageContentDSL,
) {
  const element = getElementHtml(html, marker);
  if (!element) return false;
  const visible = normalizeVisibleText(element);
  const matchedLabels = content.blocks.filter((block) =>
    [block.label, block.heading]
      .filter((value): value is string => Boolean(value))
      .some((value) => visible.includes(normalizeText(value))),
  ).length;
  const structuralChildren = findTagMatchesWithAttributes(element, {}).filter(
    ({ index, tag }) =>
      index > 0 &&
      !/^<(?:img|source|br|hr|input|meta|link)\b/i.test(tag),
  );

  return (
    matchedLabels >= Math.min(2, content.blocks.length) &&
    structuralChildren.length >= 2
  );
}

function replaceOpeningTag(
  html: string,
  marker: OpeningTagMatch,
  replacement: string,
) {
  return (
    html.slice(0, marker.index) +
    replacement +
    html.slice(marker.index + marker.tag.length)
  );
}

function insertAfterOpeningTag(
  html: string,
  marker: OpeningTagMatch,
  markup: string,
) {
  const index = marker.index + marker.tag.length;
  return `${html.slice(0, index)}${markup}${html.slice(index)}`;
}

export function removeAttribute(tag: string, attribute: string) {
  const escapedAttribute = attribute.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  return tag.replace(
    new RegExp(
      `\\s+${escapedAttribute}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s'"=<>\\u0060]+))?`,
      "i",
    ),
    "",
  );
}

export function setAttributeValue(
  tag: string,
  attribute: string,
  value: string,
) {
  const escapedAttribute = attribute.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const attributePattern = new RegExp(
    `\\s+${escapedAttribute}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s'"=<>\\u0060]+)`,
    "i",
  );
  const withoutExisting = tag.replace(attributePattern, "");
  return withoutExisting.replace(
    /\s*(\/?>)$/,
    ` ${attribute}="${escapeHtmlAttribute(value)}"$1`,
  );
}

/**
 * 素材的可访问名称来自服务端已批准的 Asset.altText。模型常会做同义改写，
 * 导致相同输入在重试时重复失败；这里只规范化已经唯一绑定的 img 或 CSS
 * consumer，再交给原严格校验器复验。
 */
export function normalizeReadyCssBackgroundAccessibility(
  output: unknown,
  input: HtmlEngineerInput,
) {
  if (typeof output !== "string") return output;

  let html = output;
  for (const result of input.assets ?? []) {
    if (result.status !== "ready" || !result.asset?.uri) continue;

    const { assetSlotId } = result.request;
    const markers = findTagMatchesWithAttributes(html, {
      "data-asset-slot-id": assetSlotId,
    });
    if (markers.length !== 1) continue;

    const marker = markers[0];
    const tagName = marker.tag
      .match(/^<\s*([a-z][\w:-]*)/i)?.[1]
      ?.toLowerCase();
    const directImage =
      tagName === "img" &&
      hasAttributeValue(marker.tag, "src", result.asset.uri);
    const descendantImage = directImage
      ? undefined
      : findUniqueDescendantImage(
          html,
          marker,
          assetSlotId,
          result.asset.uri,
        );
    const altText = result.asset.altText ?? "";
    if (directImage) {
      html = replaceOpeningTagAt(
        html,
        marker.index,
        marker.tag,
        setAttributeValue(marker.tag, "alt", altText),
      );
      continue;
    }
    if (descendantImage) {
      const elementHtml = getElementHtml(html, marker);
      const localIndex = elementHtml?.indexOf(descendantImage) ?? -1;
      if (localIndex >= 0) {
        const index = marker.index + localIndex;
        html = replaceOpeningTagAt(
          html,
          index,
          descendantImage,
          setAttributeValue(descendantImage, "alt", altText),
        );
      }
      continue;
    }

    const cssConsumer = findReadyCssAssetConsumer(
      html,
      marker,
      result.asset.uri,
    );
    if (!cssConsumer) continue;

    if (hasAccessibleBackgroundContract(cssConsumer.tag, altText)) continue;

    const normalizedTag = setBackgroundAccessibility(cssConsumer.tag, altText);
    html =
      html.slice(0, cssConsumer.index) +
      normalizedTag +
      html.slice(cssConsumer.index + cssConsumer.tag.length);
  }

  return html;
}

function replaceOpeningTagAt(
  html: string,
  index: number,
  currentTag: string,
  nextTag: string,
) {
  return (
    html.slice(0, index) +
    nextTag +
    html.slice(index + currentTag.length)
  );
}
