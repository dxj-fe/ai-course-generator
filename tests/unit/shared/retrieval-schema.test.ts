import { describe, expect, it } from "vitest";

import {
  SkillCardSchema,
  TemplateCardSchema,
  ToolCardSchema,
} from "../../../src/shared/course-schema";

const baseCard = {
  id: "sample-card",
  name: "示例能力",
  description: "用于验证统一 Card 合同。",
  whenToUse: ["需要验证 Card 时"],
  inputSchemaSummary: "一个类型化输入。",
  outputSummary: "一个类型化输出。",
  limitations: ["仅供测试"],
};

describe("retrieval card schemas", () => {
  it("validates strict ToolCard and SkillCard contracts", () => {
    expect(
      ToolCardSchema.parse({
        ...baseCard,
        kind: "tool",
        keywords: ["测试"],
      }),
    ).toMatchObject({ id: "sample-card", kind: "tool" });
    expect(
      SkillCardSchema.safeParse({
        ...baseCard,
        kind: "skill",
        agentNames: ["planner"],
        keywords: ["测试"],
        privatePrompt: "must not pass",
      }).success,
    ).toBe(false);
  });

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
