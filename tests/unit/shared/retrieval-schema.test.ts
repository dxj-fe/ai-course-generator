import { describe, expect, it } from "vitest";

import { TemplateCardSchema } from "../../../src/shared/course-schema";

const baseCard = {
  id: "sample-card",
  name: "示例能力",
  description: "用于验证统一 Card 合同。",
  whenToUse: ["需要验证 Card 时"],
  inputSchemaSummary: "一个类型化输入。",
  outputSummary: "一个类型化输出。",
  limitations: ["仅供测试"],
};

describe("template retrieval card schema", () => {
  it("requires the discriminator-specific template field", () => {
    expect(
      TemplateCardSchema.safeParse({
        ...baseCard,
        kind: "functional-template",
        tags: ["quiz"],
      }).success,
    ).toBe(false);
    expect(
      TemplateCardSchema.safeParse({
        ...baseCard,
        kind: "style-template",
        tags: ["minimal"],
        visualStyle: "minimal",
      }).success,
    ).toBe(true);
  });
});
