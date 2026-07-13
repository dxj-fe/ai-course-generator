import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/ai/client";
import { AiSchemaValidationError } from "@/server/ai/error";
import { buildCoursePlannerPrompts } from "@/server/prompts/course-planner";
import {
  CoursePlanSchema,
  PageInteractionTypeSchema,
  PageTypeSchema,
  type CourseIntent,
  type CoursePlan,
} from "@/shared/course-schema";
import {
  getFunctionalTemplate,
  listFunctionalTemplates,
} from "@/shared/templates/functional";
import { searchStyleTemplates } from "@/shared/templates/style";

import { createMinimalAgent } from "./core/minimal-agent";
import type {
  Agent,
  AgentRuntimeContext,
  AgentStateBase,
} from "./core/types";

export type CoursePlannerAgentState = AgentStateBase & {
  task: { intent: CourseIntent };
  outline?: CoursePlan;
};

export type CoursePlannerAgentDependencies = {
  generateOutline(input: {
    abortSignal?: AbortSignal;
    intent: CourseIntent;
    traceId: string;
  }): Promise<unknown>;
};

const defaultDependencies: CoursePlannerAgentDependencies = {
  generateOutline,
};

const CoursePlannerModelPageSchema = z.object({
  pageType: PageTypeSchema,
  title: z.string().min(1).max(120),
  learningObjective: z.string().min(5).max(300),
  contentSummary: z.string().min(5).max(500),
  interactionType: PageInteractionTypeSchema,
  assetNeeds: z
    .array(
      z.object({
        purpose: z.string().min(2).max(240),
        required: z.boolean(),
      }),
    )
    .max(12),
});

const CoursePlannerModelOutputSchema = z.object({
  overview: z.string().min(5).max(500),
  learningObjectives: z.array(z.string().min(5).max(300)).min(1).max(12),
  pages: z.array(CoursePlannerModelPageSchema).min(3).max(12),
});

/** 创建只负责全局结构规划的一步 CoursePlannerAgent。 */
export function createCoursePlannerAgent(
  dependencies: CoursePlannerAgentDependencies = defaultDependencies,
): Agent<CoursePlannerAgentState> {
  return createMinimalAgent({
    isComplete: (state) => Boolean(state.outline),
    step: async (state, context, emit) => {
      const outline = validateCoursePlannerOutput(
        await dependencies.generateOutline({
          abortSignal: context.abortSignal,
          intent: state.task.intent,
          traceId: context.traceId,
        }),
        state.task.intent,
      );

      emit({
        type: "model_call",
        summary: `Planner 已生成 ${outline.pages.length} 页课程结构。`,
        data: {
          pageCount: outline.pages.length,
          purpose: "course-planning",
        },
      });

      return { ...state, outline };
    },
  });
}

/** 为 CoursePlannerAgent 创建可序列化的初始状态。 */
export function createCoursePlannerAgentState(
  intent: CourseIntent,
): CoursePlannerAgentState {
  return {
    status: "idle",
    step: 0,
    maxSteps: 1,
    events: [],
    task: { intent },
  };
}

/** 使用默认依赖运行 CoursePlannerAgent。 */
export function runCoursePlannerAgent(
  intent: CourseIntent,
  context: AgentRuntimeContext,
) {
  return createCoursePlannerAgent().run(
    createCoursePlannerAgentState(intent),
    context,
  );
}

/**
 * 校验 Planner 输出的页数、模板引用和规划阶段状态。
 * 这些约束依赖当前 Registry 或输入意图，无法只靠静态 Zod Schema 表达。
 */
export function validateCoursePlannerOutput(
  output: unknown,
  intent: CourseIntent,
): CoursePlan {
  const parsed = CoursePlanSchema.safeParse(output);

  if (!parsed.success) {
    throw new AiSchemaValidationError(
      `CoursePlan 结构校验失败：${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const outline = parsed.data;
  const issues: string[] = [];
  const styleMatch = searchStyleTemplates({
    visualStyle: intent.visualStyle,
    limit: 1,
  })[0];

  if (outline.pages.length !== intent.courseLength) {
    issues.push(
      `页面数量 ${outline.pages.length} 与 courseLength ${intent.courseLength} 不一致`,
    );
  }

  for (const page of outline.pages) {
    const functionalTemplate = getFunctionalTemplate(
      page.functionalTemplateId,
    );

    if (!functionalTemplate) {
      issues.push(`页面 ${page.id} 引用了未知功能模板 ${page.functionalTemplateId}`);
    } else if (functionalTemplate.pageType !== page.pageType) {
      issues.push(
        `页面 ${page.id} 的 pageType ${page.pageType} 与模板 ${functionalTemplate.id} 不匹配`,
      );
    }

    if (page.styleTemplateId !== styleMatch?.template.id) {
      issues.push(
        `页面 ${page.id} 必须使用样式模板 ${styleMatch?.template.id ?? "unknown"}`,
      );
    }

    if (
      page.status !== "planned" ||
      page.assetIds.length > 0 ||
      page.htmlOutput
    ) {
      issues.push(`页面 ${page.id} 包含了规划阶段之外的生成结果`);
    }
  }

  if (issues.length > 0) {
    throw new AiSchemaValidationError(`CoursePlan 业务校验失败：${issues.join("；")}`);
  }

  return outline;
}

/** 调用结构化模型生成一份完整课程规划。 */
async function generateOutline(input: {
  abortSignal?: AbortSignal;
  intent: CourseIntent;
  traceId: string;
}) {
  const styleTemplate = searchStyleTemplates({
    visualStyle: input.intent.visualStyle,
    limit: 1,
  })[0]?.template;

  if (!styleTemplate) {
    throw new AiSchemaValidationError("没有找到可用的样式模板。");
  }

  const functionalTemplates = listFunctionalTemplates().map((template) => ({
    id: template.id,
    name: template.name,
    pageType: template.pageType,
    goal: template.goal,
  }));
  const prompts = await buildCoursePlannerPrompts({
    courseIntent: input.intent,
    functionalTemplates,
    styleTemplate: {
      id: styleTemplate.id,
      name: styleTemplate.name,
      goal: styleTemplate.goal,
    },
  });

  const draft = await generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    maxTokens: 6_000,
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: CoursePlannerModelOutputSchema,
    schemaDescription:
      "A 3-12 page semantic course planning draft without technical IDs or generated HTML.",
    schemaName: "course_plan_content",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    traceId: input.traceId,
  });

  return materializeCoursePlan(draft, input.intent, styleTemplate.id);
}

/**
 * 把模型负责的教学语义草稿转换为完整 PagePlan。
 * 所有 ID、依赖、模板和生命周期字段都由代码确定，避免模型编造系统状态。
 */
function materializeCoursePlan(
  draft: z.infer<typeof CoursePlannerModelOutputSchema>,
  intent: CourseIntent,
  styleTemplateId: string,
): CoursePlan {
  const orderedPages = [...draft.pages].sort(
    (left, right) =>
      getLearningPhase(left.pageType) - getLearningPhase(right.pageType),
  );
  const pages = orderedPages.map((page, index) => {
    const functionalTemplate = listFunctionalTemplates().find(
      (template) => template.pageType === page.pageType,
    );

    if (!functionalTemplate) {
      throw new AiSchemaValidationError(
        `pageType ${page.pageType} 没有对应的功能模板。`,
      );
    }

    const id = `page-${String(index + 1).padStart(2, "0")}-${page.pageType.replaceAll("_", "-")}`;
    const previousPage = index > 0 ? orderedPages[index - 1] : undefined;
    const previousId = previousPage
      ? `page-${String(index).padStart(2, "0")}-${previousPage.pageType.replaceAll("_", "-")}`
      : undefined;

    return {
      ...page,
      assetNeeds: page.assetNeeds.map((need) => ({
        ...need,
        type: "illustration" as const,
        role: index === 0 ? ("hero" as const) : ("inline" as const),
      })),
      id,
      order: index + 1,
      functionalTemplateId: functionalTemplate.id,
      styleTemplateId,
      assetIds: [],
      dependsOnPageIds: previousId ? [previousId] : [],
      status: "planned" as const,
    };
  });

  if (pages.length !== intent.courseLength) {
    throw new AiSchemaValidationError(
      `模型生成了 ${pages.length} 页，但 CourseIntent 要求 ${intent.courseLength} 页。`,
    );
  }

  return CoursePlanSchema.parse({ ...draft, pages });
}

/** 将页面稳定排列为引入、讲解、互动和总结四个教学阶段。 */
function getLearningPhase(pageType: z.infer<typeof PageTypeSchema>) {
  const phases: Record<z.infer<typeof PageTypeSchema>, number> = {
    cover: 0,
    story_intro: 0,
    knowledge_card: 1,
    comparison: 1,
    timeline: 1,
    quiz: 2,
    achievement: 2,
    summary: 3,
  };

  return phases[pageType];
}
