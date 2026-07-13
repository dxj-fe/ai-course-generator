import { describe, expect, it, vi } from "vitest";

import {
  createSinglePageAgent,
  createSinglePageAgentState,
} from "../../../../src/server/agents/single-page-agent";
import { PagePlanDraftSchema } from "../../../../src/shared/course-schema";

const pagePlan = {
  title: "太阳系互动问答",
  learningObjective: "学习者能够识别太阳系中的主要行星。",
  sections: [
    { title: "快速回顾", purpose: "唤起学习者已有知识。" },
    { title: "互动问答", purpose: "通过选择题检查理解。" },
  ],
  functionalTemplateId: "interactive-quiz",
  visualDirection: "使用清晰的行星图标和即时反馈状态。",
};

describe("SinglePageAgent", () => {
  it("selects a template and generates a structured PagePlan", async () => {
    const selectTemplate = vi.fn().mockResolvedValue({
      toolCalls: [{ toolName: "searchFunctionalTemplate" }],
      toolResults: [
        {
          toolName: "searchFunctionalTemplate",
          output: {
            templates: [
              {
                id: "interactive-quiz",
                name: "互动问答",
                reason: "匹配关键词：互动、问答",
              },
            ],
          },
        },
      ],
    });
    const generatePagePlan = vi.fn().mockResolvedValue(pagePlan);
    const agent = createSinglePageAgent({
      selectTemplate,
      generatePagePlan,
    });

    const result = await agent.run(
      createSinglePageAgentState({
        pageGoal: "设计一个太阳系互动问答页面",
        audience: "8 岁儿童",
      }),
      { traceId: "single-page-test" },
    );

    expect(result.status).toBe("completed");
    expect(result.pagePlan).toEqual(pagePlan);
    expect(result.events.map(({ type }) => type)).toEqual([
      "start",
      "model_call",
      "tool_call",
      "model_call",
      "finish",
    ]);
    expect(generatePagePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedTemplate: expect.objectContaining({
          templateId: "interactive-quiz",
        }),
      }),
    );
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("rejects PagePlan drafts without a selected template id", () => {
    expect(
      PagePlanDraftSchema.safeParse({
        ...pagePlan,
        functionalTemplateId: undefined,
      }).success,
    ).toBe(false);
  });
});
