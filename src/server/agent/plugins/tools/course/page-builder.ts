import { tool } from "ai";
import { z } from "zod";

import { SkillIds, ToolIds } from "@/server/agent/ids";
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
import {
  defaultPageBuilderModelSteps,
  type PageBuilderModelSteps,
} from "@/server/agent/plugins/tools/course/page-builder-model-steps";
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
import { planRepairRound } from "@/server/course/page/repair-plan";
import {
  AssetGenerationResultSchema,
  HtmlOutputSchema,
  PageContentDSLSchema,
  QualityReportSchema,
  type ArtifactRef,
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

export type PageBuilderToolDependencies = {
  modelSteps?: PageBuilderModelSteps;
  pageGate?: (input: Parameters<typeof runPageGate>[0]) => PageGateResult;
  readLocalResourceTool?: ReadLocalResourceTool;
};

export function createPageBuilderTools(
  execution: PageBuilderExecution,
  dependencies: PageBuilderToolDependencies = {},
) {
  const modelSteps =
    dependencies.modelSteps ?? defaultPageBuilderModelSteps;
  const pageGate = dependencies.pageGate ?? runPageGate;
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

  return {
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
            pageTask: execution.pageTask,
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
                    contentVersion: execution.baseline.content.version,
                    htmlVersion: execution.baseline.html.version,
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
          if (!generated.ok) return generated;

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
        "把已保存的内容和素材实现为安全的单页 HTML，并立即保存 checkpoint。",
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
        "对当前 HTML 执行静态检查、真实浏览器截图和语义 QA；报告只读并立即保存。",
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
          const quality = QualityReportSchema.parse(inspected.data);
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
          const gate = pageGate({
            architecture: execution.architecture,
            creationBrief: execution.creationBrief,
            referencePacks: execution.referencePacks,
            pageId: execution.pageId,
            content: snapshot.content,
            assets: snapshot.assets ?? [],
            html: snapshot.html,
            quality: snapshot.quality,
          });
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
                "PageContentDSL、HTML、安全、截图和质量门槛全部通过",
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
      execute: ({ code }) =>
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
              message: publicError.message,
              evidence: eligibility.evidence,
            });
          execution.currentLockVersion =
            blocked.workOrder.lockVersion;
          return success({
            committed: true,
            terminal: true,
            summary: `页面已阻塞：${publicError.message}`,
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
  const base: PageBuilderToolName[] = [ToolIds.ReadPageContext];
  const requiresPageDesignSkill =
    available.has(ToolIds.ReadLocalResource) &&
    Boolean(execution.localResourceSession);
  if (requiresPageDesignSkill) {
    base.push(ToolIds.ReadLocalResource);
  }
  if (execution.pageTask.referenceUsages.length > 0) {
    base.push(ToolIds.SearchReferences);
  }
  if (
    requiresPageDesignSkill &&
    !execution.localResourceSession?.activatedSkillIds.includes(
      SkillIds.CoursePageDesign,
    )
  ) {
    return base.filter((name) => available.has(name));
  }
  if (
    execution.initialWorkOrder.kind === "fix_page" &&
    !execution.progress.contextRead
  ) {
    return base.filter((name) => available.has(name));
  }

  let actions: PageBuilderToolName[];
  if (
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

  if (evaluatePageBlockEligibility(execution).ok) {
    actions.push(ToolIds.BlockPage);
  }

  return [...base, ...actions].filter((name) =>
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

  const repaired = await recoverableModelStep(
    () =>
      input.modelSteps.repairPage({
        execution: input.execution,
        request: plan,
        abortSignal: input.abortSignal,
      }),
    input.abortSignal,
    "PAGE_REPAIR_FAILED",
    "页面定向返工失败，可以重试。",
  );
  const repairToolName =
    input.requestedTarget === "dsl"
      ? ToolIds.RepairPageContent
      : ToolIds.RepairPageHtml;
  if (!repaired.ok) {
    return repaired;
  }
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
    version: snapshot.html.version + 1,
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

function unchangedFixFailure(target: string) {
  return failure(
    "PAGE_FIX_UNCHANGED",
    `${target}与返工前完全相同，不能作为有效修订提交。`,
    ["根据 Review issue 产生可验证的目标差异后再继续。"],
  );
}
