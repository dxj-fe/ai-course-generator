import { describe, expect, it, vi } from "vitest";

import {
  courseDesignIntent,
  courseDesignOutline,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../../fixtures/course-design";
import {
  createPedagogyModelStep,
  createPedagogyModelStepState,
} from "../../../../src/server/agent/plugins/model-steps/course/pedagogy-model-step";
import {
  createStoryModelStep,
  createStoryModelStepState,
} from "../../../../src/server/agent/plugins/model-steps/course/story-model-step";
import {
  createVisualBriefModelStep,
  createVisualBriefModelStepState,
} from "../../../../src/server/agent/plugins/model-steps/course/visual-brief-model-step";
import {
  runCourseDesignWorkflow,
  validateCourseDesignBriefs,
  type CourseDesignWorkflowDependencies,
} from "../../../../src/server/course/service/design";

describe("course design workflow", () => {
  it("runs three model steps serially and builds Page Worker handoffs", async () => {
    const order: string[] = [];
    const dependencies = createDependencies(order);
    const result = await runCourseDesignWorkflow(
      { intent: courseDesignIntent, outline: courseDesignOutline },
      { traceId: "course-design-test" },
      dependencies,
    );

    expect(result.status).toBe("completed");
    expect(order).toEqual(["pedagogy", "story", "visual"]);
    expect(result.events).toHaveLength(9);
    expect(result.events.map(({ sequence }) => sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(result.pageWorkerBriefs).toHaveLength(3);
    expect(result.pageWorkerBriefs?.[1]).toEqual(
      expect.objectContaining({
        pageId: "page-02-knowledge",
        styleTemplateId: "sci-fi",
      }),
    );
  });

  it("stops before StoryModelStep when PedagogyModelStep fails", async () => {
    const runStory = vi.fn();
    const runVisual = vi.fn();
    const dependencies: CourseDesignWorkflowDependencies = {
      runPedagogy: async (intent, outline, context) =>
        createPedagogyModelStep({
          generatePlan: async () => {
            throw new Error("pedagogy unavailable");
          },
        }).run(createPedagogyModelStepState(intent, outline), context),
      runStory,
      runVisual,
    };
    const result = await runCourseDesignWorkflow(
      { intent: courseDesignIntent, outline: courseDesignOutline },
      { traceId: "course-design-failure" },
      dependencies,
    );

    expect(result.status).toBe("failed");
    expect(result.error?.agent).toBe("pedagogy");
    expect(result.error).toMatchObject({
      code: "MODEL_ERROR",
      message: "模型服务未返回有效结果，请稍后重试。",
    });
    expect(runStory).not.toHaveBeenCalled();
    expect(runVisual).not.toHaveBeenCalled();
  });

  it("rejects a brief whose page order drifts from CoursePlan", () => {
    const invalidPedagogy = structuredClone(pedagogyPlan);
    invalidPedagogy.pageGuidance.reverse();

    expect(() =>
      validateCourseDesignBriefs(courseDesignOutline, {
        pedagogy: invalidPedagogy,
        story: storyArc,
        visual: visualBrief,
      }),
    ).toThrow("必须按 CoursePlan 顺序覆盖全部页面");
  });
});

/** 构造真实最小模型步骤，使工作流测试同时覆盖事件聚合和串行交接。 */
function createDependencies(
  order: string[],
): CourseDesignWorkflowDependencies {
  return {
    runPedagogy: async (intent, outline, context) => {
      order.push("pedagogy");
      return createPedagogyModelStep({
        generatePlan: async () => pedagogyPlan,
      }).run(createPedagogyModelStepState(intent, outline), context);
    },
    runStory: async (input, context) => {
      order.push("story");
      return createStoryModelStep({ generateArc: async () => storyArc }).run(
        createStoryModelStepState(input),
        context,
      );
    },
    runVisual: async (input, context) => {
      order.push("visual");
      return createVisualBriefModelStep({
        generateBrief: async () => visualBrief,
      }).run(createVisualBriefModelStepState(input), context);
    },
  };
}
