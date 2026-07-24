# SiteHeader Specification

## Overview
- **Target file:** `src/components/site-header.tsx`
- **References:** `docs/design-references/home-desktop-1440.png`, `docs/design-references/home-mobile-390.png`
- **Interaction model:** click-driven navigation and user menu; fixed during scroll.
- **Evidence note:** dimensions and colors were recorded during signed-in browser inspection; mobile behavior is from the 390 px screenshot.

## DOM Structure
`nav` (fixed) > centered inner row > home logo link, center route links, account button. The account button contains avatar, username, and down chevron; its menu may be a local stub.

## Computed Styles and Geometry (1440 px)

### Nav shell
- rect: `x:0; y:0; width:1440px; height:65px`; `position:fixed; inset-inline:0; top:0; z-index:50`.
- `background-color:rgb(252,249,242)`; `backdrop-filter:blur(6px)` (class evidence); no shadow; no visible border.
- font: `"PingFang SC", "Microsoft YaHei", SourceHanSansSC-VF, -apple-system, system-ui, "Segoe UI", sans-serif`; base `16px/24px`, weight 400; color `rgb(10,10,10)`.
- Inner content aligns to the common `1200px` page width (`x:120` through `1320`) and vertically centers at 32px.

### Brand
- link aria-label: `Keya 首页`; href `/`; rect `x:120; y:18; width:80.796875px; height:28px`.
- layout `display:flex; align-items:center; gap:4px`.
- mark rect `x:120; y:21; width:20px; height:22px`; asset `/keya/images/logo-mark.webp` (source is 25×28).
- visible wordmark: `KEYA`; preserve uppercase and warm gray-brown appearance from the references.

### Route links
- `探索`: href `/`; rect `x:633.4375; y:15.5; width:84.5625px; height:33px`.
- `我的`: href `/course`; rect `x:722; y:15.5; width:84.5625px; height:33px`; inter-pill gap `4px`.
- both: flex row, centered, icon/text gap `8px`, `height:33px`, `padding-left:14px`, `padding-right:18px`, fully rounded, 150ms color transition.
- active `探索` state uses the only captured nav-active fill `rgba(173,150,136,0.15)`; inactive text is muted (`rgb(152,142,128)` in the extracted palette).
- Icons are an outlined compass for `探索` and outlined book/library for `我的`, approximately 16px.

### Account control
- button aria-label: `keya_d931d5e4 用户菜单`; rect `x:1142.3125; y:16; width:177.6875px; height:32px`.
- `display:flex; align-items:center; gap:8px; padding:0 4px 0 0; border:0; border-radius:9999px; background:transparent`.
- avatar rect `32×32px` at `x:1142.3125; y:16`; asset `/keya/images/keya6.png`; circular crop.
- visible name: `keya_d931d5e4`; trailing down chevron; keep both on one line.
- hover: opacity `1 → .8`; `transition:opacity 0.15s cubic-bezier(.4,0,.2,1)`.
- focus-visible: 2px ring with offset (class evidence).

## States and Behaviors
- Header remains fixed and unchanged while scrolling; no Lenis and no scroll-snap were detected.
- Route links navigate to `/` and `/course`; current link receives active pill styling.
- Account click opens a compact menu anchored below the right edge; a placeholder with profile/logout rows is acceptable. Re-click/outside click closes it.
- Hover route colors over 150ms; account opacity over 150ms. No entrance animation is visible.

## Responsive Behavior
- **Desktop 1440:** inner max-width 1200px, 120px side margins; both route links visible; account right edge at 1320px.
- **Mobile 390:** header remains `65px` high and fixed; horizontal content padding is about `24px`; brand starts at x≈24 and keeps its desktop size.
- At 390px only the active `探索` pill is visible; hide `我的` to prevent collision. Account remains visible at the right with 32px avatar, username, and chevron; use `min-width:0`, one-line text, and clipping/ellipsis if needed.
- Do not stack the header. Match the dense single-row screenshot; background and blur remain identical.

## Verbatim Content and Assets
- Text: `KEYA`, `探索`, `我的`, `keya_d931d5e4`.
- `/keya/images/logo-mark.webp`, `/keya/images/keya6.png`.
- Use semantic inline SVG/lucide equivalents for compass, book, and chevron if the extracted hash icons are not mapped.
