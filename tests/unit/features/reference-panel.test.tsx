import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReferencePanel } from "../../../src/features/keya/reference-panel";
import { PagePlanSchema } from "../../../src/shared/course-schema";
import pagePlan from "../../../src/shared/course-schema/examples/page-plan.example.json";

describe("ReferencePanel", () => {
  it("shows grounded facts and the pages that use a pack", () => {
    const packId = "ref-1234567890abcdef12345678";
    const markup = renderToStaticMarkup(
      <ReferencePanel
        packs={[
          {
            version: 1,
            id: packId,
            sourceName: "solar.md",
            sourceType: "md",
            byteSize: 80,
            summary: "太阳风资料摘要。",
            keyFacts: [
              {
                text: "太阳风包含带电粒子。",
                chunkIds: ["chunk-01"],
              },
            ],
            chunks: [
              {
                id: "chunk-01",
                index: 1,
                text: "太阳风包含带电粒子。",
              },
            ],
            truncated: false,
          },
        ]}
        pages={[
          PagePlanSchema.parse({
            ...pagePlan,
            pageType: "cover",
            interactionType: "navigate",
            status: "planned",
            usedReferences: [
              { referencePackId: packId, chunkIds: ["chunk-01"] },
            ],
          }),
        ]}
      />,
    );

    expect(markup).toContain("太阳风资料摘要");
    expect(markup).toContain("太阳风包含带电粒子");
    expect(markup).toContain(`用于：${pagePlan.title}`);
  });
});
