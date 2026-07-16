import { describe, expect, it } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildPageWriterPrompts } from "../../../../src/server/prompts/page-writer";
import { getFunctionalTemplate } from "../../../../src/shared/templates/functional";

describe("Page Writer prompts", () => {
  it("states the allowed content density values", async () => {
    const pagePlan = courseDesignOutline.pages[1];
    const functionalTemplate = getFunctionalTemplate(
      pagePlan.functionalTemplateId,
    );

    expect(functionalTemplate).toBeDefined();

    const prompts = await buildPageWriterPrompts({
      courseIntent: courseDesignIntent,
      pagePlan,
      pageWorkerBrief: {
        pageId: pagePlan.id,
        styleTemplateId: visualBrief.styleTemplateId,
        pedagogy: pedagogyPlan.pageGuidance[1],
        story: storyArc.pageBeats[1],
        visual: visualBrief.pageGuidance[1],
      },
      functionalTemplate,
    });

    expect(prompts.version).toBe("2.0.0/2.0.0");
    expect(prompts.systemPrompt).toContain(
      "contentDensity 只能是 sparse、balanced、dense",
    );
  });
});
