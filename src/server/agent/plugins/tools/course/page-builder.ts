import { tool } from "ai";
import { z } from "zod";

import { ToolIds } from "@/server/agent/ids";
import { FatalAgentRuntimeError } from "@/server/agent/runtime";
import {
  initializePageWorkspace,
  PageWorkspaceMetadataSchema,
  readPageWorkspace,
  readPageWorkspaceSlice,
  replacePageWorkspaceText,
  writePageWorkspace,
  type PageWorkspaceMetadata,
} from "@/server/agent/workspace/page-workspace";
import {
  clearPageBuilderRepairDeclined,
  countPageBuilderRepairs,
  hasPageBuilderSubstantiveFix,
  loadPageBuilderSnapshot,
  loadPageBuilderWorkingSnapshot,
  recordPageBuilderRepairDeclined,
  type PageBuilderExecution,
  type PageBuilderToolName,
} from "@/server/agent/plugins/contexts/course/page-builder";
import type { ReadLocalResourceTool } from "@/server/agent/plugins/tools/system";
import {
  evaluatePageBlockEligibility,
  MAX_PAGE_QUALITY_REVISIONS,
} from "@/server/course/policy/page-block";
import { classifyPublicAgentError } from "@/server/course/projection/public-error";
import { buildCourseVisualReferences } from "@/server/course/page/visual-reference";
import {
  defaultPageBuilderModelSteps,
  type PageBuilderModelSteps,
} from "@/server/agent/plugins/tools/course/page-builder-model-steps";
import { generateImageTool } from "@/server/agent/plugins/tools/course/generate-image";
import { normalizeWideSingleColumnBreakpoints } from "@/server/agent/plugins/model-steps/course/html-engineer-normalizers";
import { buildLessonRuntime } from "@/server/agent/plugins/model-steps/course/page-writer-runtime";
import {
  checkpointSummary,
  createExclusiveRunner,
  failure,
  fixTargetIsUnchanged,
  recoverableModelStep,
  reused,
  selectAuthorizedReferenceChunks,
  success,
  toArtifactRef,
} from "@/server/agent/plugins/tools/course/page-builder-support";
import {
  runPageGate,
  type PageGateResult,
} from "@/server/course/gate/page";
import { validatePageHtmlEnvelope } from "@/server/course/gate/page-html";
import { planRepairRound } from "@/server/course/page/repair-plan";
import { basicLayoutHeuristics } from "@/server/course/page/quality/basic-layout";
import { buildPageQualityReport } from "@/server/course/page/quality/report";
import { capturePageScreenshot } from "@/server/infra/browser/page-screenshot";
import {
  AssetGenerationResultSchema,
  HtmlOutputSchema,
  PageContentDSLSchema,
  QualityReportSchema,
  type ArtifactRef,
  type AssetGenerationResult,
  type PageContentDSL,
} from "@/shared/course-schema";

const ScopeInputSchema = z
  .object({
    pageId: z.string().min(1).max(80),
  })
  .strict();

const SearchReferencesInputSchema = ScopeInputSchema.extend({
  query: z.string().trim().min(1).max(200).optional(),
  referencePackId: z.string().min(1).max(80).optional(),
  chunkIds: z.array(z.string().min(1).max(80)).max(8).optional(),
}).strict();

const ReadWorkspaceInputSchema = ScopeInputSchema.extend({
  offset: z.number().int().nonnegative().default(0),
  maxChars: z.number().int().min(1).max(24_000).default(12_000),
}).strict();

const EditWorkspaceInputSchema = z.discriminatedUnion("mode", [
  ScopeInputSchema.extend({
    mode: z.literal("write"),
    html: z.string().min(1).max(200_000),
    metadata: PageWorkspaceMetadataSchema.optional(),
  }).strict(),
  ScopeInputSchema.extend({
    mode: z.literal("replace"),
    oldText: z.string().min(1).max(60_000),
    newText: z.string().max(120_000),
    metadata: PageWorkspaceMetadataSchema.optional(),
  }).strict(),
]);

const GeneratePageImageInputSchema = ScopeInputSchema.extend({
  purpose: z.string().trim().min(2).max(300),
  prompt: z.string().trim().min(20).max(3_000),
  altText: z.string().max(300),
  assetType: z.enum([
    "background",
    "character_sticker",
    "icon",
    "texture",
  ]),
  aspectRatio: z.enum(["1:1", "4:3", "3:4", "16:9"]),
  safeAreaPosition: z
    .enum(["left", "right", "top", "bottom", "center", "none"])
    .default("none"),
  safeAreaCoveragePercent: z.number().int().min(0).max(80).default(0),
  safeAreaDescription: z.string().trim().min(2).max(240).default("无需预留文字区"),
}).strict();

const BrowserInteractionStepSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.enum(["click", "check", "expectVisible"]),
      selector: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      action: z.enum(["fill", "expectText"]),
      selector: z.string().trim().min(1).max(300),
      value: z.string().max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("expectAttribute"),
      selector: z.string().trim().min(1).max(300),
      attribute: z.string().regex(/^[a-zA-Z_:][a-zA-Z0-9_.:-]*$/).max(80),
      value: z.string().max(500),
    })
    .strict(),
]);

const RenderPageInputSchema = ScopeInputSchema.extend({
  interactionSteps: z.array(BrowserInteractionStepSchema).max(20).default([]),
}).strict();

const GenerateContentInputSchema = ScopeInputSchema.extend({
  validationFeedback: z
    .array(z.string().trim().min(1).max(500))
    .max(12)
    .optional(),
}).strict();

const BlockPageInputSchema = ScopeInputSchema.extend({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(2).max(500),
}).strict();

const MAX_PAGE_CONTENT_GENERATION_ATTEMPTS = 3;
const MAX_PAGE_REPAIR_GENERATION_ATTEMPTS = 3;
const STRUCTURAL_HTML_REGENERATION_CODES = new Set([
  "BROWSER_CONTENT_CLIPPED",
  "BROWSER_NESTED_VERTICAL_OVERFLOW",
  "BROWSER_VERTICAL_OVERFLOW",
  "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
]);
const STATE_GUARDED_PAGE_TOOL_IDS = new Set<string>([
  ToolIds.EditPageWorkspace,
  ToolIds.GeneratePageImage,
  ToolIds.RenderPage,
  ToolIds.InspectPage,
]);

export type PageBuilderToolDependencies = {
  modelSteps?: PageBuilderModelSteps;
  pageGate?: (input: Parameters<typeof runPageGate>[0]) => PageGateResult;
  readLocalResourceTool?: ReadLocalResourceTool;
  captureScreenshot?: typeof capturePageScreenshot;
  imageTool?: typeof generateImageTool;
};

/**
 * 新 Page Creator 在模型启动前由 Harness 读取封口上下文和 workspace。
 * 这两个机械步骤不值得各消耗一次外部模型往返；工具仍保留给 Agent 按需复查。
 */
export async function preloadPageBuilderWorkspace(
  execution: PageBuilderExecution,
) {
  await initializePageWorkspace(
    execution.workspace,
    buildPageWorkspaceTask(execution),
    buildPageWorkspaceInitialState(execution),
  );
  const workspace = await readPageWorkspace(execution.workspace);
  const snapshot = loadPageBuilderWorkingSnapshot(execution);
  execution.progress.contextRead = true;
  execution.progress.workspaceRead = true;
  execution.progress.workspaceDirty =
    workspace.exists && workspace.html !== snapshot.html?.html;
  return workspace;
}

export function createPageBuilderTools(
  execution: PageBuilderExecution,
  dependencies: PageBuilderToolDependencies = {},
) {
  const modelSteps =
    dependencies.modelSteps ?? defaultPageBuilderModelSteps;
  const pageGate = dependencies.pageGate ?? runPageGate;
  const captureScreenshot =
    dependencies.captureScreenshot ?? capturePageScreenshot;
  const imageTool = dependencies.imageTool ?? generateImageTool;
  const runExclusive = createExclusiveRunner();

  const checkpoint = (
    toolName: PageBuilderToolName,
    kind:
      | "page_content"
      | "page_assets"
      | "page_html"
      | "page_quality",
    payload: unknown,
    invalidates: Array<
      "page_content" | "page_assets" | "page_html" | "page_quality"
    > = [],
    toolCallId?: string,
  ) => {
    const saved = execution.repository.checkpointPageArtifact({
      workOrderId: execution.initialWorkOrder.id,
      expectedWorkOrderLockVersion: execution.currentLockVersion,
      workOrderLeaseOwner: execution.workOrderLeaseOwner,
      runLeaseOwner: execution.runLeaseOwner,
      traceId: execution.traceId,
      toolName,
      toolCallId,
      kind,
      payload,
      invalidates,
    });
    execution.currentLockVersion = saved.workOrder.lockVersion;
    return saved.artifact;
  };

  type RenderWorkspaceOptions = {
    abortSignal?: AbortSignal;
    toolCallId?: string;
  };
  const renderWorkspace = async (
    interactionSteps: z.infer<typeof BrowserInteractionStepSchema>[],
    options: RenderWorkspaceOptions,
  ) => {
    await initializePageWorkspace(
      execution.workspace,
      buildPageWorkspaceTask(execution),
      buildPageWorkspaceInitialState(execution),
    );
    const workspace = await readPageWorkspace(execution.workspace);
    if (!workspace.exists) {
      execution.progress.workspaceDirty = false;
      return failure(
        "PAGE_WORKSPACE_EMPTY",
        "workspace 中还没有可渲染的 index.html。",
        ["先调用 edit_page_workspace 写入完整初稿。"],
      );
    }
    const before = loadPageBuilderSnapshot(execution);
    const assets = before.assets ?? [];
    const content =
      execution.fixPlan?.targetArtifact === "page_html" && execution.baseline
        ? execution.baseline.content
        : buildAgentAuthoredPageContent(
            execution,
            workspace.metadata ?? { usedReferences: [] },
            assets,
          );
    const htmlIssues = validatePageHtmlEnvelope(workspace.html);
    if (htmlIssues.length > 0) {
      // 合同错误必须交回创作 Agent 修稿，不能把状态锁死在重复 render。
      execution.progress.workspaceDirty = false;
      return failure(
        "PAGE_WORKSPACE_CONTRACT_FAILED",
        "当前 index.html 尚不能进入浏览器 Harness。",
        htmlIssues.map(({ message }) => message),
      );
    }

    if (
      !before.content ||
      JSON.stringify(before.content) !== JSON.stringify(content)
    ) {
      checkpoint(
        ToolIds.RenderPage,
        "page_content",
        content,
        ["page_html", "page_quality"],
        options.toolCallId,
      );
    }
    const refreshed = loadPageBuilderSnapshot(execution);
    const html = HtmlOutputSchema.parse({
      html: workspace.html,
      generatedAt: new Date().toISOString(),
      revision: (refreshed.html?.revision ?? before.html?.revision ?? 0) + 1,
    });
    const htmlArtifact = checkpoint(
      ToolIds.RenderPage,
      "page_html",
      html,
      ["page_quality"],
      options.toolCallId,
    );
    const rendered = await captureScreenshot({
      pageId: execution.pageId,
      html: html.html,
      content,
      requiresInteraction:
        execution.pageTask.acceptance.requiresInteraction,
      abortSignal: options.abortSignal ?? execution.abortSignal,
      traceId: execution.traceId,
      attempt: html.revision,
      interactionSteps,
    });
    execution.latestRenderEvidence = {
      htmlRevision: html.revision,
      evidence: rendered.evidence,
      issues: rendered.issues,
      images: rendered.modelImages ?? [],
    };
    execution.progress.workspaceDirty = false;

    if (execution.legacyModelPipeline) {
      return success({
        committed: true,
        summary: rendered.issues.length
          ? `页面已渲染，发现 ${rendered.issues.length} 个可观察问题；请看截图后继续修改。`
          : "页面已完成三视口渲染；请根据下一轮截图判断是否继续修改。",
        data: {
          artifactRef: toArtifactRef(htmlArtifact),
          htmlRevision: html.revision,
          captures: rendered.evidence.captures,
          issues: rendered.issues.slice(0, 20).map(
            ({ code, severity, message, location, repairHint }) => ({
              code,
              severity,
              message,
              location,
              repairHint,
            }),
          ),
          screenshotCount: rendered.modelImages?.length ?? 0,
        },
        artifactRefs: [toArtifactRef(htmlArtifact)],
      });
    }

    const quality = buildAgentLoopQualityReport({
      pageId: execution.pageId,
      content,
      html: html.html,
      assets,
      browserIssues: rendered.issues,
      screenshotEvidence: rendered.evidence,
    });
    const qualityArtifact = checkpoint(
      ToolIds.InspectPage,
      "page_quality",
      quality,
      [],
      options.toolCallId,
    );
    const qualityPassed =
      quality.decision === "pass" && !quality.shouldRepair;

    return success({
      committed: true,
      summary: qualityPassed
        ? `页面已完成三视口渲染并通过质量检查：${quality.overallScore} 分。`
        : `页面已完成三视口渲染，需要返工：${quality.issues.length} 个问题。`,
      data: {
        artifactRef: toArtifactRef(htmlArtifact),
        qualityArtifactRef: toArtifactRef(qualityArtifact),
        htmlRevision: html.revision,
        captures: rendered.evidence.captures,
        issues: rendered.issues.slice(0, 20).map(
          ({ code, severity, message, location, repairHint }) => ({
            code,
            severity,
            message,
            location,
            repairHint,
          }),
        ),
        decision: quality.decision,
        overallScore: quality.overallScore,
        shouldRepair: quality.shouldRepair,
        screenshotCount: rendered.modelImages?.length ?? 0,
      },
      artifactRefs: [
        toArtifactRef(htmlArtifact),
        toArtifactRef(qualityArtifact),
      ],
    });
  };

  const tools = {
    ...(dependencies.readLocalResourceTool
      ? {
          [ToolIds.ReadLocalResource]:
            dependencies.readLocalResourceTool,
        }
      : {}),
    [ToolIds.ReadPageContext]: tool({
      description:
        "读取本页任务、整课规则、精简课程地图、前置页摘要和已有 checkpoint；不返回其他页面 HTML。",
      inputSchema: ScopeInputSchema,
      execute: async () => {
        const snapshot = loadPageBuilderSnapshot(execution);
        execution.progress.contextRead = true;
        return success({
          committed: false,
          summary: "已读取本页封口上下文。",
          data: {
            course: {
              title: execution.architecture.blueprint.title,
              objectives:
                execution.architecture.blueprint.objectives,
              rules:
                execution.architecture.blueprint.courseRules,
            },
            coursePack: {
              topic: execution.architecture.coursePack.topic,
              facts: execution.architecture.coursePack.facts,
              terms: execution.architecture.coursePack.terms,
              examples: execution.architecture.coursePack.examples,
              constraints: execution.architecture.coursePack.constraints,
            },
            pageTask: {
              pageId: execution.pageTask.pageId,
              order: execution.pageTask.order,
              title: execution.pageTask.title,
              purpose: execution.pageTask.purpose,
              objectiveIds: execution.pageTask.objectiveIds,
              buildDependsOnPageIds:
                execution.pageTask.buildDependsOnPageIds,
              teachingPoints: execution.pageTask.teachingPoints,
              learnerAction: execution.pageTask.learnerAction,
              assessment: execution.pageTask.assessment,
              referenceUsages: execution.pageTask.referenceUsages,
              visualDesign: execution.pageTask.visualDesign,
              acceptance: execution.pageTask.acceptance,
            },
            courseMap: execution.architecture.pageTasks.map(
              ({ pageId, order, title, purpose, objectiveIds }) => ({
                pageId,
                order,
                title,
                purpose,
                objectiveIds,
              }),
            ),
            dependencySummaries: execution.dependencySummaries,
            acceptance: snapshot.workOrder.acceptance,
            checkpoints: checkpointSummary(snapshot),
            ...(execution.fixPlan && execution.baseline
              ? {
                  fixPlan: execution.fixPlan,
                  baseline: {
                    htmlRevision: execution.baseline.html.revision,
                    qualityDecision:
                      execution.baseline.quality.decision,
                    summaryDigest:
                      execution.baseline.summary.contentDigest,
                  },
                }
              : {}),
          },
        });
      },
    }),

    [ToolIds.ReadPageWorkspace]: tool({
      description:
        "读取当前页面的可写 workspace。HTML 较长时用 offset 分段读取；workspace 只属于当前 WorkOrder。",
      inputSchema: ReadWorkspaceInputSchema,
      execute: async ({ offset, maxChars }) => {
        await initializePageWorkspace(
          execution.workspace,
          buildPageWorkspaceTask(execution),
          buildPageWorkspaceInitialState(execution),
        );
        const workspace = await readPageWorkspaceSlice(
          execution.workspace,
          { offset, maxChars },
        );
        const snapshot = loadPageBuilderWorkingSnapshot(execution);
        execution.progress.workspaceDirty =
          workspace.exists && workspace.html !== snapshot.html?.html;
        execution.progress.workspaceRead = true;
        return success({
          committed: false,
          summary: workspace.exists
            ? `已读取 index.html 的 ${workspace.html.length} 个字符。`
            : "workspace 已初始化，尚无 index.html。",
          data: {
            workspaceRef: execution.workspace.directory,
            exists: workspace.exists,
            html: workspace.html,
            offset: workspace.offset,
            nextOffset: workspace.nextOffset,
            totalChars: workspace.totalChars,
            metadata: workspace.metadata,
            updatedAt: workspace.updatedAt,
          },
        });
      },
    }),

    [ToolIds.EditPageWorkspace]: tool({
      description:
        "直接创建或修改页面 workspace。write 用于完整初稿；replace 用精确 oldText/newText 做小步修订。这里不套页面模板，HTML 构图由你决定。",
      inputSchema: EditWorkspaceInputSchema,
      execute: (input, options) =>
        runExclusive(async () => {
          await initializePageWorkspace(
            execution.workspace,
            buildPageWorkspaceTask(execution),
            buildPageWorkspaceInitialState(execution),
          );
          let workspace =
            input.mode === "write"
              ? await writePageWorkspace({
                  workspace: execution.workspace,
                  html: normalizePageCreatorHtml(input.html),
                  metadata: input.metadata,
                })
              : await replacePageWorkspaceText({
                  workspace: execution.workspace,
                  oldText: input.oldText,
                  newText: input.newText,
                  metadata: input.metadata,
                });
          const normalizedHtml = normalizePageCreatorHtml(workspace.html);
          if (normalizedHtml !== workspace.html) {
            workspace = await writePageWorkspace({
              workspace: execution.workspace,
              html: normalizedHtml,
              metadata: workspace.metadata,
            });
          }
          execution.latestRenderEvidence = undefined;
          execution.progress.workspaceDirty = true;
          execution.progress.workspaceRead = true;
          if (!execution.legacyModelPipeline) {
            return renderWorkspace([], {
              abortSignal:
                options.abortSignal ?? execution.abortSignal,
              toolCallId: options.toolCallId,
            });
          }
          return success({
            committed: false,
            summary: `workspace 已更新，共 ${workspace.htmlBytes} 字节；下一步应渲染观察真实页面。`,
            data: {
              workspaceRef: execution.workspace.directory,
              htmlBytes: workspace.htmlBytes,
              updatedAt: workspace.updatedAt,
              next: ToolIds.RenderPage,
            },
          });
        }),
    }),

    [ToolIds.GeneratePageImage]: tool({
      description:
        "按需生成一张页面素材并返回内部 asset URI。图片不是独立 Agent；不需要图片时不要调用。",
      inputSchema: GeneratePageImageInputSchema,
      execute: (input, options) =>
        runExclusive(async () => {
          const snapshot = loadPageBuilderSnapshot(execution);
          const assets = snapshot.assets ?? [];
          if (assets.length >= 12) {
            return failure(
              "PAGE_IMAGE_LIMIT_REACHED",
              "当前页面已经达到 12 张素材上限。",
              ["复用已有素材或删除无解释价值的图片。"],
            );
          }
          if (
            input.assetType === "background" &&
            input.safeAreaPosition === "none"
          ) {
            return failure(
              "BACKGROUND_SAFE_AREA_REQUIRED",
              "背景图必须声明 HTML 文字安全区。",
              ["选择 left/right/top/bottom/center 之一。"],
            );
          }
          const assetSlotId = `asset-slot-${String(assets.length + 1).padStart(2, "0")}`;
          const result = await imageTool.execute(
            {
              pageId: execution.pageId,
              altText: input.altText,
              request: {
                assetSlotId,
                assetType: input.assetType,
                usage: input.purpose,
                prompt: input.prompt,
                transparentBackground: [
                  "character_sticker",
                  "icon",
                ].includes(input.assetType),
                safeArea: {
                  position: input.safeAreaPosition,
                  coveragePercent: input.safeAreaCoveragePercent,
                  description: input.safeAreaDescription,
                },
                aspectRatio: input.aspectRatio,
              },
            },
            {
              traceId: execution.traceId,
              abortSignal:
                options.abortSignal ?? execution.abortSignal,
            },
          );
          const nextAssets = [...assets, result];
          const artifact = checkpoint(
            ToolIds.GeneratePageImage,
            "page_assets",
            nextAssets,
            ["page_html", "page_quality"],
            options.toolCallId,
          );
          execution.latestRenderEvidence = undefined;
          return success({
            committed: true,
            summary:
              result.status === "ready"
                ? `图片已生成，可在 HTML 中使用 ${result.asset!.uri}。`
                : `图片生成失败，已返回 ${result.fallback!.kind} 降级建议。`,
            data: {
              artifactRef: toArtifactRef(artifact),
              assetSlotId,
              status: result.status,
              uri: result.asset?.uri,
              altText: result.asset?.altText,
              fallback: result.fallback,
            },
            artifactRefs: [toArtifactRef(artifact)],
          });
        }),
    }),

    [ToolIds.RenderPage]: tool({
      description:
        "渲染 workspace 中的真实 index.html，保存当前 HTML checkpoint，并返回三视口布局、互动和浏览器证据；下一轮会把截图直接交给你观察。",
      inputSchema: RenderPageInputSchema,
      execute: ({ interactionSteps }, options) =>
        runExclusive(() =>
          renderWorkspace(interactionSteps, {
            abortSignal:
              options.abortSignal ?? execution.abortSignal,
            toolCallId: options.toolCallId,
          }),
        ),
    }),

    [ToolIds.SearchReferences]: tool({
      description:
        "只检索当前 PageTask 明确授权的资料 chunk。若本页没有资料引用，可以不调用。",
      inputSchema: SearchReferencesInputSchema,
      execute: async (input) => {
        const selected = selectAuthorizedReferenceChunks(
          execution,
          input,
        );
        return success({
          committed: false,
          summary:
            selected.length > 0
              ? `返回 ${selected.length} 个已授权资料片段。`
              : "本页没有匹配的已授权资料片段。",
          data: { chunks: selected },
        });
      },
    }),

    [ToolIds.GeneratePageContent]: tool({
      description:
        "根据当前 PageTask 生成本页 PageContentDSL，并立即保存 checkpoint。",
      inputSchema: GenerateContentInputSchema,
      execute: (input, options) =>
        runExclusive(async () => {
          const existing = loadPageBuilderSnapshot(execution);
          if (existing.content) {
            return reused(
              existing.workOrder,
              "page_content",
              "已复用保存的页面内容。",
            );
          }
          const validationFeedback = [
            ...(execution.fixPlan?.feedback ?? []),
            ...(input.validationFeedback ?? []),
          ];
          const generated = await recoverableModelStep(
            () =>
              modelSteps.generateContent({
                execution,
                ...(validationFeedback.length > 0
                  ? { validationFeedback }
                  : {}),
                abortSignal:
                  options.abortSignal ?? execution.abortSignal,
              }),
            options.abortSignal ?? execution.abortSignal,
            "PAGE_CONTENT_GENERATION_FAILED",
            "页面内容生成失败，可以根据反馈重试。",
          );
          if (!generated.ok) {
            execution.progress.contentGenerationFailures += 1;
            if (
              execution.progress.contentGenerationFailures >=
              MAX_PAGE_CONTENT_GENERATION_ATTEMPTS
            ) {
              throw new FatalAgentRuntimeError(
                "PAGE_CONTENT_RETRY_EXHAUSTED",
                `页面内容连续 ${MAX_PAGE_CONTENT_GENERATION_ATTEMPTS} 次生成失败，已停止重复调用。`,
                generated,
              );
            }
            return generated;
          }

          const content = PageContentDSLSchema.parse(generated.data);
          if (
            fixTargetIsUnchanged(
              execution,
              "page_content",
              content,
            )
          ) {
            return unchangedFixFailure("页面内容");
          }
          const artifact = checkpoint(
            ToolIds.GeneratePageContent,
            "page_content",
            content,
            ["page_assets", "page_html", "page_quality"],
          );
          return success({
            committed: true,
            summary: `页面内容已保存，共 ${content.blocks.length} 个内容块。`,
            data: {
              artifactRef: toArtifactRef(artifact),
              assetSlotCount: content.assetSlots.length,
              blockCount: content.blocks.length,
            },
            artifactRefs: [toArtifactRef(artifact)],
          });
        }),
    }),

    [ToolIds.ResolvePageAssets]: tool({
      description:
        "仅当 PageContentDSL 含素材槽时解析或生成素材；无素材页应直接跳过。",
      inputSchema: ScopeInputSchema,
      execute: (_input, options) =>
        runExclusive(async () => {
          const snapshot = loadPageBuilderSnapshot(execution);
          if (!snapshot.content) {
            return failure(
              "PAGE_CONTENT_MISSING",
              "必须先生成页面内容。",
              ["先调用 generate_page_content。"],
            );
          }
          if (snapshot.content.assetSlots.length === 0) {
            return success({
              committed: false,
              summary: "本页没有素材槽，已跳过素材生成。",
              data: { skipped: true, assetCount: 0 },
            });
          }
          if (snapshot.assets) {
            return reused(
              snapshot.workOrder,
              "page_assets",
              "已复用保存的页面素材。",
            );
          }
          const generated = await recoverableModelStep(
            () =>
              modelSteps.resolveAssets({
                execution,
                content: snapshot.content!,
                abortSignal:
                  options.abortSignal ?? execution.abortSignal,
              }),
            options.abortSignal ?? execution.abortSignal,
            "PAGE_ASSET_RESOLUTION_FAILED",
            "页面素材解析失败，可以重试。",
          );
          if (!generated.ok) return generated;
          const assets = z
            .array(AssetGenerationResultSchema)
            .max(12)
            .parse(generated.data);
          const artifact = checkpoint(
            ToolIds.ResolvePageAssets,
            "page_assets",
            assets,
            ["page_html", "page_quality"],
          );
          return success({
            committed: true,
            summary: `页面素材已保存，共 ${assets.length} 项。`,
            data: {
              artifactRef: toArtifactRef(artifact),
              assetCount: assets.length,
            },
            artifactRefs: [toArtifactRef(artifact)],
          });
        }),
    }),

    [ToolIds.GeneratePageHtml]: tool({
      description:
        "把已保存的内容、当前页视觉方向和素材实现为安全的单页 HTML，并立即保存 checkpoint。",
      inputSchema: ScopeInputSchema,
      execute: (_input, options) =>
        runExclusive(async () => {
          const snapshot =
            loadPageBuilderWorkingSnapshot(execution);
          if (!snapshot.content) {
            return failure(
              "PAGE_CONTENT_MISSING",
              "必须先生成页面内容。",
              ["先调用 generate_page_content。"],
            );
          }
          if (
            snapshot.content.assetSlots.length > 0 &&
            !snapshot.assets
          ) {
            return failure(
              "PAGE_ASSETS_MISSING",
              "页面声明了素材槽，但素材尚未解析。",
              ["先调用 resolve_page_assets。"],
            );
          }
          if (snapshot.html) {
            return reused(
              snapshot.workOrder,
              "page_html",
              "已复用保存的页面 HTML。",
            );
          }
          const generated = await recoverableModelStep(
            () =>
              modelSteps.generateHtml({
                execution,
                content: snapshot.content!,
                assets: snapshot.assets ?? [],
                validationFeedback: execution.fixPlan?.feedback,
                abortSignal:
                  options.abortSignal ?? execution.abortSignal,
              }),
            options.abortSignal ?? execution.abortSignal,
            "PAGE_HTML_GENERATION_FAILED",
            "页面 HTML 生成失败，可以根据合同反馈重试。",
          );
          if (!generated.ok) return generated;
          const html = HtmlOutputSchema.parse(generated.data);
          if (
            fixTargetIsUnchanged(
              execution,
              "page_html",
              html,
            )
          ) {
            return unchangedFixFailure("页面 HTML");
          }
          const artifact = checkpoint(
            ToolIds.GeneratePageHtml,
            "page_html",
            html,
            ["page_quality"],
          );
          return success({
            committed: true,
            summary: "页面 HTML 已通过生成阶段合同并保存。",
            data: {
              artifactRef: toArtifactRef(artifact),
              htmlBytes: new TextEncoder().encode(html.html).byteLength,
            },
            artifactRefs: [toArtifactRef(artifact)],
          });
        }),
    }),

    [ToolIds.InspectPage]: tool({
      description:
        "把刚才的浏览器证据与静态检查封装成只读质量报告。课程语义与审美由当前 Agent 和整课 Reviewer 判断，不再启动一次性 QA 模型。",
      inputSchema: ScopeInputSchema,
      execute: (_input, options) =>
        runExclusive(async () => {
          const snapshot =
            loadPageBuilderWorkingSnapshot(execution);
          if (!snapshot.content || !snapshot.html) {
            return failure(
              "PAGE_ARTIFACTS_MISSING",
              "质量检查需要页面内容和 HTML。",
              ["先补齐 PageContentDSL 和 HTML。"],
            );
          }
          if (snapshot.quality) {
            return reused(
              snapshot.workOrder,
              "page_quality",
              "已复用保存的质量报告。",
            );
          }
          let quality;
          if (execution.legacyModelPipeline) {
            const inspected = await recoverableModelStep(
              () =>
                modelSteps.inspectPage({
                  execution,
                  content: snapshot.content!,
                  assets: snapshot.assets ?? [],
                  html: snapshot.html!,
                  abortSignal:
                    options.abortSignal ?? execution.abortSignal,
                }),
              options.abortSignal ?? execution.abortSignal,
              "PAGE_INSPECTION_FAILED",
              "页面质量检查失败，可以重试。",
            );
            if (!inspected.ok) return inspected;
            quality = QualityReportSchema.parse(inspected.data);
          } else {
            const render = execution.latestRenderEvidence;
            if (
              !render ||
              render.htmlRevision !== snapshot.html.revision
            ) {
              return failure(
                "PAGE_RENDER_EVIDENCE_STALE",
                "当前 HTML 没有对应的最新浏览器证据。",
                ["先调用 render_page，再封装质量报告。"],
              );
            }
            quality = buildAgentLoopQualityReport({
              pageId: execution.pageId,
              content: snapshot.content,
              html: snapshot.html.html,
              assets: snapshot.assets ?? [],
              browserIssues: render.issues,
              screenshotEvidence: render.evidence,
            });
          }
          const artifact = checkpoint(
            ToolIds.InspectPage,
            "page_quality",
            quality,
          );
          return success({
            committed: true,
            summary:
              quality.decision === "pass" && !quality.shouldRepair
                ? `页面质量检查通过：${quality.overallScore} 分。`
                : `页面需要返工：${quality.issues.length} 个问题。`,
            data: {
              artifactRef: toArtifactRef(artifact),
              decision: quality.decision,
              issueCodes: quality.issues.map(({ code }) => code),
              overallScore: quality.overallScore,
              shouldRepair: quality.shouldRepair,
            },
            artifactRefs: [toArtifactRef(artifact)],
          });
        }),
    }),

    [ToolIds.RepairPageContent]: tool({
      description:
        "只在 QA 把问题确定性定位到 DSL 时，按获准 block/字段修补页面内容。",
      inputSchema: ScopeInputSchema,
      execute: (_input, options) =>
        runExclusive(() =>
          repairPageArtifact({
            execution,
            modelSteps,
            requestedTarget: "dsl",
            checkpoint,
            toolCallId: options.toolCallId,
            abortSignal:
              options.abortSignal ?? execution.abortSignal,
          }),
        ),
    }),

    [ToolIds.RepairPageHtml]: tool({
      description:
        "只在 QA 把问题确定性定位到 HTML/CSS 时，按获准 selector 修补页面。",
      inputSchema: ScopeInputSchema,
      execute: (_input, options) =>
        runExclusive(() =>
          repairPageArtifact({
            execution,
            modelSteps,
            requestedTarget: "html",
            checkpoint,
            toolCallId: options.toolCallId,
            abortSignal:
              options.abortSignal ?? execution.abortSignal,
          }),
        ),
    }),

    [ToolIds.SubmitPage]: tool({
      description:
        "重新执行确定性 Page Gate；只有全部通过后才原子接受页面并更新 CourseRun。",
      inputSchema: ScopeInputSchema,
      execute: () =>
        runExclusive(async () => {
          const snapshot =
            loadPageBuilderWorkingSnapshot(execution);
          if (!hasPageBuilderSubstantiveFix(execution)) {
            return failure(
              "PAGE_FIX_NOT_APPLIED",
              "Fix WorkOrder 尚未产生获准的实质修订产物。",
              ["先按 fixPlan 生成新的 PageContent 或 PageHTML。"],
            );
          }
          if (
            !snapshot.content ||
            !snapshot.html ||
            !snapshot.quality
          ) {
            return failure(
              "PAGE_SUBMISSION_INCOMPLETE",
              "提交页面前必须有内容、HTML 和质量报告。",
              ["补齐缺失产物后再次提交。"],
            );
          }
          let gate: PageGateResult;
          try {
            gate = pageGate({
              architecture: execution.architecture,
              creationBrief: execution.creationBrief,
              referencePacks: execution.referencePacks,
              pageId: execution.pageId,
              content: snapshot.content,
              assets: snapshot.assets ?? [],
              html: snapshot.html,
              quality: snapshot.quality,
            });
          } catch (error) {
            throw new FatalAgentRuntimeError(
              "PAGE_GATE_FAILED",
              "页面提交检查执行失败。",
              error,
            );
          }
          if (!gate.ok) {
            return failure(
              "PAGE_GATE_FAILED",
              "页面尚未通过确定性提交 Gate。",
              gate.issues.map(
                ({ code, path, message }) =>
                  `${code} @ ${path}: ${message}`,
              ),
            );
          }
          const committed =
            execution.repository.commitPageSubmission({
              workOrderId: execution.initialWorkOrder.id,
              expectedWorkOrderLockVersion:
                execution.currentLockVersion,
              workOrderLeaseOwner: execution.workOrderLeaseOwner,
              runLeaseOwner: execution.runLeaseOwner,
              traceId: execution.traceId,
              pageGatePassed: true,
              payloads: gate.payloads,
              evidence: [
                "HTML、安全、截图和质量门槛全部通过；兼容摘要由 Harness 生成",
              ],
            });
          execution.currentLockVersion =
            committed.workOrder.lockVersion;
          return success({
            committed: true,
            terminal: true,
            summary: `页面 ${execution.pageTask.title} 已接受。`,
            data: {
              pageId: execution.pageId,
              workOrderId: committed.workOrder.id,
            },
            artifactRefs:
              committed.workOrder.submission?.artifactRefs,
          });
        }),
    }),

    [ToolIds.BlockPage]: tool({
      description:
        "仅在读取上下文、已有失败 PageQuality，且 repair 明确拒绝、无法授权修复或修订预算耗尽时阻塞页面。普通生成或 Provider 失败不能阻塞。",
      inputSchema: BlockPageInputSchema,
      execute: ({ code, message }) =>
        runExclusive(async () => {
          const eligibility =
            evaluatePageBlockEligibility(execution);
          if (!eligibility.ok) {
            return failure(
              "PAGE_BLOCK_NOT_ALLOWED",
              eligibility.message,
              eligibility.feedback,
              true,
            );
          }
          const publicError = classifyPublicAgentError({
            code,
            fallbackCode: "PAGE_WORK_ORDER_BLOCKED",
          });
          const blocked =
            execution.repository.blockPageWorkOrder({
              workOrderId: execution.initialWorkOrder.id,
              expectedWorkOrderLockVersion:
                execution.currentLockVersion,
              workOrderLeaseOwner: execution.workOrderLeaseOwner,
              runLeaseOwner: execution.runLeaseOwner,
              traceId: execution.traceId,
              code: publicError.code,
              message,
              evidence: eligibility.evidence,
            });
          execution.currentLockVersion =
            blocked.workOrder.lockVersion;
          const blockedMessage =
            blocked.workOrder.error?.message ?? publicError.message;
          return success({
            committed: true,
            terminal: true,
            summary: `页面已阻塞：${blockedMessage}`,
            data: {
              code: publicError.code,
              pageId: execution.pageId,
              workOrderId: blocked.workOrder.id,
            },
            artifactRefs:
              blocked.workOrder.submission?.artifactRefs,
          });
        }),
    }),
  };

  return guardPageBuilderStateTransitions(tools, execution);
}

function normalizePageCreatorHtml(html: string) {
  const withoutProviderReasoningTags = html
    .replace(/<think\b[^>]*>[\s\S]*?<\/think\s*>/gi, "")
    .replace(/<\/?think(?:[_-][a-z0-9]+)*\b[^>]*>/gi, "");
  const lower = withoutProviderReasoningTags.toLowerCase();
  const doctypeStart = lower.indexOf("<!doctype");
  const htmlStart = lower.indexOf("<html");
  const documentStart =
    doctypeStart >= 0 ? doctypeStart : htmlStart;
  const htmlEnd = lower.lastIndexOf("</html>");
  // 部分 OpenAI-compatible Provider 会把工具参数中的完整 HTML 再包一层
  // CDATA、Markdown fence 或解释文本。HTML 文档本身已经有稳定 envelope，
  // 在工具边界提取它比让 Agent 再耗一个模型回合清理格式更可靠。
  const extractedDocument =
    documentStart >= 0 && htmlEnd >= documentStart
      ? withoutProviderReasoningTags.slice(
          documentStart,
          htmlEnd + "</html>".length,
        )
      : withoutProviderReasoningTags;
  const selfContainedDocument = extractedDocument
    // 页面运行时禁止外链；字体 link/@import 只影响非关键字体加载，删除后
    // 现有 font-family fallback 仍成立，无需再消耗模型回合做机械清理。
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/@import\s+[^;]+;/gi, "");
  const normalized = normalizeWideSingleColumnBreakpoints(
    selfContainedDocument,
  );
  return typeof normalized === "string"
    ? normalized
    : selfContainedDocument;
}

/**
 * activeTools 负责减少模型选择面，这里再做执行时状态核对，防止同一步的
 * 旧工具调用在前一个工具已改变状态后继续写入。
 */
function guardPageBuilderStateTransitions<
  Tools extends Record<string, Record<string, unknown>>,
>(tools: Tools, execution: PageBuilderExecution): Tools {
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, definition]) => {
      const execute = definition.execute;
      if (typeof execute !== "function") return [toolName, definition];

      return [
        toolName,
        {
          ...definition,
          execute(this: unknown, input: unknown, options: unknown) {
            const activeTools = resolvePageBuilderActiveTools(execution);
            if (
              STATE_GUARDED_PAGE_TOOL_IDS.has(toolName) &&
              !activeTools.includes(toolName as PageBuilderToolName)
            ) {
              return failure(
                "PAGE_TOOL_STATE_STALE",
                `页面状态已经推进，不能继续执行 ${toolName}。`,
                [`当前只允许：${activeTools.join(", ") || "无"}。`],
              );
            }
            return execute.call(this, input, options);
          },
        },
      ];
    }),
  ) as Tools;
}

function buildAgentLoopQualityReport(input: {
  pageId: string;
  content: PageContentDSL;
  html: string;
  assets: AssetGenerationResult[];
  browserIssues: Parameters<typeof buildPageQualityReport>[0]["browserIssues"];
  screenshotEvidence: Parameters<
    typeof buildPageQualityReport
  >[0]["screenshotEvidence"];
}) {
  const observed = (summary: string) => ({ score: 90, summary });
  return buildPageQualityReport({
    pageId: input.pageId,
    modelDimensions: {
      contentAccuracy: observed("内容合同已通过；整课语义由 Reviewer 复核。"),
      courseCoherence: observed("页面职责已映射；跨页连贯性由 Reviewer 复核。"),
      layoutQuality: observed("布局以真实浏览器证据为准。"),
      styleConsistency: observed("视觉选择由 Page Creator 自主完成。"),
      htmlRuntime: { score: 100, summary: "HTML 与运行时合同已通过。" },
      assetUsability: observed("素材覆盖与浏览器加载状态已检查。"),
    },
    heuristicIssues: basicLayoutHeuristics({
      content: input.content,
      html: input.html,
      assets: input.assets,
    }),
    modelIssues: [],
    browserIssues: input.browserIssues,
    screenshotEvidence: input.screenshotEvidence,
  });
}

export type PageBuilderTools = ReturnType<
  typeof createPageBuilderTools
>;

export function resolvePageBuilderActiveTools(
  execution: PageBuilderExecution,
): PageBuilderToolName[] {
  const current = loadPageBuilderSnapshot(execution);
  const snapshot = loadPageBuilderWorkingSnapshot(execution);
  if (
    snapshot.workOrder.status === "accepted" ||
    snapshot.workOrder.status === "blocked"
  ) {
    return [];
  }

  const available = new Set(snapshot.workOrder.allowedTools);
  const blockEligibility = evaluatePageBlockEligibility(execution);
  if (blockEligibility.ok) {
    if (
      !execution.legacyModelPipeline &&
      !execution.progress.workspaceRead
    ) {
      return available.has(ToolIds.ReadPageWorkspace)
        ? [ToolIds.ReadPageWorkspace]
        : [];
    }
    if (
      !execution.legacyModelPipeline &&
      execution.progress.workspaceDirty
    ) {
      return available.has(ToolIds.RenderPage)
        ? [ToolIds.RenderPage]
        : [];
    }
    return available.has(ToolIds.BlockPage) ? [ToolIds.BlockPage] : [];
  }
  if (
    !execution.legacyModelPipeline &&
    execution.progress.workspaceDirty
  ) {
    return available.has(ToolIds.RenderPage) ? [ToolIds.RenderPage] : [];
  }
  const base: PageBuilderToolName[] = [
    ToolIds.ReadPageContext,
    ToolIds.ReadPageWorkspace,
  ];
  const requiresPageDesignSkill =
    available.has(ToolIds.ReadLocalResource) &&
    Boolean(execution.localResourceSession);
  if (requiresPageDesignSkill) {
    base.push(ToolIds.ReadLocalResource);
  }
  if (execution.pageTask.referenceUsages.length > 0) {
    base.push(ToolIds.SearchReferences);
  }
  if (!execution.legacyModelPipeline && !execution.progress.contextRead) {
    return available.has(ToolIds.ReadPageContext)
      ? [ToolIds.ReadPageContext]
      : [];
  }
  if (!execution.legacyModelPipeline && !execution.progress.workspaceRead) {
    return available.has(ToolIds.ReadPageWorkspace)
      ? [ToolIds.ReadPageWorkspace]
      : [];
  }
  if (
    execution.initialWorkOrder.kind === "fix_page" &&
    !execution.progress.contextRead
  ) {
    return base.filter((name) => available.has(name));
  }

  let actions: PageBuilderToolName[];
  if (!execution.legacyModelPipeline) {
    if (execution.progress.workspaceDirty) {
      actions = [ToolIds.RenderPage];
    } else if (
      snapshot.quality?.decision === "pass" &&
      !snapshot.quality.shouldRepair
    ) {
      actions = [ToolIds.SubmitPage];
    } else if (snapshot.content && snapshot.html && !snapshot.quality) {
      actions =
        execution.latestRenderEvidence?.htmlRevision ===
        snapshot.html.revision
          ? [ToolIds.InspectPage]
          : [ToolIds.RenderPage];
    } else if (!snapshot.html) {
      // 先产出可渲染初稿。若生图使 HTML checkpoint 失效，也必须先把最新
      // URI 写回 workspace，禁止连续生成多张图片后才第一次观察页面。
      actions = [ToolIds.EditPageWorkspace];
    } else {
      actions = [ToolIds.EditPageWorkspace, ToolIds.GeneratePageImage];
    }
  } else if (
    execution.initialWorkOrder.kind === "fix_page" &&
    !hasPageBuilderSubstantiveFix(execution, current)
  ) {
    actions = [
      execution.fixPlan?.targetArtifact === "page_html"
        ? ToolIds.GeneratePageHtml
        : ToolIds.GeneratePageContent,
    ];
  } else if (!snapshot.content) {
    actions = [ToolIds.GeneratePageContent];
  } else if (
    snapshot.content.assetSlots.length > 0 &&
    !snapshot.assets
  ) {
    actions = [ToolIds.ResolvePageAssets];
  } else if (!snapshot.html) {
    actions = [ToolIds.GeneratePageHtml];
  } else if (!snapshot.quality) {
    actions = [ToolIds.InspectPage];
  } else if (
    snapshot.quality.decision === "pass" &&
    !snapshot.quality.shouldRepair
  ) {
    actions = [ToolIds.SubmitPage];
  } else {
    const repairCount = countPageBuilderRepairs(execution);
    const repairPlan =
      repairCount >= MAX_PAGE_QUALITY_REVISIONS
        ? undefined
        : planRepairRound({
            pageId: execution.pageId,
            content: snapshot.content,
            html: snapshot.html.html,
            visualBrief: execution.projection.briefs.visual,
            assets: snapshot.assets ?? [],
            report: snapshot.quality,
            attemptCount: repairCount,
          });
    actions =
      repairPlan && !("status" in repairPlan)
        ? [
            repairPlan.targetArtifact === "dsl"
              ? ToolIds.RepairPageContent
              : ToolIds.RepairPageHtml,
          ]
        : [];
  }

  if (
    execution.legacyModelPipeline &&
    (snapshot.quality?.decision !== "pass" ||
      snapshot.quality?.shouldRepair)
  ) {
    actions.push(
      ToolIds.EditPageWorkspace,
      ToolIds.GeneratePageImage,
      ToolIds.RenderPage,
    );
  }

  return [...new Set([...base, ...actions])].filter((name) =>
    available.has(name),
  );
}

async function repairPageArtifact(input: {
  execution: PageBuilderExecution;
  modelSteps: PageBuilderModelSteps;
  requestedTarget: "dsl" | "html";
  checkpoint: (
    toolName: PageBuilderToolName,
    kind:
      | "page_content"
      | "page_assets"
      | "page_html"
      | "page_quality",
    payload: unknown,
    invalidates?: Array<
      "page_content" | "page_assets" | "page_html" | "page_quality"
    >,
    toolCallId?: string,
  ) => { id: string; kind: ArtifactRef["kind"] };
  toolCallId?: string;
  abortSignal?: AbortSignal;
}) {
  const snapshot =
    loadPageBuilderWorkingSnapshot(input.execution);
  if (!snapshot.content || !snapshot.html || !snapshot.quality) {
    return failure(
      "PAGE_REPAIR_INPUT_MISSING",
      "页面返工需要内容、HTML 和失败的质量报告。",
      ["先完成 inspect_page。"],
    );
  }
  if (
    snapshot.quality.decision === "pass" &&
    !snapshot.quality.shouldRepair
  ) {
    return failure(
      "PAGE_REPAIR_NOT_REQUIRED",
      "当前质量报告已经通过，不应继续修改页面。",
      ["调用 submit_page。"],
    );
  }
  const repairCount = countPageBuilderRepairs(input.execution);
  if (repairCount >= MAX_PAGE_QUALITY_REVISIONS) {
    return failure(
      "PAGE_REPAIR_BUDGET_EXHAUSTED",
      `页面已经完成 ${MAX_PAGE_QUALITY_REVISIONS} 轮质量修订。`,
      ["调用 block_page，把问题交回主 Agent。"],
      false,
    );
  }
  const plan = planRepairRound({
    pageId: input.execution.pageId,
    content: snapshot.content,
    html: snapshot.html.html,
    visualBrief: input.execution.projection.briefs.visual,
    assets: snapshot.assets ?? [],
    report: snapshot.quality,
    attemptCount: repairCount,
  });
  if ("status" in plan) {
    return failure(
      "PAGE_REPAIR_UNAVAILABLE",
      plan.message,
      ["调用 block_page，不能扩大修复范围。"],
      false,
    );
  }
  if (plan.targetArtifact !== input.requestedTarget) {
    return failure(
      "PAGE_REPAIR_SCOPE_MISMATCH",
      `确定性修复计划要求修改 ${plan.targetArtifact}，不能修改 ${input.requestedTarget}。`,
      [
        `调用 ${
          plan.targetArtifact === "dsl"
            ? ToolIds.RepairPageContent
            : ToolIds.RepairPageHtml
        }。`,
      ],
    );
  }

  const structuralRegenerationFeedback =
    input.requestedTarget === "html"
      ? buildStructuralHtmlRegenerationFeedback(
          snapshot.quality,
        )
      : [];
  const repaired = await recoverableModelStep(
    async () => {
      if (structuralRegenerationFeedback.length > 0) {
        const regenerated = await input.modelSteps.generateHtml({
          execution: input.execution,
          content: snapshot.content!,
          assets: snapshot.assets ?? [],
          validationFeedback: structuralRegenerationFeedback,
          abortSignal: input.abortSignal,
        });
        return {
          status: "applied" as const,
          targetArtifact: "html" as const,
          html: regenerated.html,
          summary:
            "根据真实视口证据从干净检查点重新构建页面结构。",
        };
      }
      return input.modelSteps.repairPage({
        execution: input.execution,
        request: plan,
        abortSignal: input.abortSignal,
      });
    },
    input.abortSignal,
    "PAGE_REPAIR_FAILED",
    "页面定向返工失败，可以重试。",
  );
  const repairToolName =
    input.requestedTarget === "dsl"
      ? ToolIds.RepairPageContent
      : ToolIds.RepairPageHtml;
  if (!repaired.ok) {
    input.execution.progress.repairGenerationFailures += 1;
    if (
      input.execution.progress.repairGenerationFailures >=
      MAX_PAGE_REPAIR_GENERATION_ATTEMPTS
    ) {
      throw new FatalAgentRuntimeError(
        "REPAIR_EXECUTION_RETRY_EXHAUSTED",
        `页面定向返工连续 ${MAX_PAGE_REPAIR_GENERATION_ATTEMPTS} 次生成失败，已停止重复调用。`,
        repaired,
      );
    }
    return repaired;
  }
  input.execution.progress.repairGenerationFailures = 0;
  if (repaired.data.status === "declined") {
    input.execution.repository.recordPageRepairDeclined({
      workOrderId: input.execution.initialWorkOrder.id,
      expectedWorkOrderLockVersion:
        input.execution.currentLockVersion,
      workOrderLeaseOwner:
        input.execution.workOrderLeaseOwner,
      runLeaseOwner: input.execution.runLeaseOwner,
      traceId: input.execution.traceId,
      toolName: repairToolName,
      toolCallId: input.toolCallId,
    });
    recordPageBuilderRepairDeclined(
      input.execution,
      repairToolName,
    );
    return failure(
      "PAGE_REPAIR_DECLINED",
      repaired.data.summary,
      ["无法在授权范围内修复时调用 block_page。"],
      false,
    );
  }
  clearPageBuilderRepairDeclined(input.execution);

  if (repaired.data.targetArtifact === "dsl") {
    const content = PageContentDSLSchema.parse(
      repaired.data.content,
    );
    if (
      fixTargetIsUnchanged(
        input.execution,
        "page_content",
        content,
      )
    ) {
      return unchangedFixFailure("页面内容");
    }
    const artifact = input.checkpoint(
      ToolIds.RepairPageContent,
      "page_content",
      content,
      ["page_assets", "page_html", "page_quality"],
      input.toolCallId,
    );
    return success({
      committed: true,
      summary: repaired.data.summary,
      data: {
        artifactRef: toArtifactRef(artifact),
        next: "重新解析素材并生成 HTML 后检查质量",
      },
      artifactRefs: [toArtifactRef(artifact)],
    });
  }

  const html = HtmlOutputSchema.parse({
    html: repaired.data.html,
    generatedAt: new Date().toISOString(),
    revision: snapshot.html.revision + 1,
  });
  if (
    fixTargetIsUnchanged(
      input.execution,
      "page_html",
      html,
    )
  ) {
    return unchangedFixFailure("页面 HTML");
  }
  const artifact = input.checkpoint(
    ToolIds.RepairPageHtml,
    "page_html",
    html,
    ["page_quality"],
    input.toolCallId,
  );
  return success({
    committed: true,
    summary: repaired.data.summary,
    data: {
      artifactRef: toArtifactRef(artifact),
      next: "重新检查页面质量",
    },
    artifactRefs: [toArtifactRef(artifact)],
  });
}

/**
 * 大幅纵向溢出不是局部 CSS selector 能可靠修好的呈现缺陷。保留原 DSL、
 * 素材与当前页视觉方向，从干净 HTML 检查点重建结构，再走同一
 * checkpoint、re-QA 与修订预算，避免连续追加缩字补丁。
 */
function buildStructuralHtmlRegenerationFeedback(
  quality: z.infer<typeof QualityReportSchema>,
) {
  const issues = quality.issues.filter(
    ({ code, severity }) =>
      severity === "error" &&
      STRUCTURAL_HTML_REGENERATION_CODES.has(code),
  );
  if (issues.length === 0) return [];

  return [
    "VIEWPORT_RECOMPOSE：从干净 HTML 检查点完整重建构图；保留页面事实、学习动作和视觉命题，不沿用旧页面的纵向堆叠，也不要只缩小字号、间距或图片。把 DesignDirection 中的上下阅读顺序翻译成并列、环绕、叠层或主视觉内嵌关系。",
    ...(quality.screenshotEvidence?.captures ?? []).flatMap((capture) => {
      if (capture.status !== "captured") return [];
      const { metrics, viewport } = capture;
      if (!metrics) return [];
      return [
        [
          `viewport=${viewport.width}x${viewport.height}`,
          `documentHeight=${metrics.documentHeight}`,
          `verticalOverflow=${metrics.verticalOverflowPx}`,
          metrics.largestVisualAreaRatio !== undefined
            ? `largestVisualAreaRatio=${metrics.largestVisualAreaRatio.toFixed(2)}`
            : undefined,
          metrics.largestVisualSelector
            ? `largestVisualSelector=${metrics.largestVisualSelector}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" | "),
      ];
    }),
    ...issues.slice(0, 9).map((issue) =>
      [
        issue.code,
        issue.location.viewport
          ? `viewport=${issue.location.viewport}`
          : undefined,
        issue.message,
        issue.repairHint,
      ]
        .filter(Boolean)
        .join(" | ")
        .slice(0, 500),
    ),
  ];
}

function unchangedFixFailure(target: string) {
  return failure(
    "PAGE_FIX_UNCHANGED",
    `${target}与返工前完全相同，不能作为有效修订提交。`,
    ["根据 Review issue 产生可验证的目标差异后再继续。"],
  );
}

function buildAgentAuthoredPageContent(
  execution: PageBuilderExecution,
  metadata: PageWorkspaceMetadata,
  assets: AssetGenerationResult[],
): PageContentDSL {
  const blocks: PageContentDSL["blocks"] = [];
  const interaction: PageContentDSL["interaction"] = { type: "none" };
  return PageContentDSLSchema.parse({
    pageId: execution.pageId,
    functionalTemplateId: execution.pagePlan.functionalTemplateId,
    title: execution.pageTask.title,
    narration: [],
    blocks,
    interaction,
    usedReferences: metadata.usedReferences,
    assetSlots: assets.map((result) => ({
      id: result.request.assetSlotId,
      type: result.asset?.type ?? fallbackAssetType(result.request.assetType),
      role: result.asset?.role ?? fallbackAssetRole(result.request.assetType),
      purpose: result.request.usage,
      required: true,
      altTextGuidance:
        result.asset?.altText || result.request.usage,
    })),
    layoutHints: {
      contentDensity:
        execution.pageTask.teachingPoints.length >= 6 ? "dense" : "balanced",
      visualPriority:
        execution.pageTask.visualDesign?.theme ?? "以本页学习目标为视觉中心",
      groupingStrategy: "由 Page Creator 根据教学目标自主构图",
      readingOrder: [],
    },
    runtime: buildLessonRuntime({
      page: execution.pagePlan,
      blocks,
      interaction,
    }),
  });
}

function fallbackAssetType(
  kind: AssetGenerationResult["request"]["assetType"],
) {
  return kind === "icon" ? "icon" : "image";
}

function fallbackAssetRole(
  kind: AssetGenerationResult["request"]["assetType"],
) {
  if (kind === "background") return "background";
  if (kind === "texture") return "decorative";
  return "inline";
}

function buildPageWorkspaceTask(execution: PageBuilderExecution) {
  const visualReferences = buildCourseVisualReferences({
    architecture: execution.architecture,
    creationBrief: execution.creationBrief,
  });
  return `# Page Creator WorkOrder

页面：${execution.pageTask.title}（${execution.pageId}）

目标：${execution.pageTask.purpose}

学习动作：${execution.pageTask.learnerAction}

验收：${execution.initialWorkOrder.acceptance.join("；")}

视觉参考：${JSON.stringify(visualReferences)}

## 最小运行合同

- 自主创作完整的 \`index.html\`，必须包含 doctype、viewport、内联 style 和唯一 main。
- HTML 是页面内容真相，不需要同时填写内容 DSL，也不强制 data 标记或规划阶段的互动类型。
- 简单探索优先使用 details/summary；普通 button 不会自动产生反馈，表单或平台互动必须能被 interactionSteps 回放证明。
- 不写 script、内联事件、外链资源或远程 CSS。
- 唯一 main 是 1920×1080 的 16:9 设计舞台，宿主负责同比例缩放；不要复制多页 deck wrapper、导航控制器或作者脚本。页面在 1280×720、960×540、640×360 完整显示，根页面和任何正文区域都不能滚动。
- 内容放不下时先重组为画布级网格、叠层、环绕或渐进互动；若仍超载，应明确阻塞并要求 Course Lead 拆页，不能缩小正文、裁切必要内容或制造滚动条。
- 构图、色彩、字体层级、内容关系和素材数量不受模板约束。
`;
}

function buildPageWorkspaceInitialState(execution: PageBuilderExecution) {
  const snapshot = loadPageBuilderWorkingSnapshot(execution);
  if (!snapshot.html) return undefined;
  return {
    html: snapshot.html.html,
    metadata: {
      usedReferences: snapshot.content?.usedReferences ?? [],
    },
  };
}
