# CourseLibrary Specification

## Overview
- **Target:** `src/features/keya/course-library.tsx`
- **Reference:** `docs/design-references/course-desktop-1440.png`
- **Evidence:** measurements recorded during signed-in browser inspection and the 1440 × 900 `/course` reference screenshot.
- **Interaction model:** click-driven tabs and search; no scrolling or time-driven state was observed.
- **Scope:** course-page content below the global 64/65px navigation. The global navigation is not part of this component.

## DOM Structure
- Full-width course surface beginning at `y=64`, height `836px` in the capture.
- Centered content rail, `1200px` wide (`x=120..1320`).
- Tab row: `学习`, `作品`, `点赞`, `收藏`; divider beneath the row.
- Toolbar: left sort pill (`最近打开`), right rounded search field and focus-only submit button.
- Results region; the captured `学习` state is an empty-state text pair.

## Exact Computed Styles

### Page surface
- Course wrapper: `position: relative; width: 1440px; height: 836px; background: rgb(252, 249, 242)`.
- Body font stack: `"PingFang SC", "Microsoft YaHei", SourceHanSansSC-VF, -apple-system, system-ui, "Segoe UI", sans-serif`.
- Body defaults: `16px/24px`, weight `400`, color `rgb(10, 10, 10)`.

### Tabs (`y=96`, `height=48px`)
- Every tab: `display:flex; align-items:center; position:relative; height:48px; padding:0 22px; font-size:20px; line-height:28px; cursor:pointer`.
- Each captured tab width: `84.7656px`; x positions: `120`, `204.7656`, `289.5313`, `374.2969`.
- Active `学习`: weight `600`, color `rgb(56, 44, 25)` (`#382c19`).
- Inactive: weight `400`, color `rgb(152, 142, 128)` (`#988e80`).
- Color transition: `0.15s cubic-bezier(0.4,0,0.2,1)`.
- Active tab has a thin green underline in the screenshot; its exact computed size/color was not captured.

### Toolbar
- Sort pill at `(120,173)`, `113.125 × 40px`: `display:flex; align-items:center; gap:8px; padding:0 16px; border:0; border-radius:9999px; background:rgb(243,237,228); color:rgb(91,76,59); font:700 14px/14px; cursor:pointer`.
- Search input at `(1080,182.5)`, `234 × 21px`: transparent, border `0`, padding `0`, color `rgb(56,44,25)`, `14px/21px`, weight `400`, placeholder `#b0a89e`, cursor text.
- Search input font is captured as `ui-sans-serif, system-ui, sans-serif, ...`; preserve this difference from the page font.
- Hidden submit: `height:32px; padding:0 16px; border-radius:9999px; background:rgb(119,204,87); color:white; font:600 14px/21px`.
- Submit display is `none` at rest and `inline-flex` through `group-focus-within`; hover `#5ba83e`, active `#3e7b2a` (from captured classes).
- Outer rounded search-shell dimensions/border were not captured; use the screenshot as the visual reference rather than inventing an “exact” value.

### Empty state
- Title at `(671.031,317)`, `97.9219 × 24px`: `16px/24px`, weight `400`, color `rgb(56,44,25)`.
- Subtitle at `(627.172,349)`, `185.641 × 21px`: margin-top `8px`, `14px/21px`, weight `400`, color `rgb(152,142,128)`.
- Pair is horizontally centered at `x=720`.

## States and Behavior
- Tabs are mutually exclusive. Active style moves on click; clicked content replaces the results region without page navigation.
- Only the `学习` content was captured. `作品`/`点赞`/`收藏` content and empty-copy are unknown; keep a simple blank/mock state rather than inventing cards or copy.
- Search is local/mock: typing may filter mock items. Focusing reveals `搜索`; blur hides it when focus leaves the group.
- `最近打开` is the only captured sort state. Any dropdown/alternate sorts are unknown.
- Hover/focus: tabs and sort use the captured 150ms color transition; exact hovered colors for tabs/sort were not captured.

## Assets and Text (verbatim)
- No raster/video assets are used in the captured empty state.
- Small line icons: clock in `最近打开`, magnifier in search; use the shared icon implementation.
- Tabs: `学习`, `作品`, `点赞`, `收藏`.
- Sort: `最近打开`; placeholder: `搜索在学的作品`; submit: `搜索`.
- Empty title: `这里还空空的`.
- Empty subtitle: `去探索广场发现喜欢的作品吧`.

## Responsive Behavior
- Verified desktop only (1440 × 900). No tablet/mobile course capture exists.
- At both known desktop data points the intended rail is centered; below desktop, tab wrapping, toolbar stacking, and search width are **unknown**. Do not claim pixel fidelity for unobserved breakpoints.
