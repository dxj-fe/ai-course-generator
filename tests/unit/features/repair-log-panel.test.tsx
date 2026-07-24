import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RepairLogPanel } from "../../../src/features/keya/repair-log-panel";
import { qualityReportWithIssue } from "../../fixtures/quality-report";

describe("RepairLogPanel", () => {
  it("renders only public round metadata and summaries", () => {
    const markup = renderToStaticMarkup(
      <RepairLogPanel
        attempts={[
          {
            round: 1,
            sourceReport: qualityReportWithIssue({
              code: "LAYOUT_OVERFLOW",
              dimension: "layoutQuality",
              selector: "style",
            }),
            targetArtifact: "html",
            issueCodes: ["LAYOUT_OVERFLOW"],
            status: "applied",
            changeSummary: ["限制页面宽度。"],
            startedAt: "2026-07-16T10:00:00+08:00",
            completedAt: "2026-07-16T10:01:00+08:00",
          },
        ]}
      />,
    );

    expect(markup).toContain("Repair 记录");
    expect(markup).toContain("第 1 轮 · HTML");
    expect(markup).toContain("LAYOUT_OVERFLOW");
    expect(markup).toContain("限制页面宽度。");
    expect(markup).not.toContain("sourceReport");
  });
});
