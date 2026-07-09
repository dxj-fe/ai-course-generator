# Directory Structure

This project uses a `src/` based Next.js App Router layout. The route layer stays thin; product code lives in feature, server, shared, and component layers.

```text
ai-course-generator/
├── src/
│   ├── app/                         # Next.js App Router: pages, layouts, route handlers only
│   │   ├── api/
│   │   │   ├── ai/
│   │   │   │   ├── generate/route.ts
│   │   │   │   └── stream/route.ts
│   │   │   └── chat/route.ts        # Backward-compatible stream endpoint
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── layout/                  # Cross-page layout components
│   │   └── ui/                      # Reusable, domain-neutral UI primitives
│   ├── config/
│   │   └── env.ts                   # Environment access and defaults
│   ├── features/
│   │   ├── ai-playground/           # Current Day 01 UI feature
│   │   │   ├── components/
│   │   │   └── lib/
│   │   └── course-generation/       # Future course planning/generation feature
│   │       ├── components/
│   │       ├── server/
│   │       └── types/
│   ├── server/
│   │   ├── agents/                  # Agent implementations
│   │   ├── ai/                      # Model provider, AI request parsing, handlers
│   │   ├── storage/                 # Persistence adapters
│   │   ├── tools/                   # Tool calling implementations
│   │   └── workflows/               # Workflow orchestration
│   └── shared/
│       ├── constants/
│       ├── errors/
│       ├── types/
│       └── utils/
├── public/                          # Static public assets
├── tests/
│   ├── e2e/
│   └── unit/
├── docs/
│   └── architecture/
├── .agentdocs/                      # Training docs and local progress artifacts
└── package.json
```

## Placement Rules

- `src/app`: route declarations only. Keep pages, layouts, and API `route.ts` files thin.
- `src/features/<feature>`: user-facing product modules. Put feature-specific React components, hooks, client utilities, server helpers, and types here.
- `src/components`: reusable UI that has no business-domain dependency.
- `src/server`: Node.js-only code, including model calls, agents, workflows, tools, and storage adapters.
- `src/config`: environment and runtime configuration. Do not read `process.env` from random modules.
- `src/shared`: small cross-cutting utilities, shared errors, constants, and types that are safe to import broadly.
- `tests`: unit and e2e tests. Test files should mirror the module they cover.

## Import Rules

- Use `@/*` for imports from `src`.
- UI code can import from `features`, `components`, and browser-safe `shared` modules.
- Server code can import from `config`, `server`, and `shared`.
- Avoid importing `src/server/*` from client components.
- Prefer feature-local files first. Promote code to `shared` only after more than one feature needs it.
