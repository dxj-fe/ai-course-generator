import {
  runPedagogyModelStep,
  type PedagogyModelStepState,
} from "@/server/agent/plugins/model-steps/course/pedagogy-model-step";
import {
  runStoryModelStep,
  type StoryModelStepState,
} from "@/server/agent/plugins/model-steps/course/story-model-step";
import {
  runVisualBriefModelStep,
  type VisualBriefModelStepState,
} from "@/server/agent/plugins/model-steps/course/visual-brief-model-step";
import type {
  ModelStepContext,
  ModelStepEvent,
} from "@/server/agent/plugins/model-steps/course/types";
import { AiSchemaValidationError } from "@/server/infra/ai/error";
import {
  CourseDesignBriefsSchema,
  PageWorkerBriefSchema,
  type CourseDesignBriefs,
  type CourseIntent,
  type CoursePlan,
  type PageWorkerBrief,
} from "@/shared/course-schema";
import { getStyleTemplate } from "@/shared/templates/style";

export type CourseDesignStepName =
  | "pedagogy"
  | "story"
  | "visual";

export type CourseDesignEvent = ModelStepEvent & {
  /** 兼容现有前端协议；这里表示模型步骤来源，不代表它是自主 Agent。 */
  agent: CourseDesignStepName;
};

export type CourseDesignWorkflowState = {
  status: "completed" | "failed";
  events: CourseDesignEvent[];
  briefs?: CourseDesignBriefs;
  pageWorkerBriefs?: PageWorkerBrief[];
  error?: {
    agent: CourseDesignStepName | "workflow";
    code: string;
    message: string;
  };
};

export type CourseDesignWorkflowDependencies = {
  runPedagogy(
    intent: CourseIntent,
    outline: CoursePlan,
    context: ModelStepContext,
  ): Promise<PedagogyModelStepState>;
  runStory(
    input: {
      intent: CourseIntent;
      outline: CoursePlan;
      pedagogy: NonNullable<PedagogyModelStepState["plan"]>;
    },
    context: ModelStepContext,
  ): Promise<StoryModelStepState>;
  runVisual(
    input: {
      intent: CourseIntent;
      outline: CoursePlan;
      pedagogy: NonNullable<PedagogyModelStepState["plan"]>;
      story: NonNullable<StoryModelStepState["arc"]>;
    },
    context: ModelStepContext,
  ): Promise<VisualBriefModelStepState>;
};

const defaultDependencies: CourseDesignWorkflowDependencies = {
  runPedagogy: runPedagogyModelStep,
  runStory: runStoryModelStep,
  runVisual: runVisualBriefModelStep,
};

/**
 * 串行生成教学、叙事和视觉 brief。
 * 后一步只消费前一步已校验的输出，失败后立即停止，避免无效模型调用。
 */
export async function runCourseDesignWorkflow(
  input: { intent: CourseIntent; outline: CoursePlan },
  context: ModelStepContext,
  dependencies: CourseDesignWorkflowDependencies = defaultDependencies,
): Promise<CourseDesignWorkflowState> {
  const events: CourseDesignEvent[] = [];

  const pedagogyState = await dependencies.runPedagogy(
    input.intent,
    input.outline,
    context,
  );
  appendStepEvents(events, "pedagogy", pedagogyState.events);

  if (pedagogyState.status !== "completed" || !pedagogyState.plan) {
    return failedState(events, "pedagogy", pedagogyState.error);
  }

  const storyState = await dependencies.runStory(
    {
      ...input,
      pedagogy: pedagogyState.plan,
    },
    context,
  );
  appendStepEvents(events, "story", storyState.events);

  if (storyState.status !== "completed" || !storyState.arc) {
    return failedState(events, "story", storyState.error);
  }

  const visualState = await dependencies.runVisual(
    {
      ...input,
      pedagogy: pedagogyState.plan,
      story: storyState.arc,
    },
    context,
  );
  appendStepEvents(events, "visual", visualState.events);

  if (visualState.status !== "completed" || !visualState.brief) {
    return failedState(events, "visual", visualState.error);
  }

  try {
    const briefs = CourseDesignBriefsSchema.parse({
      pedagogy: pedagogyState.plan,
      story: storyState.arc,
      visual: visualState.brief,
    });

    validateCourseDesignBriefs(input.outline, briefs);

    return {
      status: "completed",
      events,
      briefs,
      pageWorkerBriefs: buildPageWorkerBriefs(input.outline, briefs),
    };
  } catch (error) {
    return {
      status: "failed",
      events,
      error: {
        agent: "workflow",
        code: "COURSE_DESIGN_VALIDATION_ERROR",
        message:
          error instanceof Error ? error.message : "专业 brief 校验失败。",
      },
    };
  }
}

/** 校验三个 brief 与 CoursePlan 的页面、样式和职责边界完全对齐。 */
export function validateCourseDesignBriefs(
  outline: CoursePlan,
  briefs: CourseDesignBriefs,
) {
  const expectedPageIds = outline.pages.map(({ id }) => id);
  const references = [
    ["PedagogyPlan.pageGuidance", briefs.pedagogy.pageGuidance],
    ["StoryArc.pageBeats", briefs.story.pageBeats],
    ["VisualBrief.pageGuidance", briefs.visual.pageGuidance],
  ] as const;

  for (const [field, items] of references) {
    const pageIds = items.map(({ pageId }) => pageId);

    if (JSON.stringify(pageIds) !== JSON.stringify(expectedPageIds)) {
      throw new AiSchemaValidationError(
        `${field} 必须按 CoursePlan 顺序覆盖全部页面。`,
      );
    }
  }

  const styleIds = new Set(
    outline.pages.map(({ styleTemplateId }) => styleTemplateId),
  );

  if (
    styleIds.size !== 1 ||
    !styleIds.has(briefs.visual.styleTemplateId) ||
    !getStyleTemplate(briefs.visual.styleTemplateId)
  ) {
    throw new AiSchemaValidationError(
      "VisualBrief 必须引用 CoursePlan 中唯一且真实存在的 StyleTemplate。",
    );
  }

  if (containsHtmlMarkup(briefs)) {
    throw new AiSchemaValidationError(
      "专业 brief 只能包含设计语义，不能提前生成 HTML。",
    );
  }
}

/** 把全局 brief 按 pageId 投影为每个 Page Worker 的最小输入。 */
export function buildPageWorkerBriefs(
  outline: CoursePlan,
  briefs: CourseDesignBriefs,
): PageWorkerBrief[] {
  return outline.pages.map((page) =>
    PageWorkerBriefSchema.parse({
      pageId: page.id,
      styleTemplateId: briefs.visual.styleTemplateId,
      pedagogy: briefs.pedagogy.pageGuidance.find(
        ({ pageId }) => pageId === page.id,
      ),
      story: briefs.story.pageBeats.find(({ pageId }) => pageId === page.id),
      visual: briefs.visual.pageGuidance.find(
        ({ pageId }) => pageId === page.id,
      ),
    }),
  );
}

/** 为每条公开事件补充模型步骤来源，并重新编号为一条全局时间线。 */
function appendStepEvents(
  target: CourseDesignEvent[],
  agent: CourseDesignStepName,
  events: ModelStepEvent[],
) {
  for (const event of events) {
    target.push({ ...event, agent, sequence: target.length + 1 });
  }
}

/** 将单个模型步骤失败统一映射为前端可展示的工作流错误。 */
function failedState(
  events: CourseDesignEvent[],
  agent: CourseDesignStepName,
  error: PedagogyModelStepState["error"],
): CourseDesignWorkflowState {
  return {
    status: "failed",
    events,
    error: {
      agent,
      code: error?.code ?? "AGENT_EXECUTION_ERROR",
      message: error?.message ?? `${agent} 模型步骤未生成有效结果。`,
    },
  };
}

/** 只识别真实标签形态，避免把普通的小于号或“HTML”字样误判为标记。 */
function containsHtmlMarkup(value: unknown) {
  return /<\/?(?:html|head|body|main|section|article|div|span|script|style|p|h[1-6]|button|img|svg|a)\b/i.test(
    JSON.stringify(value),
  );
}
