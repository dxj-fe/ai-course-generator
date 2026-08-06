import { getLanguageModel } from "@/server/infra/ai/model-provider";
import { resolveModelRoute } from "@/server/infra/ai/model-router";
import {
  AgentIds,
  ToolIds,
} from "@/server/agent/ids";
import { getAgentSystem } from "@/server/setup/agent";
import {
  authorizeCourseReviewerToolCall,
  collectCourseReviewerEvidenceContractConflicts,
  createCourseReviewerExecution,
  loadCourseReviewerTerminal,
  parseCourseReviewerTerminal,
  preloadCourseReviewerEvidence,
  resolveCourseReviewerTerminalTools,
  type CourseReviewerExecutionInput,
  type CourseReviewerSnapshot,
} from "@/server/agent/plugins/contexts/course/reviewer";
import {
  collectDeterministicReviewerFindings,
  compactCourseReviewerQuality,
  createCourseReviewerTools,
  type CourseReviewerTools,
} from "@/server/agent/plugins/tools/course/reviewer";
import {
  AgentRunner,
  type AgentRunnerResult,
  type RuntimeAgentFactory,
} from "@/server/agent/runtime";
import { createCourseToolLedger } from "@/server/course/run/tool-ledger";
import type {
  PageSummary,
  PageTask,
  Submission,
} from "@/shared/course-schema";

export type CourseReviewerAgentDependencies = {
  createAgent?: RuntimeAgentFactory<CourseReviewerTools>;
  model?: unknown;
  now?: () => string;
};

/**
 * Reviewer 只审查冻结 manifest 的实际产物，不修改页面，也不派发返工。
 * 只有 submit/block 工具成功写入 Repository 才算当前 Agent 回合结束。
 */
export async function runCourseReviewerAgent(
  input: CourseReviewerExecutionInput,
  dependencies: CourseReviewerAgentDependencies = {},
): Promise<AgentRunnerResult<Submission>> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const agentSystem = await getAgentSystem();
  const agentDefinition = agentSystem.agents.get(
    AgentIds.CourseReviewer,
  );
  const instructions = await agentSystem.prompts.render(
    agentDefinition.prompt,
    {},
  );
  const execution = createCourseReviewerExecution(input);
  const decisionEvidence = preloadCourseReviewerEvidence(execution);
  const tools = createCourseReviewerTools(execution, { now });
  const runner = new AgentRunner<CourseReviewerTools, Submission>({
    createAgent: dependencies.createAgent,
    terminalStateLoader: {
      load: async () => loadCourseReviewerTerminal(execution),
      parse: (value) =>
        parseCourseReviewerTerminal(execution, value),
    },
  });
  return runner.run({
    abortSignal: execution.abortSignal,
    activeTools: resolveCourseReviewerTerminalTools(execution),
    authorizeToolCall: (call) =>
      authorizeCourseReviewerToolCall(execution, call, now()),
    beforeToolCall: input.beforeToolCall,
    budget: {
      maxOutputTokens:
        execution.initialWorkOrder.budget.maxOutputTokens,
      maxSteps: execution.initialWorkOrder.budget.maxSteps,
      maxToolCalls:
        execution.initialWorkOrder.budget.maxToolCalls,
      timeout: {
        totalMs: execution.initialWorkOrder.budget.timeoutMs,
      },
    },
    instructions,
    model:
      dependencies.model ??
      getLanguageModel(
        resolveModelRoute(agentDefinition.modelCapability).primary,
      ),
    prompt: buildCourseReviewerPrompt(execution, decisionEvidence),
    prepareStep: () => {
      const activeTools = resolveCourseReviewerTerminalTools(execution);
      return {
        activeTools,
        ...(activeTools.length === 1
          ? {
              toolChoice: {
                type: "tool" as const,
                toolName: activeTools[0]!,
              },
            }
          : {}),
      };
    },
    temperature: 0.1,
    terminalToolNames: [
      ToolIds.SubmitCourseReview,
      ToolIds.BlockCourseReview,
    ],
    toolLedger: createCourseToolLedger(
      execution.repository.toolOperations,
      execution.initialWorkOrder,
    ),
    tools,
    traceId: execution.traceId,
    workOrderId: execution.initialWorkOrder.id,
  });
}

function buildCourseReviewerPrompt(
  execution: ReturnType<typeof createCourseReviewerExecution>,
  snapshot: CourseReviewerSnapshot,
) {
  return `请完成当前整课审查 WorkOrder。

courseId：${execution.initialWorkOrder.courseId}
revision：${execution.initialWorkOrder.revision}
manifestHash：${execution.frozenManifestHash}
验收要求：${JSON.stringify(execution.initialWorkOrder.acceptance)}
已封口的全部决策证据：${JSON.stringify(
    buildCourseReviewerDecisionEvidence(execution, snapshot),
  )}

证据已经由 Harness 一次性完整加载。请直接调用当前唯一开放的终态工具，不要先读取或校验。必须基于这个 manifestHash 提交；任何页面版本变化都应停止旧审查。`;
}

function buildCourseReviewerDecisionEvidence(
  execution: ReturnType<typeof createCourseReviewerExecution>,
  snapshot: CourseReviewerSnapshot,
) {
  const { architecture } = snapshot;
  const detail = resolveReviewerEvidenceDetail(
    snapshot.manifest.pages.length,
  );
  const deterministicFindings = collectDeterministicReviewerFindings(
    snapshot,
  );
  return {
    course: {
      title: architecture.blueprint.title,
      audience: {
        ...architecture.blueprint.audience,
        description: truncateReviewerText(
          architecture.blueprint.audience.description,
          200,
        ),
        priorKnowledge:
          architecture.blueprint.audience.priorKnowledge
            .slice(0, 8)
            .map((item) => truncateReviewerText(item, 120)),
      },
      objectives: architecture.blueprint.objectives.map(
        ({ id, outcome, evidence }) => ({
          id,
          outcome: truncateReviewerText(outcome, 240),
          evidence: truncateReviewerText(evidence, 240),
        }),
      ),
      courseRules: {
        ...architecture.blueprint.courseRules,
        tone: truncateReviewerText(
          architecture.blueprint.courseRules.tone,
          160,
        ),
        terminology:
          architecture.blueprint.courseRules.terminology.slice(0, 24),
        visualDirection: truncateReviewerText(
          architecture.blueprint.courseRules.visualDirection,
          300,
        ),
        teachingPattern:
          architecture.blueprint.courseRules.teachingPattern
            .slice(0, 10)
            .map((item) => truncateReviewerText(item, 160)),
      },
      facts: architecture.coursePack.facts.map(({ id, text }) => ({
        id,
        text: truncateReviewerText(text, 360),
      })),
      terms: architecture.coursePack.terms.map(
        ({ term, definition }) => ({
          term,
          definition: truncateReviewerText(definition, 240),
        }),
      ),
      constraints: architecture.coursePack.constraints.map((item) =>
        truncateReviewerText(item, 240),
      ),
    },
    pages: snapshot.manifest.pages.map(({ pageId }) => {
      const pageTask = architecture.pageTasks.find(
        (candidate) => candidate.pageId === pageId,
      );
      const summary = snapshot.pageSummaries.get(pageId);
      const quality = snapshot.pageQualities.get(pageId);
      if (!pageTask || !summary || !quality) {
        throw new Error(`Reviewer 缺少页面 ${pageId} 的封口证据。`);
      }
      return {
        pageTask: compactCourseReviewerPageTask(pageTask, detail),
        actual: compactCourseReviewerSummary(summary, detail),
        quality: compactCourseReviewerQuality(pageId, quality, false),
      };
    }),
    deterministicFindings: {
      total: deterministicFindings.length,
      items: deterministicFindings.slice(0, 80).map(
        ({
          code,
          scope,
          pageId,
          severity,
          message,
          suggestedAction,
          targetArtifact,
        }) => ({
          code,
          scope,
          pageId,
          severity,
          message: truncateReviewerText(message, 200),
          suggestedAction: truncateReviewerText(suggestedAction, 200),
          targetArtifact,
        }),
      ),
    },
    contractConflicts:
      collectCourseReviewerEvidenceContractConflicts(execution),
  };
}

type ReviewerEvidenceDetail = {
  digestLength: number;
  itemLimit: number;
  itemLength: number;
  shortLength: number;
};

function resolveReviewerEvidenceDetail(
  pageCount: number,
): ReviewerEvidenceDetail {
  if (pageCount <= 20) {
    return {
      digestLength: 600,
      itemLimit: 8,
      itemLength: 240,
      shortLength: 240,
    };
  }
  if (pageCount <= 80) {
    return {
      digestLength: 320,
      itemLimit: 4,
      itemLength: 140,
      shortLength: 160,
    };
  }
  return {
    digestLength: 160,
    itemLimit: 2,
    itemLength: 80,
    shortLength: 100,
  };
}

function compactCourseReviewerPageTask(
  pageTask: PageTask,
  detail: ReviewerEvidenceDetail,
) {
  return {
    pageId: pageTask.pageId,
    order: pageTask.order,
    title: pageTask.title,
    pageType: pageTask.pageType,
    purpose: truncateReviewerText(pageTask.purpose, detail.shortLength),
    objectiveIds: pageTask.objectiveIds,
    buildDependsOnPageIds: pageTask.buildDependsOnPageIds,
    teachingPoints: pageTask.teachingPoints
      .slice(0, detail.itemLimit)
      .map((item) => truncateReviewerText(item, detail.itemLength)),
    learnerAction: truncateReviewerText(
      pageTask.learnerAction,
      detail.shortLength,
    ),
    assessment: pageTask.assessment
      ? truncateReviewerText(pageTask.assessment, detail.shortLength)
      : undefined,
    interactionType: pageTask.interactionType,
    visualDesign: pageTask.visualDesign
      ? {
          theme: truncateReviewerText(
            pageTask.visualDesign.theme,
            detail.shortLength,
          ),
          layout: truncateReviewerText(
            pageTask.visualDesign.layout,
            detail.shortLength,
          ),
          graphicMotif: truncateReviewerText(
            pageTask.visualDesign.graphicMotif,
            detail.shortLength,
          ),
        }
      : undefined,
    acceptance: {
      requiredConcepts: pageTask.acceptance.requiredConcepts
        .slice(0, detail.itemLimit)
        .map((item) => truncateReviewerText(item, detail.itemLength)),
      expectedLearnerOutcome: truncateReviewerText(
        pageTask.acceptance.expectedLearnerOutcome,
        detail.shortLength,
      ),
      requiresInteraction: pageTask.acceptance.requiresInteraction,
      pageSpecific: pageTask.acceptance.pageSpecific
        .slice(0, detail.itemLimit)
        .map((item) => truncateReviewerText(item, detail.itemLength)),
    },
  };
}

function compactCourseReviewerSummary(
  summary: PageSummary,
  detail: ReviewerEvidenceDetail,
) {
  return {
    pageId: summary.pageId,
    order: summary.order,
    title: summary.title,
    purpose: truncateReviewerText(summary.purpose, detail.shortLength),
    objectiveIds: summary.objectiveIds,
    buildDependencyPageIds: summary.buildDependencyPageIds,
    keyPoints: summary.keyPoints
      .slice(0, detail.itemLimit)
      .map((point) => truncateReviewerText(point, detail.itemLength)),
    contentDigest: truncateReviewerText(
      summary.contentDigest,
      detail.digestLength,
    ),
    learnerAction: truncateReviewerText(
      summary.learnerAction,
      detail.shortLength,
    ),
    assessment: summary.assessment
      ? truncateReviewerText(summary.assessment, detail.shortLength)
      : undefined,
    interactionType: summary.interactionType,
    quality: summary.quality,
  };
}

function truncateReviewerText(value: string, maxLength: number) {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}
