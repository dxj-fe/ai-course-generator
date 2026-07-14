# ChatComposer Specification

## Overview
- **Target:** `src/features/seaca/chat-composer.tsx`
- **References:** `chat-desktop-1440.png`, `chat-conversation-desktop-1440.png`
- **Evidence:** measurements recorded during signed-in browser inspection and cross-checked against the reference screenshots.
- **Interaction model:** click suggestions, type, submit; upload/voice may remain no-op mock controls.

## DOM Structure
- Bottom-centered composer region in the post-sidebar main area.
- Empty thread: four suggestion chips above a rounded composer shell.
- Composer shell: optional home shortcut, plus/upload, optional `演示` mode chip, textarea, microphone, circular send.
- Conversation state hides the four suggestions and shows `演示` between plus and textarea.

## Exact Computed Styles

### Suggestion chips (captured empty state)
- Shared: `display:flex; align-items:center; gap:8px; height:33.5px; padding:0 16px 0 14px; border:0; border-radius:9999px; background:rgba(253,250,247,.7); font:400 16px/24px ui-sans-serif; cursor:pointer`.
- Shadow: `rgba(233,222,210,.38) 0 1.5px 1.7px, rgba(232,214,194,.29) 0 4px 14.5px`.
- Transition: color/background/border/fill/stroke `.15s cubic-bezier(.4,0,.2,1)`; hover class background `rgba(253,251,248,.95)`.
- At 1920 × 936 all start y `806.5`: x/width `765.156/158.094`, `931.25/178.156`, `1117.406/171.344`, `1296.75/158.094`.
- Each icon is `14 × 14px`.

### Textarea and controls
- Textarea `(789,873)`, `610 × 24px`: min-height `24px`, max-height `120px`, overflow-y auto, resize none, transparent, no border, padding `0 4px 0 0`, `14px/24px`, color `rgb(56,44,25)`, placeholder `var(--seaca-brown)`.
- Upload `(753,873)`, `24 × 24px`: transparent, radius `9999px`, color `rgb(152,142,128)`, transition `.15s cubic-bezier(.4,0,.2,1)`; hover scale `1.08`, color `#382c19`.
- Mic `(1411,873)`, `24 × 24px`: same captured base; hover scale `1.06`, background `rgba(119,204,87,.14)`, color `#77cc57`.
- Send `(1439,869)`, `32 × 32px`: flex, radius `9999px`, `14px/20px`, weight `500`, white icon. Empty/disabled computed state: background `rgba(91,76,59,.18)`, cursor `not-allowed`.
- Enabled send class uses `var(--seaca-green)` (`#77cc57`); its enabled computed state was not captured.
- Rounded outer shell is visibly warm-white with a light border/shadow and about `750px` max width, but its exact computed padding, border, radius, shadow, and width were not saved.

### Home shortcut
- `56 × 56px`, absolute to shell's left with margin-right `24px`; circular `rgb(253,251,248)`.
- Shadow `rgba(233,222,210,.38) 0 1.75px 1.983px, rgba(232,214,194,.29) 0 4.667px 16.917px`; hover scale `1.05` over `.15s`.
- It computed to `display:none` in the 1920 capture despite a container-query class `@min-[1160px]:flex`; treat visibility breakpoint as unknown.

## States and Behavior
- Clicking a suggestion sends/loads its string. For the required mock, `练一段地道英文对话` selects the recorded conversation.
- Empty text disables send. Non-whitespace text enables send; Enter submits, Shift+Enter inserts newline; textarea auto-grows up to `120px`.
- Upload and microphone retain accessible labels and visual feedback but can be no-op stubs.
- Empty thread shows suggestions; selected conversation hides suggestions and shows the green `演示` mode marker. Exact mode-chip dimensions/styles were not captured.
- Focus rings from captured classes: suggestion `#77cc57/55`, upload `#3eb117/50`, mic uses the green token. Exact ring offsets were not computed.

## Text and Assets
- Suggestions: `帮我补上高一数学`; `30 分钟读懂《论语》`; `练一段地道英文对话`; `给我一个学习计划`.
- Placeholder: `想学点什么？慢慢找也可以...`; mode: `演示`.
- Accessible labels: `消息输入`, `上传文件`, `语音输入`, `发送`, `返回首页`.
- The implementation uses Lucide `BookOpen`, `Lightbulb`, `Languages`, and `Sparkles` for the suggestion chips, and `Presentation` for the mode marker. The captured legacy SVG copies are not retained locally.

## Responsive Behavior
- Verified desktop only. Composer and chip row stay centered in the available main area at 1440/1920.
- Tablet/mobile chip wrapping, shell width/padding, and home-shortcut visibility are unknown; do not claim fidelity at unobserved breakpoints.
