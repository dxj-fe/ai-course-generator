# ChatThread Specification

## Overview
- **Target:** `src/features/seaca/chat-thread.tsx`
- **References:** `chat-desktop-1440.png` (empty), `chat-conversation-desktop-1440.png` (selected conversation)
- **Evidence:** measurements recorded during signed-in browser inspection and the empty/selected-conversation reference screenshots.
- **Interaction model:** state-driven thread selection and vertical scrolling; no real-time/backend behavior is required.

## DOM Structure
- Main thread occupies the viewport remainder to the right of the `300px` open sidebar.
- Empty state: centered heading + subtitle.
- Conversation state: centered `750px` message column, right-aligned user bubble, then assistant status/body groups.
- Scroll-to-latest control floats above the composer when the view is not at the bottom.
- Composer is a sibling component and is not implemented here.

## Exact Computed Styles

### Main/empty state
- Chat mount background: `rgb(252,249,242)`; fixed inset `0`; overflow hidden.
- At 1920 × 936 the available main area starts at x `300`; empty heading is `(848.203,305)`, `523.594 × 40px`, centered on main x `1110`.
- Heading: `font:600 40px/40px`; color `rgb(56,44,25)`; nowrap; animation classes `fade-in slide-in-from-bottom-1`, duration `.2s`.
- Green word: `变好`, color `rgb(119,204,87)` (`#77cc57`).
- Decoration image: `78 × 6px`, captured at `(1171.688,347)`; absolute under the green word.
- Subtitle `(979.438,357)`, `261.125 × 22px`: margin-top `12px`; `16px/22px`, weight `400`, color `rgb(152,142,128)`; `.2s` animation with `.075s` delay.

### Conversation state
- Message column max-width: `750px`, centered in the post-sidebar main area.
- User bubble: right aligned; max-width `585px`; background `#f5f1ea`; rounded warm-gray bubble. Exact padding/radius/font values were not captured.
- Assistant content/card: max-width `750px`; `14.5px/25.81px` (recorded computed values); transparent background in the screenshot; text color appears `#382c19`, but its exact computed color was not saved.
- Completion rows use a green check followed by muted status copy (`已完成 4s/6s/10s`); exact status typography/gaps were not captured.
- Paragraph/list vertical gaps are visible but were not computed; follow the screenshot rather than assigning “exact” values.

### Scroll-to-latest button
- `(1054.031,758.5)` at 1920 × 936; `111.922 × 34px`; self-centered above composer.
- `display:flex; gap:8px; padding:1px 15px 1px 13px; border:1px solid rgb(235,225,214); border-radius:9999px; background:rgb(255,253,247)`.
- Shadow: `rgba(56,44,25,.16) 0 8px 12px, rgba(56,44,25,.08) 0 2px 3px`; z-index `10`.
- Hover border `#ad9688`; color/border/background transition `.15s cubic-bezier(.4,0,.2,1)`.

## States and Behavior
- Empty state is shown after `新建`; selecting `英文口语对话练习` shows the recorded conversation.
- Thread body scrolls independently while the sidebar/composer remain fixed.
- Show `回到最新` only when scrolled away from the bottom; clicking smoothly restores the latest position. It may be omitted if the mock thread never overflows.
- No streaming, persistence, markdown engine, editing, retry, or server calls are required.
- Empty-state entrance is fade + slight upward slide over `200ms`; conversation entrance animation was not captured.

## Text Content (verbatim)
- Empty title: `想学点什么？准备变好了吗？`
- Empty subtitle: `想学点新东西，但不知道怎么开始？`
- User: `练一段地道英文对话`
- Status 1: `已完成 4s`
- `好的！想练地道英文对话，这个方向不错～`
- `我先了解一下你的具体需求，这样能帮你设计最合适的练习内容`
- Status 2: `已完成 6s`
- `好的，练地道英文对话，这个想法很棒！我先帮你理清几个关键点，这样能设计出最适合你的练习内容`
- Status 3: `已完成 10s`
- `在开始设计之前，我先了解几个关键信息：`
- `1. 场景 — 你想练什么场景下的英文对话？比如：职场沟通、旅行英语、日常闲聊、商务谈判、留学面试、餐厅点餐……或者其他？`
- `2. 英语水平 — 你目前的英语大概是什么阶段？初级（能简单表达）、中级（能日常交流但不够地道）、还是高级（想打磨更自然的表达）？`
- `3. 练习方式 — 你希望我给你生成一段带中文讲解的学习内容（比如对话文本+重点词汇分析）？还是想直接跟我模拟对话练习？`
- `跟我说说你的想法，我来帮你量身打造～`
- Floating action: `回到最新`.

## Assets
- `/seaca/images/title-deco.svg` (exact 78 × 6 heading underline).
- Completion checks and scroll arrow are inline icons from the shared icon set.

## Responsive Behavior
- Verified desktop at 1440 and 1920: content remains centered within the space after the fixed sidebar; message max-width stays `750px`.
- Tablet/mobile layout is unknown; no small-screen screenshot or computed-state capture exists.
