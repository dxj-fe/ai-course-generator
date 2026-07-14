# Seaca page topology

## Route map

```text
Root layout
├── Global font/theme metadata
├── /                 Exploration home
│   ├── SiteHeader
│   ├── HomeHero
│   │   ├── Greeting and featured works
│   │   ├── Topic suggestions
│   │   └── Chat composer
│   └── WorkGallery
│       ├── Category filters and search
│       └── Responsive work-card grid
├── /course           Personal course library
│   ├── SiteHeader
│   └── CourseLibrary
│       ├── Library tabs
│       ├── Sort/search toolbar
│       └── Empty state
├── /chat             Full-height chat workspace
│   └── ChatApp
│       ├── ChatSidebar
│       ├── ChatThread
│       └── ChatComposer
└── /templates        Existing project gallery (preserved)
```

## Shared state boundaries

- `SiteHeader` derives the active navigation item from the pathname.
- `HomeHero` owns prompt input and `/chat` navigation.
- `WorkGallery` owns category, search, likes, and bookmarks; these are intentionally not persisted.
- `CourseLibrary` owns selected tab, sort affordance, and search state.
- `/chat` uses one client workspace controller to coordinate selected conversation, sidebar collapse, draft text, and local messages across the three visual regions.

## Responsive behavior

- Global content uses a 1200px desktop rail and 24px mobile gutters.
- The home gallery changes from four columns to fewer columns and then one column; featured cards compress/clip consistently with the captured 390px reference.
- Course tabs scroll horizontally on narrow screens; the toolbar stacks and search becomes full width.
- Chat remains a desktop three-region workspace. On narrow screens, the conversation sidebar becomes an overlay/drawer and the thread/composer retain the full content width. No unobserved bottom navigation is introduced.

