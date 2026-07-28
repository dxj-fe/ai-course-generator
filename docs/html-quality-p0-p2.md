# Generated HTML quality: P0–P2

The implementation keeps the current 课芽 product and generation workflow. It
adds stronger contracts and evidence at the points where low-quality HTML used
to pass.

## P0 — release gate

- Playwright evidence is mandatory for production Page QA.
- Required viewports are the real learner frame (`922×460`), tablet
  (`712×650`), and mobile (`366×500`).
- Browser checks cover overflow, clipping, first-screen action placement,
  touch-target size, initial feedback leakage, choice submission and visible
  feedback, first-screen content density, and a single visual dominating the
  frame.
- Missing Chromium, an explicitly disabled capture, timeout, or write failure
  remains structured evidence but cannot produce a passing report.

## P1 — structured lesson runtime

- Page Writer emits `PageContentDSL` v2 with `LessonRuntime`; persisted v1
  courses still parse and receive a conservative player fallback.
- HTML Engineer must produce stable block, visual, interaction, item, question,
  option, submit, and feedback markers. It still cannot emit JavaScript.
- The learner player injects an audited fixed runtime after validation, enables
  only `allow-scripts`, respects reduced-motion, and emits a strict
  `postMessage` protocol.
- Choice feedback appears only after submission. Required interactions control
  section completion and local progress persistence.

## P2 — regression loop

The repository includes 20 diverse cases in
`docs/demo/quality-benchmark-prompts.json`. After generating matching baseline
and candidate checkpoints, compare them with:

```bash
npm run quality:compare -- baseline-course.json candidate-course.json
```

The comparison reports screenshot capture rate, overall and visual averages,
error counts, interaction errors, a composite score, and page-by-page winners.
It exits non-zero when the baseline wins, so it can be used in CI.

This benchmark is deterministic over persisted reports. Human visual review is
still appropriate for final style direction; it complements rather than
replaces the automated release gate.
