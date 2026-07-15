# Product UI Integration Contract

The Seaca interface is the product shell. Training-day features extend its behavior; they do not create a parallel training-console UI.

## Stable product surfaces

| Product concern | Canonical surface | State responsibility |
| --- | --- | --- |
| Discover prompts and example courses | `/` | Display-only discovery data and links into `/chat` |
| Create a course from a prompt | `/chat` composer | Draft and task creation UI state |
| Explain Agent progress | `/chat` thread | Structured public events, status, errors, retry/cancel affordances |
| Inspect course and page artifacts | `/chat` right learning workspace | Course, page, preview, asset, QA, and export views |
| Browse generated/history items | `/course` | Persisted course/run queries and filters |
| Inspect functional/style templates | `/templates` | Template registry and preview data |

`AiPlayground` and the older course-planner panels remain implementation references. They must not replace `/` or become the visual foundation for new tasks.

## Handbook capability map

- Days 1–6: model calls, tool calls, and Agent events feed the `/chat` controller and public event timeline.
- Days 7–12: `CourseIntent`, `CoursePlan`, professional briefs, and `PageContentDSL` render in the learning workspace.
- Days 13–18: sandboxed HTML previews, assets, and multi-page results extend the learning workspace; generated HTML stays outside long-lived React UI state when persistence is available.
- Day 13 (implemented): each completed Page DSL established the shared HTML contract, lightweight security preflight, and empty-policy `sandbox` iframe boundary inside the `/chat` learning workspace.
- Day 14 (implemented): `HtmlEngineerAgent` replaces the deterministic demo source with model-generated single-page HTML. Generation state and public validation events stay in `/chat`; the learning workspace provides quick preview, while `/preview/[previewId]` provides a large, session-local artifact view backed by revalidated browser storage. Neither surface relaxes the Day 13 iframe boundary.
- Day 15 (implemented): a report-only `PageQAAgent` combines deterministic HTML/layout heuristics with semantic six-dimension evaluation. Per-page QA state and public events stay in `/chat`; actionable scores and issues render beside the generated page, while the independent preview receives only an optional schema-validated report from the controller. QA never mutates HTML and does not introduce Repair behavior.
- Day 16 (implemented): `ImagePromptAgent` compiles each Page DSL asset slot into a constrained request for a background, character sticker, icon, or texture. A server-only image Skill validates and stores real raster output behind `/api/assets/[assetId]`; every provider or format failure becomes an explicit CSS/SVG/placeholder fallback, so HTML generation can continue. Page-scoped asset state, public events, and `AssetGallery` live in the `/chat` learning workspace. HTML Engineer may reference only approved internal URIs and always keeps text, interaction, and layout as HTML.
- Day 17 (implemented): page asset resolution now reuses a server-only compiled request set for the same Page DSL, VisualBrief, and Image Prompt version before resolving each ready image through a prompt/style/aspect/model content key. This prevents nondeterministic Prompt wording from causing another image-provider call on a same-page repeat. Missing backing files become stale misses, while cache read/write failures and provider fallbacks remain recoverable. Public request-set/image hit, miss, stale, and fallback counts flow through the existing Image Assets event summaries in `/chat`; the learning workspace continues to compose approved background and character assets with real HTML text instead of introducing cache controls or a second UI.
- Days 19–20: SSE replaces the Planner client's batch transport. Existing appendable event views remain unchanged.
- Days 21–31: Supervisor, Page Worker, QA, Repair, and LangGraph events add typed timeline rows and page-level progress; the frontend never consumes framework-native chunks directly.
- Days 32–33: uploads and reference/template retrieval use composer attachments and workspace reference panels.
- Days 34–36: run history moves into `/course`; preview, export, cancellation, and acceptance states remain in the same product shell.

## Frontend boundaries

1. API clients translate HTTP/SSE payloads into shared typed task data.
2. A task controller owns task, course, and page state. Presentational components do not call APIs.
3. `ChatComposer` owns no business logic; it emits user intent and reflects busy/cancel state.
4. `ChatThread` shows conversation content and public execution summaries, not private reasoning.
5. The learning workspace renders structured artifacts and page actions. It should remain transport-agnostic.
6. Route handlers and Agent workflows remain the business source of truth; UI components must not duplicate planning rules.

## UI primitives

- Reusable controls come from the local shadcn/ui source in `src/components/ui`; add only the primitives a product surface needs.
- Product components import icons directly from `lucide-react`. Do not add a second hand-written SVG icon layer.
- The Seaca tokens and existing product classes remain the visual source of truth. Adopting a primitive must not silently change spacing, color, typography, responsive behavior, or interaction state.
- Keep native semantic elements when a shadcn primitive would change the intended behavior, such as disclosure content or an existing radio group.

When a later task needs a new panel, first place it in one of these surfaces. Add a new product route only when the artifact has its own durable URL and cannot be represented by the existing shell.

The Day 14 preview route is the current exception for a generated artifact that benefits from a full canvas. Until backend run persistence exists, its random preview ID resolves through temporary browser storage; `/course` remains the future durable history owner.
