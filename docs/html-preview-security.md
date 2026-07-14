# HTML Preview Security

Day 13 established the preview boundary; Day 14 routes real model output through it. The product UI treats every generated document as untrusted, even when it was created from a validated `PageContentDSL`.

## Preview pipeline

```text
PageContentDSL
  + server-resolved FunctionalTemplate / StyleTemplate / VisualBrief
  -> HtmlEngineerAgent
  -> GeneratedHtmlContract + DSL marker validation
  -> sanitizeHtmlLite preflight on the server
  -> optional revalidated browser preview cache
  -> contract + preflight again on the client
  -> <iframe srcDoc sandbox="">
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

`HtmlPreviewFrame` uses `srcDoc` with an empty `sandbox` token list. No capability is opted back in.

| Capability | Day 13 policy | Reason |
| --- | --- | --- |
| Scripts | blocked | Day 14 uses native static interaction patterns; executable interaction needs a later explicit policy decision. |
| Same-origin identity | blocked | The preview receives an opaque origin instead of sharing the Seaca application origin. |
| Forms | blocked | Generated content must not submit learner data. |
| Popups and downloads | blocked | Preview content must not create new browsing or download flows. |
| Top navigation | blocked | Generated HTML cannot replace or redirect the product shell. |
| Referrer | `no-referrer` | Preview resource requests must not receive the product URL as referrer metadata. |

Do not combine `allow-scripts` and `allow-same-origin` for same-origin preview content. If a later interaction requires scripts, it needs a separate threat-model review, a narrow message protocol, and preferably a dedicated preview origin.

## iframe sandbox and CSP sandbox

The iframe `sandbox` attribute is applied by the embedding product and is the primary Day 13 boundary for `srcDoc` content. CSP `sandbox` is delivered as an HTTP response header by the preview resource; it is not supported in a CSP meta element. A future separately served preview document can add CSP headers and a resource allowlist as defense in depth.

## Known limits and next steps

- Remote image asset allowlisting is deferred until the real asset pipeline is introduced.
- The preview does not yet use `postMessage`; any future message must validate origin, type, and payload shape.
- Day 14 caps a generated document at 200,000 characters; a future QA stage should add parsed DOM-complexity limits.
- `/preview/[previewId]` uses temporary browser storage because course-run persistence is not implemented yet. The record is untrusted and is validated again on read and render.
- Browser storage is not durable course history. Once persistence exists, `/course` should own the artifact and preview URLs should resolve through authorized backend records.
