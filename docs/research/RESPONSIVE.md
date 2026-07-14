# Responsive evidence and clone decisions

## Captured viewports

| Route/state | Width × height | Evidence |
| --- | ---: | --- |
| `/` exploration | 1440 × 900 | `docs/design-references/home-desktop-1440.png` |
| `/` exploration | 390 × 844 | `docs/design-references/home-mobile-390.png` |
| `/course` learning-empty | 1440 × 900 | `docs/design-references/course-desktop-1440.png` |
| `/chat` new/empty | 1440 × 900 | `docs/design-references/chat-desktop-1440.png` |
| `/chat` selected conversation | 1440 × 900 | `docs/design-references/chat-conversation-desktop-1440.png` |

## Verified home behavior

- Desktop uses a 1200px centered rail, three featured cards, and a four-column work grid.
- At 390px the reference keeps the 64px header and 732px hero rhythm. The featured cards compress into three narrow columns and visibly crop their artwork.
- Suggestion chips wrap to multiple rows at mobile width.
- Gallery controls wrap and the work grid becomes one column; all 12 works remain in document order.
- The captured mobile heading/header are partially clipped by the narrow viewport. The clone preserves the density but allows critical controls and title text to wrap where needed for usability.

## Course and chat decisions

No authenticated small-screen capture was successfully recorded for `/course` or `/chat`; the following are implementation decisions, not claims about the source:

- `/course`: 24px gutters, horizontally scrollable tabs, stacked toolbar, full-width search.
- `/chat`: under 768px, history becomes an off-canvas rail and the main thread uses the full viewport. The composer uses 16px gutters and wraps suggestions.
- Neither route introduces a bottom navigation or any unobserved mobile-only product feature.

## Breakpoints used by the clone

- `< 640px`: single-column gallery, wrapped controls, compact type/spacing.
- `640–1023px`: two-column gallery and flexible featured layout.
- `>= 1024px`: reference desktop layout; gallery reaches four columns when the 1200px rail fits.
- `768px` is the chat sidebar overlay boundary.

