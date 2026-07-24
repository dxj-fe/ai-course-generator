# WorkGallery Specification

## Overview
- **Target file:** `src/features/keya/work-gallery.tsx`
- **References:** `docs/design-references/home-desktop-1440.png`, `docs/design-references/home-mobile-390.png`
- **Interaction model:** click-driven sort/search/card/author/like/bookmark controls; no scroll-triggered state.
- **Evidence note:** desktop styles and rects were recorded during signed-in browser inspection; card copy is transcribed from the full-resolution screenshots.

## DOM Structure
`section` > centered 1200px wrapper > h2 > toolbar (sort pills + search) > fixed-size work-card grid. Each card contains 16:9 cover, padded title/description/tags body, dotted divider, and footer with author link plus like/bookmark buttons.

## Computed Styles and Geometry (1440 px)

### Section header and toolbar
- section rect `x:0; y:796; width:1440px; height:1473.5px`; transparent over page `rgb(253,251,248)`.
- inner wrapper `x:120; width:1200px`. h2 rect `x:120; y:860; width:170.1875px; height:32px`; text `今天，为你推荐`; 24px/32px, weight 600, color `rgb(173,150,136)`.
- toolbar top `y:908`; pill row gap `8px`. Each pill rect is `113.125×40px`, rounded 9999px, padding 0 16px, icon/text gap 8px, 14px/14px, no border/shadow, 150ms color transition.
- active `综合热门`: fill `rgb(246,212,202)`, text `rgb(142,47,32)`, weight 700.
- inactive `最多学习`, `最多点赞`, `最新作品`: fill `rgb(248,242,234)`, text `rgb(118,104,91)`, weight 500.
- search control is right-aligned, approx `x:1038; y:908; width:282px; height:40px`, rounded border; search input rect `x:1080; y:917.5; width:234px; height:21px`; transparent, 14px/21px; placeholder `搜索作品`; text `rgb(56,44,25)`. Use a 16px search icon and warm-gray border.

### Grid and cards
- first grid row cover top `973px`; columns begin at cover x `121, 427, 733, 1039`; cover size `282×157.5px`; horizontal gap `24px`.
- subsequent row cover tops `1341.5px` and `1710px`; row pitch `368.5px` (≈344.5px card + 24px gap). Keep cards equal-height so footers align.
- card visual: warm white `rgb(255,253,247)`, subtle 1px warm border (`rgba(235,225,214,.5)` appears once per card in the palette), ≈12px radius, clipped cover, very soft brown shadow as shown.
- cover `object-fit:cover`; first-row images have exact computed `282×157.5px` (16:9).
- body horizontal padding 16px. h3 starts 16px below cover (`y:1146.5` in row 1), width 248px, 16px/20px, weight 600, letter spacing `.032px`, color `rgb(56,44,25)`, overflow hidden.
- description: 14px/20px regular, warm gray-brown; clamp to 2 lines. Tags: 12px/16px, weight 600. Preserve empty body space when copy is absent.
- divider is dotted warm gray (`rgb(239,231,223)` in extracted palette). Footer avatar is 24×24px (row 1 y1272.5); author link is 32px high, inline flex, gap 8px, padding `4px 8px 4px 4px`, fully rounded.
- like/bookmark controls: aria `点赞`/`收藏`; height 32px, gap 4px, padding 0 8px, rounded 9999px, transparent; hover `rgb(245,239,231)`; 150ms color transition. Counts are 12px-sized visually; use outline thumb/bookmark icons.

## Verbatim Card Data
1. `论语职场闯关` — `论语职场闯关之：30分钟用孔子智慧解决职场难题` — `#论语 #职场 #国学` — 学而时习獭 — 1/1 — `/keya/images/8312d23f-0795-440b-ba89-5b4067bc8a3c.webp`.
2. `《遥远的她》改编爱情故事` — `改编版遥远的她，我最爱的中文歌曲，故事呈现` — `#张学友 #陈奕迅` — 羽生獭落 — 3/2 — `/keya/images/6fe9c26d-4a77-4648-82ae-01ee70c717cd.webp`.
3. `猴王出世` — `一块仙石，孕育了一个王——美猴王！来一起看一下猴王出世这篇课文吧。` — `#四大名著 #西游记 #小学` — Ray — 1/1 — `/keya/images/29d00308-8054-4003-8377-8ef366d515ac.webp`.
4. `芭比娃娃发展历史全解析` — `10分钟搞定芭比娃娃的发展简史，10分钟搞定芭比娃娃的发展简史` — no tags — 赖獭赖獺 — 2/1 — `/keya/images/53d9b6b0-a745-436b-a1d0-899fe9081f45.webp`.
5. `道林格雷的画像动画故事` — `我的英文名字来源，希望大家喜欢这个故事！` — `#奥斯卡王尔德` — 羽生獭落 — 2/2 — `/keya/images/5e860d20-7fff-41a2-aadc-6f9c87f15c55.webp`.
6. `毕加索生平与作品赏析` — `你也喜欢搞抽象？先来看看艺术大师的境界吧` — `#艺术 #毕加索` — wanglei — 3/2 — remote HTML cover (not downloaded; recreate/fallback).
7. `入门级日常英文对话练习` — `是测试是测试是测试` — `#测试测试` — zero7room — 2/2 — remote HTML cover (same design family as hero card 1).
8. `印钞过程与核心技术详解` — no description/tags — 战斗獭獭 — 1/0 — remote HTML cover.
9. `旅行英语互动课程` — no description — `#旅行` — 羽生獭落 — 1/1 — `/keya/images/e69af016-1269-4dba-a889-1eb831b5350d.webp`.
10. `伦敦腔英语高级表达进阶` — `你好哇 今天教学地道伦敦英语 让你成为地道英国人` — `#伦敦 #英语` — 羽生獭落 — 1/1 — `/keya/images/81117d05-2aa0-46b4-b73f-c7c8a787ab67.webp`.
11. `零基础《资本论》入门` — no description — `#学术 #经济学` — zero7room — 0/0 — remote HTML cover.
12. `《念奴娇·赤壁怀古》赏析` — `苏轼《念奴娇·赤壁怀古》经典赏析，读懂豪放词的家国情怀` — no tags — 战斗獭獭 — 0/0 — remote HTML cover.

## Avatar Assets
- 学而时习獭 `/keya/images/c45fc431-de9c-4b20-bb62-ee675be81f20.png`; 羽生獭落 `/keya/images/53b5df35-2383-42c6-844f-1246374b8b9f.png`; Ray `/keya/images/keya8.png`.
- 赖獭赖獺 `/keya/images/709828ac-ffe2-4afb-8db8-e4a47b7ff8a6.png`; wanglei `/keya/images/8d2567ef-fbfc-42ba-8d92-5fbea6f6f554.png`; zero7room `/keya/images/df24dc8b-24bc-4c4f-a3de-7c8f11a7b939.png`; 战斗獭獭 `/keya/images/keya10.png`.

## States and Behaviors
- Selecting a sort pill moves active colors/weight to that pill and updates mock order; 150ms transition. Initial state is `综合热门`.
- Search filters titles/descriptions locally; original contains a hidden green `搜索` submit button that may stay omitted until focus/input.
- Card click opens a mock work route; author link opens a mock profile route. Like/bookmark update local counts/state only.
- Author and metric hover background is `#F5EFE7`; cards may use only a subtle shadow lift—no scroll/time animation was observed.

## Responsive Behavior
- **Desktop 1440:** 4 columns in a 1200px wrapper, 24px column/row gaps, 12 cards in 3 rows.
- **Mobile 390:** wrapper left edge x≈24. h2 remains at y≈860. Sort pills wrap to two rows (2+2, 8px gaps); search moves to a new row at x≈24 and keeps ≈282×40px.
- Grid becomes one left-aligned fixed-width ≈282px column (not stretched to 342px); first cover begins around y≈1069. Keep 24px vertical gaps and desktop card typography/cover ratio.
