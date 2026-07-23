# Reliability and cost controls

Day 35 keeps reliability rules in the server runtime. The Seaca UI emits task
intent and renders typed public state; it never selects models, reads caches, or
controls provider retries.

## Timeout and cancellation

- Text calls default to 30 seconds; structured calls default to 60 seconds.
  HTML Engineer uses a separate 120-second budget because it returns a complete
  self-contained document; `AI_HTML_TIMEOUT_MS` can override it from 30 to 300
  seconds for a slower local provider. Repair keeps its explicit finite
  120-second budget.
- Image generation combines the task signal with a 60-second provider timeout.
- `DELETE /api/courses/tasks/[taskId]` is the explicit cancellation boundary.
  The task service persists the cancelled course/task terminal state before it
  aborts the active runner and publishes one terminal SSE message.
- The same task `AbortSignal` reaches Workflow, Agent, Tool, language-model and
  image-provider calls. Image work checks it before and after cache, Prompt and
  provider boundaries and between asset slots.
- A task abort is never converted to an image fallback. It must stop later image,
  cache, HTML and QA work. Provider failures that are not task cancellation may
  still use the existing CSS/SVG/placeholder fallback.

Closing an EventSource or navigating away is not task cancellation. The client
must call the cancellation endpoint.

## Model routing

`src/server/ai/model-router.ts` maps a server-owned capability to one tier:

| Tier | Current capabilities | Transient fallback |
| --- | --- | --- |
| `cheap` | Intent, Supervisor, reference summary, template selector | none |
| `balanced` | professional design, Page Writer, Image Prompt, single-page demo, general calls | `cheap` |
| `strong` | Planner, HTML Engineer, Page QA, Repair | `balanced` |

Each tier may use `ARK_MODEL_ID_<TIER>` or `MODEL_NAME_<TIER>`. A missing tier
reuses the legacy `ARK_MODEL_ID` or `MODEL_NAME`, so existing deployments keep
working. When primary and fallback resolve to the same provider/model identity,
the duplicate fallback call is removed.

The router is deterministic. Prompts, model output and frontend state cannot
change the tier.

## Retry and degradation

The AI client permits at most one fallback call for a 429, selected 5xx, rate
limit, or explicit timeout. It does not retry:

- task cancellation or `AbortError`;
- structured-output/Schema validation failure;
- business validation failure;
- configuration or authentication failure.

Schema normalization and the existing bounded Agent/Supervisor retry budgets
remain business-layer concerns. Model fallback does not expand those budgets.
Cache failures are fail-open: execution continues against the model. Image
provider failures retain the existing deterministic visual fallback unless the
task itself was cancelled.

## Structured result cache

The Day 35 cache is an in-process LRU-like Map with 128 entries and a 15-minute
TTL. It covers validated Intent, Planner model drafts and active Template Card
searches. It never stores errors, cancellations, partial streams, Repair output,
raw reference chunks or image bytes.

Every key includes:

- cache namespace and normalized semantic input;
- Prompt or Registry version;
- exact provider/model identity (or `deterministic-registry`);
- output Schema version.

Objects are canonicalized by sorted keys and values are cloned on read/write.
Changing input, Prompt, model or Schema creates a miss. This cache is deliberately
small and process-local; a multi-instance deployment must replace it with a
shared bounded cache and an explicit privacy/retention policy.

## Cost and public observability

Server AI completion logs include `traceId`, capability, selected tier/model,
duration, provider usage, cache status and a bounded fallback reason. They do not
include system/user Prompts, uploaded reference text, DSL/HTML, credentials,
private event data or reasoning.

The current product UI does not add a cost dashboard. `/chat` continues to show
only validated public task/Agent/page summaries, cancellation, errors, retry and
terminal state through the existing SSE → API client → Task Controller flow.

## Verification

Automated coverage must prove:

1. task cancellation reaches active model/image work and prevents the next asset;
2. one transient strong-model failure falls back once, while Abort does not;
3. cache keys change with Prompt, model, Schema or input;
4. only schema-valid values are cached and expired/old values are removed;
5. existing task cancellation persists and publishes one terminal state.

Real-provider acceptance is separate from automated tests because it incurs cost:
start a multi-asset course, cancel during the first image, and confirm provider
logs show no later image call; then repeat one Intent/Planner input in the same
server process and confirm a cache hit with no second provider call.
