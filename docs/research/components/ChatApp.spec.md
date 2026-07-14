# ChatApp component specification

## Target

- File: `src/features/seaca/chat-app.tsx`
- Route consumer: `src/app/chat/page.tsx`
- Desktop references: `docs/design-references/chat-desktop-1440.png`, `docs/design-references/chat-conversation-desktop-1440.png`

## Responsibility

`ChatApp` is the client-side coordinator for the full-viewport chat page. It owns state and composes `ChatSidebar`, `ChatThread`, and `ChatComposer`; it does not duplicate their visual markup.

## Layout

- Fill the viewport: `height: 100dvh`, `overflow: hidden`, background `#fcf9f2`, text `#382c19`.
- Desktop grid consists of a 300px sidebar plus a flexible main region. The sidebar animates to about 60px when collapsed.
- Main region is a vertical flex container: scrollable thread and composer anchored at the bottom.
- Provide the observed left-edge sidebar toggle at the boundary; pass collapsed state and toggle callback to the sidebar when that component owns the toggle.
- Keep a small right-edge panel toggle as an accessible visual placeholder; no panel content was observed.

## State and data

- Use `conversations` from `@/data/seaca`; make a local mutable copy so sent messages can be appended without persistence.
- Initial state is empty/new conversation unless a known `conversation` query parameter is present.
- Read an optional `prompt` query parameter into the composer draft. Do not send automatically.
- Own: selected conversation id, local conversation list/messages, sidebar collapsed state, draft text, optional right-panel open state.

## Events

- New conversation clears selection and returns to empty thread.
- Selecting a history row displays that conversation.
- Sending trimmed nonempty text creates/selects a local conversation if needed, appends the user message, clears the draft, then appends a short assistant placeholder reply. No API call.
- Suggested prompt selection places that text in the draft (sending only when the child contract explicitly requests it).
- Sidebar title search remains owned by `ChatSidebar`; selection callbacks return ids to this coordinator.

## Child contracts

- `ChatSidebar`: controlled selected id/collapse state; callbacks for select, new, and collapse toggle.
- `ChatThread`: receives the selected conversation or `null`.
- `ChatComposer`: receives draft, change callback, submit callback, and whether a conversation is active.
- If builder-produced child props differ slightly, adapt only this coordinator and keep state ownership here.

## Responsive

- Desktop (>= 768px): fixed sidebar column and flexible thread.
- Mobile: sidebar behaves as an off-canvas overlay; start closed and expose a labelled menu/toggle. Thread and composer use full width.
- Maintain safe-area padding around the bottom composer.

## Accessibility

- All boundary/panel controls have Chinese `aria-label` text.
- Announce appended messages naturally in the thread child; do not force focus changes.
- Respect reduced-motion preferences for transitions.

