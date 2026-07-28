import { describe, expect, it } from "vitest";

import {
  claimsMultipleChoiceQuestions,
  normalizeSingleChoiceWording,
} from "../../../../src/server/agents/core/fixed-canvas-language";

describe("fixed-canvas language", () => {
  it("recognizes and normalizes multi-question wording with an intervening topic", () => {
    const wording = "设置3道关于猴王出世情节和人物特质的选择题。";

    expect(claimsMultipleChoiceQuestions(wording)).toBe(true);
    expect(normalizeSingleChoiceWording(wording)).toBe(
      "设置1道关于猴王出世情节和人物特质的选择题。",
    );
  });

  it("normalizes multi-digit and compound Chinese counts as a whole", () => {
    expect(normalizeSingleChoiceWording("完成12道选择题。")).toBe(
      "完成1道选择题。",
    );
    expect(normalizeSingleChoiceWording("完成十二道测验题。")).toBe(
      "完成1道测验题。",
    );
  });

  it("does not alter counts that describe knowledge rather than questions", () => {
    const wording = "比较3个关键情节，并完成这道选择题。";

    expect(claimsMultipleChoiceQuestions(wording)).toBe(false);
    expect(normalizeSingleChoiceWording(wording)).toBe(wording);
  });
});
