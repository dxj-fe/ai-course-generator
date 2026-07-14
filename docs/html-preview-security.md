# HTML Preview Security

Day 13 adds a narrow preview boundary for AI-authored HTML. The product UI treats every generated document as untrusted, even when it was created from a validated `PageContentDSL`.

## Preview pipeline

```text
PageContentDSL
  -> deterministic Day 13 demo HTML
  -> GeneratedHtmlContract
  -> sanitizeHtmlLite preflight
  -> <iframe srcDoc sandbox="">
```

The demo builder exists only to exercise the preview architecture before Day 14 introduces `HtmlEngineerAgent`. It is derived during render and is not stored as long-lived React state.

## Generated HTML contract

`validateGeneratedHtmlContract` rejects documents that omit any of these required parts:

- `<!doctype html>`
- complete `html`, `head`, and `body` elements
- a viewport meta element
- an inline `style` element

This contract is a quality and interoperability check. It does not decide whether a document is safe.

## Lightweight security preflight

`sanitizeHtmlLite` rejects obvious capabilities that do not belong in a course preview:

- external scripts
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
| Scripts | blocked | Day 13 preview is static; interactive HTML belongs to a later explicit policy decision. |
| Same-origin identity | blocked | The preview receives an opaque origin instead of sharing the Seaca application origin. |
| Forms | blocked | Generated content must not submit learner data. |
| Popups and downloads | blocked | Preview content must not create new browsing or download flows. |
| Top navigation | blocked | Generated HTML cannot replace or redirect the product shell. |
| Referrer | `no-referrer` | Preview resource requests must not receive the product URL as referrer metadata. |

Do not combine `allow-scripts` and `allow-same-origin` for same-origin preview content. If a later interaction requires scripts, it needs a separate threat-model review, a narrow message protocol, and preferably a dedicated preview origin.

## iframe sandbox and CSP sandbox

The iframe `sandbox` attribute is applied by the embedding product and is the primary Day 13 boundary for `srcDoc` content. CSP `sandbox` is delivered as an HTTP response header by the preview resource; it is not supported in a CSP meta element. A future separately served preview document can add CSP headers and a resource allowlist as defense in depth.

## Known limits and next steps

- The Day 13 builder produces static HTML; it is not the final visual-quality generator.
- Remote image asset allowlisting is deferred until the real asset pipeline is introduced.
- The preview does not yet use `postMessage`; any future message must validate origin, type, and payload shape.
- Resource size and DOM-complexity limits should be added before accepting arbitrary model HTML at scale.
- Day 14 must run both validators on the server immediately after HTML generation and preserve the same iframe boundary in the client.

