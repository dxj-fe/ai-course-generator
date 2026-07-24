# ChatSidebar Specification

## Overview
- **Target:** `src/features/keya/chat-sidebar.tsx`
- **References:** `chat-desktop-1440.png`, `chat-conversation-desktop-1440.png`
- **Evidence:** measurements recorded during signed-in browser inspection, the reference screenshots, and an observed collapsed state.
- **Interaction model:** click-driven navigation, search, disclosure rows, conversation selection, and sidebar collapse.

## DOM Structure
- Fixed left rail, full viewport height, open width `300px`; thin right divider.
- Top-to-bottom: back; new-chat; search; `置顶`; `历史`; conversation rows; monthly-credit block pinned near bottom.
- Each main control uses an icon, a label, and (where applicable) a right chevron/ellipsis.
- Edge toggle is absolutely attached to the rail's right boundary.

## Exact Computed Styles

### Rail and edge toggle
- Chat mount: fixed inset `0`, flex, overflow hidden, background `rgb(252,249,242)` (`#fcf9f2`).
- Open rail width `300px`; closed width `60.5625px`. Exact rail fill/divider computed values were not captured.
- Toggle open at `(300,38)`, `27 × 35px`: `position:absolute; z-index:31; display:flex; padding:11px 8px 11px 7px; border-radius:0 10px 10px 0; background:rgb(255,253,247); transition:left .3s, background .2s`.
- Closed toggle `left:60.5625px`; aria changes `收起左侧栏` → `展开左侧栏`.

### Primary controls
- Shared page font: `"PingFang SC", "Microsoft YaHei", SourceHanSansSC-VF, -apple-system, system-ui, "Segoe UI", sans-serif`.
- Back `(20,14)`, `78.4062 × 36px`: flex, gap `12px`, padding `0 8px`, radius `8px`, `16px/24px`, color `rgb(91,76,59)`.
- New `(20,68)`, `259 × 36px`: flex, gap `12px`, padding `0 8px`, radius `8px`, `16px/24px`, color `rgb(10,10,10)`.
- `置顶` `(20,148)` and `历史` `(20,188)`: each `259 × 36px`, same flex/gap/padding/radius/type as New.
- These controls transition color/background/border/fill/stroke for `.15s cubic-bezier(.4,0,.2,1)`; captured hover class is `background:rgba(91,76,59,.07)`.
- Search input `(58,109)`, `213 × 34px`: transparent; no border/padding; `font:600 16px/24px ui-sans-serif`; color `rgb(91,76,59)`; placeholder `rgb(152,142,128)`; letter-spacing `-0.12px` from its class.

### Conversation list
- Inner title buttons at x `58`, width `183px`, height `24px`, `16px/24px`, weight `400`, color `rgb(10,10,10)`; y values `232`, `269`, `306`, `343`.
- Ellipsis buttons at x `250`, size `22px`, y `233/270/307/344`: absolute, radius `6px`, color `rgb(152,142,128)`, opacity transition `.15s cubic-bezier(.4,0,.2,1)`.
- Active `英文口语对话练习` shows a warm rounded row fill and visible ellipsis in the conversation screenshot; its exact computed fill/row geometry was not captured.
- Long title is visually ellipsized (`《少儿英语What's that...` in the screenshot); enforce single-line overflow ellipsis.

### Credit block
- Verbatim visible text: `675` and `本月剩余`, with an outlined star icon.
- In the 1440 × 900 capture it sits near the bottom-left (around x `28`, baseline y `855/878`). Exact computed font, color, and inset were not captured.

## States and Behavior
- Collapse: width `300px → 60.5625px`, toggle left follows the same values, duration `.3s`. Compact internal visibility was not captured; preserve icons and hide overflowing text as the minimal mock.
- Back routes to `/`; New clears the selected conversation and restores the empty thread heading.
- Search filters the local mock conversation list by title; no server request is needed.
- Clicking a conversation selects it and renders the mock thread. The ellipsis may expose a no-op menu; real rename/delete logic is out of scope.
- `置顶` and `历史` show chevrons and behave as click disclosures. Exact collapsed-section animation/state was not captured.
- Hover row fill is `rgba(91,76,59,.07)`; exact focus ring styles were not captured.

## Text and Assets
- Primary: `返回`, `新建`, placeholder `搜索对话`, `置顶`, `历史`.
- Conversations: `未命名会话`; `英文口语对话练习`; `《少儿英语What's that》（副本）`; `日常生活英语口语教程`.
- Accessibility labels: toggle `收起左侧栏`/`展开左侧栏`; row menu `更多操作`.
- Icons are inline line-art; use the shared icon set. No raster/video asset belongs to the sidebar.

## Responsive Behavior
- Verified at 1440 and 1920: open rail remains `300px`; content dimensions stay fixed.
- Tablet/mobile behavior is unknown. Do not invent a permanent overlay/drawer model; a simple collapsed rail is acceptable for the mock.
