import { z } from "zod";

import { generateStructuredObjectSafe } from "@/server/ai/client";
import { buildSinglePagePlanPrompts } from "@/server/prompts/single-page";
import {
  PagePlanDraftSchema,
  type PagePlanDraft,
} from "@/shared/course-schema";
import { selectPageTemplate } from "@/server/tools/template-selector";

import { createMinimalAgent } from "./core/minimal-agent";
import type {
  Agent,
  AgentRuntimeContext,
  AgentStateBase,
} from "./core/types";

const TemplateSelectionOutputSchema = z.object({
  templates: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        reason: z.string(),
      }),
    )
    .min(1),
});

export type SelectedPageTemplate = {
  toolName: string;
  templateId: string;
  templateName: string;
  reason: string;
};

export type SinglePageAgentState = AgentStateBase & {
  task: {
    pageGoal: string;
    audience?: string;
  };
  selectedTemplate?: SelectedPageTemplate;
  pagePlan?: PagePlanDraft;
};

export type SinglePageAgentDependencies = {
  selectTemplate(input: {
    abortSignal?: AbortSignal;
    pagePurpose: string;
    traceId: string;
  }): Promise<{
    toolCalls: Array<{ toolName: string }>;
    toolResults: Array<{ toolName: string; output: unknown }>;
  }>;
  generatePagePlan(input: {
    abortSignal?: AbortSignal;
    audience?: string;
    pageGoal: string;
    selectedTemplate: SelectedPageTemplate;
    traceId: string;
  }): Promise<PagePlanDraft>;
};

const defaultDependencies: SinglePageAgentDependencies = {
  selectTemplate: selectPageTemplate,
  generatePagePlan: generatePagePlanDraft,
};

export function createSinglePageAgent(
  dependencies: SinglePageAgentDependencies = defaultDependencies,
): Agent<SinglePageAgentState> {
  return createMinimalAgent({
    isComplete: (state) => Boolean(state.pagePlan),
    step: async (state, context, emit) => {
      if (!state.selectedTemplate) {
        const selectionResult = await dependencies.selectTemplate({
          abortSignal: context.abortSignal,
          pagePurpose: buildPagePurpose(state),
          traceId: context.traceId,
        });
        const toolCall = selectionResult.toolCalls[0];
        const toolResult = selectionResult.toolResults[0];

        if (!toolCall || !toolResult) {
          throw new Error("模板选择模型没有返回可执行的 Tool Call。");
        }

        const output = TemplateSelectionOutputSchema.parse(toolResult.output);
        const template = output.templates[0];
        const selectedTemplate = {
          toolName: toolCall.toolName,
          templateId: template.id,
          templateName: template.name,
          reason: template.reason,
        };

        emit({
          type: "model_call",
          summary: "模型已完成模板工具选择。",
          data: { purpose: "template-selection" },
        });
        emit({
          type: "tool_call",
          summary: `工具 ${toolResult.toolName} 已返回模板 ${template.name}。`,
          data: {
            toolName: toolResult.toolName,
            templateId: template.id,
            success: true,
          },
        });

        return { ...state, selectedTemplate };
      }

      if (!state.pagePlan) {
        const pagePlan = await dependencies.generatePagePlan({
          abortSignal: context.abortSignal,
          audience: state.task.audience,
          pageGoal: state.task.pageGoal,
          selectedTemplate: state.selectedTemplate,
          traceId: context.traceId,
        });

        emit({
          type: "model_call",
          summary: "模型已生成结构化 PagePlan 草稿。",
          data: { purpose: "page-plan-generation" },
        });

        return { ...state, pagePlan };
      }

      throw new Error("SinglePageAgent 无法判断下一步动作。");
    },
  });
}

export function createSinglePageAgentState(input: {
  audience?: string;
  maxSteps?: number;
  pageGoal: string;
}): SinglePageAgentState {
  return {
    status: "idle",
    step: 0,
    maxSteps: input.maxSteps ?? 3,
    events: [],
    task: {
      pageGoal: input.pageGoal,
      audience: input.audience,
    },
  };
}

export async function runSinglePageAgent(
  input: {
    audience?: string;
    maxSteps?: number;
    pageGoal: string;
  },
  context: AgentRuntimeContext,
) {
  return createSinglePageAgent().run(
    createSinglePageAgentState(input),
    context,
  );
}

async function generatePagePlanDraft(input: {
  abortSignal?: AbortSignal;
  audience?: string;
  pageGoal: string;
  selectedTemplate: SelectedPageTemplate;
  traceId: string;
}) {
  const prompts = await buildSinglePagePlanPrompts(input);

  return generateStructuredObjectSafe({
    abortSignal: input.abortSignal,
    capability: "single-page",
    maxTokens: 1_200,
    prompt: prompts.userPrompt,
    promptVersion: prompts.version,
    schema: PagePlanDraftSchema,
    schemaDescription: "A structured plan draft for one course page.",
    schemaName: "page_plan_draft",
    systemPrompt: prompts.systemPrompt,
    temperature: 0.2,
    traceId: input.traceId,
  });
}

function buildPagePurpose(state: SinglePageAgentState) {
  return state.task.audience
    ? `${state.task.pageGoal}；目标受众：${state.task.audience}`
    : state.task.pageGoal;
}
