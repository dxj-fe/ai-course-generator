import { describe, expect, it } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
} from "../../../fixtures/course-design";
import { buildPedagogyPrompts } from "../../../../src/server/prompts/pedagogy";
import { buildStoryPrompts } from "../../../../src/server/prompts/story";

describe("professional brief prompts", () => {
  it("keeps pedagogy guidance aligned with one fixed-canvas interaction", async () => {
    const prompts = await buildPedagogyPrompts({
      courseIntent: courseDesignIntent,
      coursePlan: courseDesignOutline,
    });

    expect(prompts.version).toBe("2.1.0/2.0.0");
    expect(prompts.systemPrompt).toContain(
      "choice 页面只检查 1 个最关键判断",
    );
    expect(prompts.systemPrompt).toContain("友好但不幼稚");
    expect(prompts.systemPrompt).toContain(
      "先呈现情节证据，再归纳人物特质",
    );
  });

  it("prevents story beats from inventing unsupported task counts", async () => {
    const prompts = await buildStoryPrompts({
      courseIntent: courseDesignIntent,
      coursePlan: courseDesignOutline,
      pedagogyPlan,
    });

    expect(prompts.version).toBe("2.1.0/2.0.0");
    expect(prompts.systemPrompt).toContain("扩写成“完成 3 道测验”");
    expect(prompts.systemPrompt).toContain("不过度儿童化");
    expect(prompts.systemPrompt).toContain("相邻 pageBeat 必须有实质推进");
  });
});
