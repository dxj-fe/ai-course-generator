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
import { loadStoredScreenshotImages } from "@/server/infra/browser/screenshot-evidence";
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
  execution.overviewImages = (
    await Promise.all(
      decisionEvidence.manifest.pages.slice(0, 20).map(({ pageId }) =>
        loadStoredScreenshotImages({
          pageId,
          quality: decisionEvidence.pageQualities.get(pageId)!,
          viewport: "desktop",
        }),
      ),
    )
  ).flat();
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
    prepareStep: (step) => {
      const activeTools = resolveCourseReviewerTerminalTools(execution);
      const shouldInject =
        execution.visualEvidenceVersion >
        execution.injectedVisualEvidenceVersion;
      const images =
        execution.visualEvidenceVersion === 0
          ? execution.overviewImages
          : execution.pendingPageImages;
      if (shouldInject) {
        execution.injectedVisualEvidenceVersion =
          execution.visualEvidenceVersion;
      }
      return {
        activeTools,
        ...(shouldInject && images.length > 0
          ? {
              messages: [
                ...step.messages,
                {
                  role: "user",
                  content: [
                    {
                      type: "text",
                      text:
                        execution.visualEvidenceVersion === 0
                          ? "下面是按课程顺序排列的页面桌面截图。请结合结构化证据审查真实课程，不要只看摘要。"
                          : "下面是刚刚点查页面的桌面、平板和手机原图。请根据真实视觉结果继续审查。",
                    },
                    ...images.flatMap((image) => [
                      {
                        type: "text" as const,
                        text: `${image.pageId} · ${image.viewport.width}x${image.viewport.height}`,
                      },
                      {
                        type: "file" as const,
                        data: image.png,
                        mediaType: "image/png",
                        filename: `review-${image.pageId}-${image.viewport.width}x${image.viewport.height}.png`,
                      },
                    ]),
                  ],
                },
              ],
            }
          : {}),
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

结构化证据已经由 Harness 一次性完整加载，桌面截图会作为视觉输入附在本轮消息中。通常可直接提交；如果某页视觉、互动或浏览器诊断可疑，可调用 inspect_page_evidence 点查该页三视口原图，再提交结论。必须基于这个 manifestHash 提交；任何页面版本变化都应停止旧审查。`;
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
