# Seaca interaction inventory

Evidence was captured from the authenticated Chrome session on 2026-07-13. Items marked `mock` are deliberately local-only in this clone.

## Global header

- Logo returns to `/`.
- `探索` opens `/`; `课程` opens `/course`.
- Search affordance is present in the reference header but no distinct search-results route was observed; the clone keeps it as a local affordance.
- `创作` opens `/chat`; avatar/account controls are visual placeholders (`mock`).

## `/` exploration page

- Featured cards are clickable and open `/chat` with a prefilled topic (`mock`).
- Prompt chips fill the composer; pressing Enter or the send button navigates to `/chat?prompt=…`.
- Gallery category pills filter cards locally.
- Gallery search filters title, description, tags, and author locally.
- Like and bookmark controls toggle locally; counts update in memory (`mock`, no persistence).
- Work cards do not have a verified public detail route, so opening one starts a corresponding chat (`mock`).

## `/course` library

- Tabs: `学习`, `作品`, `点赞`, `收藏`; selected tab changes visibly and is represented by `tab=learning|works|likes|favorites` when implemented.
- `最近打开` is a lightweight local sort control (`mock`).
- Search is controlled and filters the active empty library locally.
- All four captured/derived library states are empty because no authenticated course records were available.

## `/chat` workspace

- `返回` opens `/`.
- `新建` clears the selected conversation and restores the empty welcome state.
- Sidebar search filters mock conversation titles.
- Selecting `英文口语对话练习` loads the captured conversation transcript; other rows are empty mock threads.
- Left sidebar collapses from 300px to roughly 60px and restores; its toggle changes accessible label between `收起左侧栏` and `展开左侧栏`.
- The right-side expansion control is kept as a visual/local placeholder because its panel content was not observed.
- Suggested prompts fill or send the composer; Enter sends, Shift+Enter inserts a newline.
- Sending appends a user message and a short assistant placeholder response (`mock`); no network request or persistence is required.
- Pin/history/overflow/copy controls are local or visual placeholders unless their effect is directly visible.

## Keyboard and accessibility baseline

- Native buttons and links retain focusability and visible focus rings.
- Tabs expose `role=tab`, `aria-selected`, and a labelled tab list.
- Icon-only controls have an accessible label.
- Decorative images use empty alt text; content covers and avatars have meaningful alt text.

