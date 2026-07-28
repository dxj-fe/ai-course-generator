# HTML Preview Security

Day 13 established the preview boundary; Day 14 routes real model output through it. The product UI treats every generated document as untrusted, even when it was created from a validated `PageContentDSL`.

## Preview pipeline

```text
PageContentDSL
  + server-resolved FunctionalTemplate / StyleTemplate / VisualBrief
  -> HtmlEngineerAgent
  -> GeneratedHtmlContract + DSL/runtime marker validation
  -> sanitizeHtmlLite preflight on the server
  -> optional revalidated browser preview cache
  -> contract + preflight again on the client
  -> diagnostics: <iframe srcDoc sandbox="">
  -> learner: inject platform-owned runtime
  -> <iframe srcDoc sandbox="allow-scripts">
```

## Generated HTML contract

`validateGeneratedHtmlContract` rejects documents that omit any of these required parts:

- `<!doctype html>`
- complete `html`, `head`, and `body` elements
- a viewport meta element
- an inline `style` element

This contract is a quality and interoperability check. It does not decide whether a document is safe.

## Lightweight security preflight

`sanitizeHtmlLite` rejects obvious capabilities that do not belong in a course preview:

- external and inline scripts
- external nested iframes
- inline `on*` event attributes
- `javascript:` URLs
- meta refresh redirects
- `object`, `embed`, and `base` elements
- external stylesheets and remote CSS imports

The function returns structured issues and never silently rewrites the document. Despite its handbook name, it is deliberately a preflight validator, not a complete sanitizer. String checks cannot safely model every browser parsing edge case, SVG/CSS execution path, or encoded payload.

## iframe policy

`HtmlPreviewFrame` has two policies. Diagnostic previews keep the original empty
token list. The learner player may add only `allow-scripts`, after the document
passes the generated HTML contract and security preflight, so a fixed
platform-owned runtime can render motion and feedback. Generated HTML is still
forbidden from containing scripts.

| Capability | Diagnostic preview | Learner player | Reason |
| --- | --- | --- |
| Scripts | blocked | platform runtime only | Generated scripts fail preflight; only the audited runtime is injected afterward. |
| Same-origin identity | blocked | blocked | The preview keeps an opaque origin and never combines `allow-scripts` with `allow-same-origin`. |
| Forms | blocked | blocked | Learner input is handled locally; it cannot submit data. |
| Popups and downloads | blocked | blocked | Preview content cannot create new browsing or download flows. |
| Top navigation | blocked | blocked | Generated HTML cannot replace or redirect the product shell. |
| External network | unavailable to generated content | unavailable to generated content | External URLs, scripts, stylesheets and frames fail preflight; browser QA aborts every request except approved internal assets. |
| Referrer | `no-referrer` | `no-referrer` | Preview resource requests must not receive the product URL as referrer metadata. |

The runtime sends only schema-validated `section-ready`,
`interaction-started`, `interaction-submitted`, `section-completed`, and
`section-error` messages. The host checks the exact iframe `contentWindow`,
channel, page ID, runtime version, event type, and payload shape before updating
learning state.

## iframe sandbox and CSP sandbox

The iframe `sandbox` attribute is applied by the embedding product and is the primary Day 13 boundary for `srcDoc` content. CSP `sandbox` is delivered as an HTTP response header by the preview resource; it is not supported in a CSP meta element. A future separately served preview document can add CSP headers and a resource allowlist as defense in depth.

## Known limits and next steps

- Day 14 caps a generated document at 200,000 characters; a future QA stage should add parsed DOM-complexity limits.
- `/preview/[previewId]` uses a 24-hour SQLite record. The record remains untrusted and is validated again on database read and render.
- Temporary preview records are not durable course history. `/course` owns durable artifacts; random preview IDs only resolve expiring backend records.
- The opaque sandbox origin prevents useful origin matching for `srcDoc`; the
  host therefore validates message source identity and a strict data schema.
- If learner content later needs broader network or storage capabilities, move
  it to a dedicated preview origin and repeat the threat-model review first.
