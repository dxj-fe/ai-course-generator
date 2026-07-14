# HomeHero Specification

## Overview
- **Target file:** `src/features/seaca/home-hero.tsx`
- **References:** `docs/design-references/home-desktop-1440.png`, `docs/design-references/home-mobile-390.png`
- **Interaction model:** click-to-open featured works and click/type composer controls; static background (no scroll/time animation).
- **Evidence note:** desktop measurements were recorded during signed-in browser inspection; mobile layout is directly observed in the 390px screenshot.

## DOM Structure
`section` > four full-section visual layers > title/subtitle > 3-column featured grid > prompt-chip group > composer row. Composer row has a presentation/chat circle to the left and a rounded input bar containing plus, textarea, microphone, and send.

## Computed Styles and Geometry (1440 px)

### Section and visual layers
- section rect `x:0; y:64; width:1440px; height:732px`; `position:relative; overflow:hidden`; background context `rgb(253,251,248)`.
- base image `/seaca/images/bg.png`: absolute inset 0, rendered `1440×732px`.
- gradient layer: `linear-gradient(rgb(253,251,248) 0%, rgba(253,251,248,0) 46.154%, rgb(253,251,248) 100%)`.
- texture layer: `url(/seaca/images/dots.png)`, absolute inset 0, opacity `.05`, `mix-blend-mode:multiply`.

### Greeting
- h1 text `Hi seaca_d931d5e4, 今天想解锁什么？`; rect `x:355.28125; y:136; width:729.4375px; height:40px`.
- h1 `40px/40px`, weight 600, color `rgb(56,44,25)`, same CJK font stack as body, no margin.
- render only `解锁` in `rgb(119,204,87)`; underline/deco asset `/seaca/images/title-deco.svg` at `x:884.609375; y:178; width:78px; height:6px`.
- subtitle, centered below: `告诉我们的想法，我们随时开始`; 16px regular, muted `rgb(152,142,128)` (reference placement around y=204).

### Featured works
- grid bounds `x:120` to `1320`, top `324.25px`; 3 equal columns `384px`, gap `24px`; card height `216px`.
- Cards clip their cover at approximately 12px radius; covers fill the cell (`object-fit:cover`) without text overlays from this app.
- card 1 visible cover text: `开口说英语 从 4 个场景 开始`; this is a remote HTML-proxy cover and has no downloaded raster; reproduce as a simple static cover tile from the screenshot.
- card 2 alt/title `《遥远的她》改编爱情故事`; asset `/seaca/images/6fe9c26d-4a77-4648-82ae-01ee70c717cd.webp`; computed `384×216px` at `x:528; y:324.25`.
- card 3 alt/title `外国名著英文导读`; asset `/seaca/images/06942ebd-29b6-4e3a-9236-c46edc8235be.webp`; computed `384×216px` at `x:936; y:324.25`.
- each `进入` button: absolute right 8px/bottom 8px, `40×40px`, border `4px solid rgb(253,251,248)`, radius `9999px`, fill `rgba(91,76,59,.9)`, white arrow; hover scale; `transition:transform .15s cubic-bezier(.4,0,.2,1)`.

### Prompt chips
- one centered row at `y:646.5`, height `33.5px`, gaps `8px`; widths `158.09375, 178.15625, 171.34375, 158.09375px`.
- each: flex, align center, gap `8px`, padding `0 16px 0 14px`, radius `9999px`, background `rgba(253,250,247,.7)`.
- shadow `rgba(233,222,210,.38) 0 1.5px 1.7px, rgba(232,214,194,.29) 0 4px 14.5px`; 16px/24px system sans.
- hover fill `rgba(253,251,248,.95)`; color/background transition 150ms.
- icons 14×14: Lucide `BookOpen`, `Lightbulb`, `Languages`, and `Sparkles`; the captured legacy SVG copies are not retained locally.

### Composer
- rounded input bar occupies approximately `x:343; y:692; width:738px; height:56px`; warm off-white fill and the same soft brown shadow language as the chat circle.
- chat/presentation button: aria `进入聊天`, `x:277; y:692; 56×56px`, `rgb(253,251,248)`, fully rounded; shadow `rgba(224,210,196,.9) 0 1.5px 1.7px, rgba(232,214,194,.72) 0 4px 13px`; hover scale 1.05. The implementation renders a 38×38 Lucide `Presentation` icon.
- plus button aria `添加内容`: `24×24px` at x363/y709, color `rgb(152,142,128)`; hover scale 1.08 and color `rgb(56,44,25)`.
- textarea aria `消息输入`; placeholder `想学点什么？慢慢找也可以...`; rect x399/y709/610×24; 14px/24px, color `rgb(56,44,25)`, transparent, border 0, right padding 4px, min-height 24px/max-height 120px.
- mic aria `语音输入`: `24×24px` x1021/y709, muted brown; hover scale 1.06 and translucent green background.
- send aria `发送`: `32×32px` x1049/y705, fully rounded; disabled fill `rgba(91,76,59,.18)` and white arrow; enabled fill `rgb(119,204,87)`.

## States and Behaviors
- Featured arrow buttons open the matching work; mock routes/handlers are acceptable. Hover only scales the arrow circle.
- Chip click places its verbatim text in the textarea (or submits directly); preserve all four buttons.
- Textarea auto-grows to 120px. Send is disabled when trimmed text is empty; plus may invoke a hidden file input; microphone can be a no-op stub.
- Presentation button navigates to `/chat` or invokes a placeholder handler. No carousel autoplay, scroll trigger, or smooth-scroll behavior was observed.

## Responsive Behavior
- **Desktop 1440:** exact geometry above; hero remains 732px high.
- **Mobile 390:** section still starts below the 65px header and remains 732px high. Content uses about 24px side padding.
- h1 intentionally retains its desktop-sized, single-line 40px treatment and is centered in a width wider than the viewport, so both ends clip as shown; do not wrap it. Subtitle stays centered.
- Featured grid keeps 3 columns and 24px gaps inside a 342px available width, yielding three narrow ≈98px columns with fixed 216px height; covers are horizontally cropped. Do not convert to a carousel/stack.
- Chips wrap to 2×2 centered rows (first two, then last two). Composer bar becomes about 342×56px at x24; presentation circle remains to its left and is mostly clipped by the viewport.

## Verbatim Chip Content
`帮我补上高一数学` · `30 分钟读懂《论语》` · `练一段地道英文对话` · `给我一个学习计划`
