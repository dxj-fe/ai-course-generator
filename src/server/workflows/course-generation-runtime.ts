import type { AgentRuntimeContext } from "@/server/agents/core/types";
import { runCoursePlannerAgent } from "@/server/agents/course-planner-agent";
import {
  normalizeChoiceRuntimeMarkers,
  removeRedundantRestoredDslMarkup,
  runHtmlEngineerAgent,
} from "@/server/agents/html-engineer-agent";
import { generateCourseIntent } from "@/server/agents/intent-agent";
import { runPageQAAgent } from "@/server/agents/page-qa-agent";
import {
  buildLessonRuntime,
  exceedsFixedCanvasCapacity,
  runPageWriterAgent,
} from "@/server/agents/page-writer-agent";
import { runRepairAgent } from "@/server/agents/repair-agent";
import { runSupervisorAgent } from "@/server/agents/supervisor-agent";
import { hasSafelyContainedOpaqueAssetFallback } from "@/server/quality/basic-layout-heuristics";
import { createCourseStore } from "@/server/storage/course-store";
import { runCourseDesignWorkflow } from "@/server/workflows/course-design-workflow";
import {
  CourseGenerationNodeError,
  type CourseGenerationNode,
  type CourseGenerationNodeContext,
  type CourseGenerationNodeDependencies,
  type CourseGenerationNodeEvent,
  type CourseGenerationNodeName,
  type CourseMvpPageCount,
} from "@/server/workflows/course-generation-nodes";
import { runImageAssetWorkflow } from "@/server/workflows/image-asset-workflow";
import { generatePageWorker } from "@/server/workflows/page-worker";
import {
  runSequentialWorkflow,
  type SequentialWorkflowResult,
  type WorkflowNodeError,
} from "@/server/workflows/sequential-workflow";
import {
  CourseGenerationStateSchema,
  MAX_REPAIR_ATTEMPTS,
  PageGenerationStateSchema,
  PageWorkerConfigSchema,
  type CourseGenerationError,
  type CourseGenerationPublicEvent,
  type CourseGenerationStage,
  type CourseGenerationState,
  type PagePlan,
  type PageGenerationState,
  type PageWorkerMode,
  type ReferencePack,
} from "@/shared/course-schema";

export type CourseGenerationWorkflowInput = {
  courseId: string;
  userPrompt: string;
  referencePacks?: ReferencePack[];
  pageCount?: CourseMvpPageCount;
  executionMode?: PageWorkerMode;
  concurrency?: number;
  existingState?: CourseGenerationState;
};

export type CourseGenerationWorkflowDependencies =
  CourseGenerationNodeDependencies & {
    runSupervisor: typeof runSupervisorAgent;
    runQA: typeof runPageQAAgent;
    runRepair: typeof runRepairAgent;
    generatePage: typeof generatePageWorker;
    checkpoint(state: CourseGenerationState): Promise<void>;
    now(): string;
  };

export type CourseNodeRunResult = SequentialWorkflowResult<
  CourseGenerationState,
  CourseGenerationNode["name"]
>;

const courseStore = createCourseStore();
const defaultDependencies: CourseGenerationWorkflowDependencies = {
  generateIntent: generateCourseIntent,
  runPlanner: runCoursePlannerAgent,
  runDesign: runCourseDesignWorkflow,
  runPageWriter: runPageWriterAgent,
  runAssets: runImageAssetWorkflow,
  runHtml: runHtmlEngineerAgent,
  runQA: runPageQAAgent,
  runRepair: runRepairAgent,
  generatePage: generatePageWorker,
  runSupervisor: runSupervisorAgent,
  checkpoint: courseStore.save,
  now: () => new Date().toISOString(),
};

export function resolveCourseGenerationDependencies(
  overrides: Partial<CourseGenerationWorkflowDependencies> = {},
): CourseGenerationWorkflowDependencies {
  return { ...defaultDependencies, ...overrides };
}

export function initializeCourseGenerationState(
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  now: () => string,
): CourseGenerationState {
  if (input.existingState) {
    const existing = CourseGenerationStateSchema.parse(input.existingState);
    if (
      existing.courseId !== input.courseId ||
      existing.userPrompt !== input.userPrompt
    ) {
      throw new Error("恢复输入必须与持久化课程的 courseId 和 userPrompt 一致。");
    }
    if (
      input.referencePacks &&
      JSON.stringify(input.referencePacks) !==
        JSON.stringify(existing.referencePacks ?? [])
    ) {
      throw new Error("恢复输入不能更换持久化课程的 Reference Pack。");
    }
    if (existing.status === "completed") return existing;

    const workerConfig = resolveWorkerConfig(input, existing.workerConfig);
    const resetSupervisorPageIds = new Set<string>();
    const pages = existing.pages.map((page) => {
      const pagePlan = existing.outline?.pages.find(
        ({ id }) => id === page.pageId,
      );
      const staleRunningErrorCleared = clearStaleRunningPageError(page);
      const disabledChoiceRecovered =
        recoverLegacyDisabledChoiceRepairFailure(staleRunningErrorCleared);
      const recovered =
        recoverLegacyUnauthorizedIssueCodeRepairFailure(
          disabledChoiceRecovered,
        );
      const choiceScopeRecovered =
        recoverLegacyChoiceQuestionScopeFailure(recovered);
      const visualDominanceRecovered =
        recoverUnlocatableVisualDominanceFailure(
          choiceScopeRecovered,
        );
      const transparencyRecovered =
        recoverStaleTransparencyCapabilityFailure(
          visualDominanceRecovered,
        );
      const modelQaRecovered =
        recoverStaleUnlocatableModelQaFailure(
          transparencyRecovered,
        );
      const restoredDuplicationRecovered =
        recoverStaleRestoredContentDuplication(modelQaRecovered);
      const visualPrimitiveRecovered =
        recoverStaleProgrammingVisualPrimitiveFailure(
          restoredDuplicationRecovered,
          pagePlan,
        );
      const viewportFitRecovered =
        recoverPreViewportFitLayoutCheckpoint(visualPrimitiveRecovered);
      const cleanReQaRecovered =
        recoverStructurallyInvalidReQaFromCleanCheckpoint(
          viewportFitRecovered,
        );
      const interruptedRepairRecovered =
        recoverInterruptedRepairFromCleanCheckpoint(cleanReQaRecovered);
      const cleanRepairRecovered =
        recoverFailedRepairFromCleanCheckpoint(interruptedRepairRecovered);
      const rearmed = rearmRecoverableRepairExecutionFailure(
        cleanRepairRecovered,
      );
      if (
        staleRunningErrorCleared !== page ||
        recovered !== disabledChoiceRecovered ||
        choiceScopeRecovered !== recovered ||
        visualDominanceRecovered !== choiceScopeRecovered ||
        transparencyRecovered !== visualDominanceRecovered ||
        modelQaRecovered !== transparencyRecovered ||
        restoredDuplicationRecovered !== modelQaRecovered ||
        visualPrimitiveRecovered !== restoredDuplicationRecovered ||
        viewportFitRecovered !== visualPrimitiveRecovered ||
        cleanReQaRecovered !== viewportFitRecovered ||
        interruptedRepairRecovered !== cleanReQaRecovered ||
        cleanRepairRecovered !== interruptedRepairRecovered ||
        rearmed !== cleanRepairRecovered
      ) {
        resetSupervisorPageIds.add(rearmed.pageId);
      }
      /**
       * 进入这里代表用户已经显式创建了一次检查点恢复任务。自动重试仍由
       * Page Worker 的错误分类和单次预算限制；显式恢复则必须重新开放所有
       * 非 Repair 失败页，才能在额度、认证或配置恢复后真正继续。
       */
      if (
        rearmed.status === "failed" &&
        rearmed.currentStage !== "repair"
      ) {
        resetSupervisorPageIds.add(rearmed.pageId);
        const failureCode =
          rearmed.error?.causeCode ?? rearmed.error?.code ?? "";
        const clearExternalFailure = [
          "QUOTA_ERROR",
          "AUTH_ERROR",
          "CONFIG_ERROR",
        ].includes(failureCode);
        return {
          ...rearmed,
          status: "running" as const,
          attempts: rearmed.attempts?.filter(
            ({ stage }) => stage !== rearmed.currentStage,
          ),
          error: clearExternalFailure ? undefined : rearmed.error,
        };
      }
      return rearmed.status === "failed"
        ? {
            ...rearmed,
            attempts: rearmed.attempts?.filter(
              ({ stage }) => stage !== rearmed.currentStage,
            ),
          }
        : rearmed;
    });
    const persistedSupervisor = existing.supervisor ?? {
      decisionCount: 0,
      attempts: [],
    };
    const supervisor =
      resetSupervisorPageIds.size === 0
        ? persistedSupervisor
        : {
            ...persistedSupervisor,
            attempts: persistedSupervisor.attempts.filter(
              ({ pageId }) =>
                !pageId || !resetSupervisorPageIds.has(pageId),
            ),
            lastDecision: undefined,
          };
    return CourseGenerationStateSchema.parse({
      ...existing,
      status: "running",
      traceId: context.traceId,
      errors: [],
      completedAt: undefined,
      durationMs: undefined,
      supervisor,
      workerConfig,
      pages,
      updatedAt: now(),
    });
  }

  const timestamp = now();
  return CourseGenerationStateSchema.parse({
    version: 1,
    courseId: input.courseId,
    traceId: context.traceId,
    userPrompt: input.userPrompt,
    referencePacks: input.referencePacks,
    status: "running",
    currentStage: "intent",
    pages: [],
    events: [],
    errors: [],
    supervisor: { decisionCount: 0, attempts: [] },
    workerConfig: resolveWorkerConfig(input),
    startedAt: timestamp,
    updatedAt: timestamp,
  });
}

/**
 * HTML Engineer 2.1.0 曾允许 disabled choice 控件进入 QA，而旧 Repair
 * 又只能唯一替换 search，导致重复 disabled 属性白白耗尽两轮预算。
 * 只迁移这一种已知基础设施失败：废弃无效候选历史并重新生成该页 HTML。
 */
function recoverLegacyDisabledChoiceRepairFailure(
  page: PageGenerationState,
): PageGenerationState {
  const history = page.repairHistory ?? [];
  const isKnownFailure =
    page.status === "failed" &&
    page.currentStage === "repair" &&
    page.error?.code === "REPAIR_FAILED" &&
    page.error.message.includes("search 必须在当前文档中唯一匹配") &&
    page.error.message.includes("INTERACTIVE_OPTIONS_DISABLED") &&
    history.length === 2 &&
    history.every(
      (attempt) =>
        attempt.status === "failed" &&
        attempt.failureClass === "agent_failed" &&
        attempt.issueCodes.includes("INTERACTIVE_OPTIONS_DISABLED"),
    );

  if (!isKnownFailure) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "html",
    htmlOutput: undefined,
    qualityReport: undefined,
    repairHistory: [],
    error: {
      code: "HTML_ENGINEER_FAILED",
      message:
        "生成 HTML 校验失败：页面必须包含且只能包含一个 main 主内容区域；choice 互动的单选或复选控件不得包含 disabled 属性。",
    },
  });
}

/**
 * Repair 旧实现会把模型候选合同错误也计入两轮质量修订预算。该精确签名下
 * 页面产物并未改变，因此丢弃失败轮次并从已有 HTML 重新执行 QA。
 */
function recoverLegacyUnauthorizedIssueCodeRepairFailure(
  page: PageGenerationState,
): PageGenerationState {
  const history = page.repairHistory ?? [];
  const isKnownFailure =
    page.status === "failed" &&
    page.currentStage === "repair" &&
    page.error?.code === "REPAIR_FAILED" &&
    page.error.message.includes(
      "RepairResult 引用了未授权的 issue code",
    ) &&
    history.length === 2 &&
    history.every(
      (attempt) =>
        attempt.status === "failed" &&
        attempt.failureClass === "agent_failed",
    );

  if (!isKnownFailure) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "qa",
    qualityReport: undefined,
    repairHistory: [],
    error: undefined,
  });
}

/**
 * 旧 choice HTML 曾把 data-question-id 放在只有题干的节点上，而选项是相邻
 * 兄弟节点。当前可信运行时要求题目 scope 同时包含其 option value；恢复时
 * 只对这一精确失败机械移动标记并重新 QA，不重新请求模型。
 */
function recoverLegacyChoiceQuestionScopeFailure(
  page: PageGenerationState,
): PageGenerationState {
  const isKnownFailure =
    page.status === "failed" &&
    page.currentStage === "repair" &&
    page.error?.code === "REPAIR_EXECUTION_RETRY_EXHAUSTED" &&
    page.error.message.includes("必须绑定唯一 input value") &&
    page.content?.version === 2 &&
    page.content.interaction.type === "choice" &&
    Boolean(page.htmlOutput);
  if (!isKnownFailure || !page.content || !page.htmlOutput) return page;

  const html = normalizeChoiceRuntimeMarkers(page.htmlOutput.html, {
    content: page.content,
  });
  if (typeof html !== "string" || html === page.htmlOutput.html) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "qa",
    htmlOutput: {
      ...page.htmlOutput,
      html,
      version: page.htmlOutput.version + 1,
    },
    qualityReport: undefined,
    error: undefined,
  });
}

/**
 * 旧截图指标会把低透明、负层级的全屏装饰背景按裸矩形面积判为主视觉，
 * 且没有提供 selector。显式恢复时丢弃这份旧 QA，保留页面产物并重新采证。
 */
function recoverUnlocatableVisualDominanceFailure(
  page: PageGenerationState,
): PageGenerationState {
  const issues = page.qualityReport?.issues ?? [];
  const isKnownFailure =
    page.status === "failed" &&
    page.currentStage === "repair" &&
    page.error?.code === "REPAIR_TARGET_UNAVAILABLE" &&
    issues.length > 0 &&
    issues.every(
      ({ code }) => code === "BROWSER_VISUAL_DOMINATES_VIEWPORT",
    );

  if (!isKnownFailure) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "qa",
    qualityReport: undefined,
    error: undefined,
  });
}

/**
 * 旧 QA 把素材 Provider 的透明通道能力提示当成不可修复页面缺陷。显式恢复
 * 时迁移仅含该提示的旧报告；若页面已经完成可证明的独立容器降级，也迁移
 * 与其他 Repair 执行错误共存的旧报告，重新用当前 HTML 与截图证据评估。
 */
function recoverStaleTransparencyCapabilityFailure(
  page: PageGenerationState,
): PageGenerationState {
  const issues = page.qualityReport?.issues ?? [];
  const transparencyOnly =
    issues.length > 0 &&
    issues.every(
      ({ code }) => code === "ASSET_TRANSPARENCY_UNAVAILABLE",
    );
  const affectedAssets = page.assets.filter(({ warnings }) =>
    warnings?.includes("TRANSPARENCY_UNAVAILABLE"),
  );
  const safelyContained =
    affectedAssets.length > 0 &&
    Boolean(page.htmlOutput) &&
    affectedAssets.every((result) =>
      hasSafelyContainedOpaqueAssetFallback(
        page.htmlOutput!.html,
        result.request.assetSlotId,
        result.asset?.uri,
      ),
    );
  const recoverableFailureCode = new Set([
    "REPAIR_EXECUTION_RETRY_EXHAUSTED",
    "REPAIR_FAILED",
    "REPAIR_TARGET_UNAVAILABLE",
    "REPAIR_TIMEOUT",
  ]);
  const isKnownFailure =
    page.status === "failed" &&
    page.currentStage === "repair" &&
    recoverableFailureCode.has(page.error?.code ?? "") &&
    issues.some(
      ({ code }) => code === "ASSET_TRANSPARENCY_UNAVAILABLE",
    ) &&
    (transparencyOnly || safelyContained);

  if (!isKnownFailure) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "qa",
    qualityReport: undefined,
    error: undefined,
  });
}

/**
 * 旧 QA 曾把可信 reveal runtime 的可见互动项误判为“必须初始隐藏”，并把
 * 无定位的模型语义 warning 当成修订条件。两者都没有可授权 Repair 目标，
 * 显式恢复时保留页面与修订审计，只丢弃旧报告并用当前合同重新 QA。
 */
function recoverStaleUnlocatableModelQaFailure(
  page: PageGenerationState,
): PageGenerationState {
  const issues = page.qualityReport?.issues ?? [];
  const staleRevealCodes = new Set([
    "INTERACTION_CONTENT_NOT_HIDDEN",
    "INTERACTION_ITEM_VISIBILITY",
  ]);
  const hasStaleRevealIssue = issues.some(
    ({ code }) => staleRevealCodes.has(code),
  );
  const onlyStaleModelIssues =
    issues.length > 0 &&
    issues.every(
      (issue) =>
        issue.source === "model" &&
        (staleRevealCodes.has(issue.code) ||
          (issue.severity !== "error" &&
            ["contentAccuracy", "courseCoherence"].includes(
              issue.dimension,
            ) &&
            !issue.location.blockId &&
            !issue.location.selector)),
    );
  const isKnownFailure =
    page.status === "failed" &&
    page.currentStage === "repair" &&
    page.error?.code === "REPAIR_TARGET_UNAVAILABLE" &&
    hasStaleRevealIssue &&
    onlyStaleModelIssues;

  if (!isKnownFailure) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "qa",
    qualityReport: undefined,
    error: undefined,
  });
}

/**
 * 旧版 HTML 正文恢复把 Markdown 反引号与等价的 <code> 展示误判为缺失，
 * 随后插入重复 block。恢复时只删除可证明冗余的恢复节点，并重新 QA。
 */
function recoverStaleRestoredContentDuplication(
  page: PageGenerationState,
): PageGenerationState {
  const isKnownFailure =
    page.status === "failed" &&
    page.currentStage === "repair" &&
    ["REPAIR_EXECUTION_RETRY_EXHAUSTED", "REPAIR_FAILED"].includes(
      page.error?.code ?? "",
    ) &&
    page.qualityReport?.issues.some(
      ({ code }) => code === "CONTENT_DUPLICATION",
    ) &&
    page.content !== undefined &&
    page.htmlOutput?.html.includes(
      'data-course-contract-restored="block"',
    );
  if (!isKnownFailure || !page.content || !page.htmlOutput) return page;

  const html = removeRedundantRestoredDslMarkup(page.htmlOutput.html, {
    content: page.content,
  });
  if (typeof html !== "string" || html === page.htmlOutput.html) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "qa",
    htmlOutput: {
      ...page.htmlOutput,
      html,
      version: page.htmlOutput.version + 1,
    },
    qualityReport: undefined,
    error: undefined,
  });
}

/**
 * 旧运行时只要正文出现“函数”就选择 function-graph，导致 Python 函数被当成
 * 数学函数图。迁移尚无 HTML 产物、准备继续 HTML 阶段的检查点。
 */
function recoverStaleProgrammingVisualPrimitiveFailure(
  page: PageGenerationState,
  pagePlan: PagePlan | undefined,
): PageGenerationState {
  const content = page.content;
  const shouldRecompute =
    (page.status === "failed" || page.status === "running") &&
    page.currentStage === "html" &&
    content?.version === 2 &&
    content.runtime?.visualPrimitive === "function-graph" &&
    !page.htmlOutput &&
    pagePlan !== undefined;
  if (
    !shouldRecompute ||
    !content ||
    content.version !== 2 ||
    !content.runtime ||
    !pagePlan
  ) {
    return page;
  }
  const runtime = content.runtime;

  const visualPrimitive = buildLessonRuntime({
    page: pagePlan,
    blocks: content.blocks,
    interaction: content.interaction,
  }).visualPrimitive;
  if (visualPrimitive === runtime.visualPrimitive) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    content: {
      ...content,
      runtime: {
        ...runtime,
        visualPrimitive,
      },
    },
    attempts: page.attempts?.filter(({ stage }) => stage !== "html"),
    error: undefined,
  });
}

/**
 * 旧 QA 截图曾关闭播放器的 contain-fit 运行时，却用未缩放文档的 scroll
 * size 判定最终学习画布，导致 fluid 页面在多个视口反复 Repair。显式恢复
 * 时保留 HTML/DSL/素材，只清理这类旧报告和已耗尽的局部修订记录，再按
 * 当前播放器运行时重新 QA。
 */
function recoverPreViewportFitLayoutCheckpoint(
  page: PageGenerationState,
): PageGenerationState {
  const fitOwnedIssueCodes = new Set([
    "BROWSER_CANVAS_NOT_FILLED",
    "BROWSER_NESTED_VERTICAL_OVERFLOW",
    "BROWSER_PRIMARY_ACTION_BELOW_FOLD",
    "BROWSER_VERTICAL_OVERFLOW",
    "LAYOUT_CANVAS_COVERAGE",
    "LAYOUT_VERTICAL_OVERFLOW",
  ]);
  const isAffected =
    page.status !== "completed" &&
    page.htmlOutput?.html.includes('data-keya-canvas-mode="fluid"') &&
    page.qualityReport?.shouldRepair === true &&
    page.qualityReport.issues.some(({ code }) =>
      fitOwnedIssueCodes.has(code),
    );
  if (!isAffected) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: "qa",
    qualityReport: undefined,
    repairHistory: [],
    attempts: page.attempts?.filter(({ stage }) => stage !== "qa"),
    error: undefined,
  });
}

/**
 * Repair 候选已写入 HTML、但随后的模型 QA 因结构化输出漂移而失败时，当前
 * HTML 从未得到质量验证，且旧 Repair 轮次不再是可继续追加修改的可信基线。
 * 显式恢复从稳定 DSL/素材重建页面；若 DSL 已超出固定画布容量，则先回到
 * Page Writer 收敛内容。没有 Repair 历史的首次/确定性重建 QA 失败仍可直接
 * 重跑 QA，避免无谓丢弃完整 HTML。
 */
function recoverStructurallyInvalidReQaFromCleanCheckpoint(
  page: PageGenerationState,
): PageGenerationState {
  const isStructurallyInvalidReQa =
    page.status === "failed" &&
    page.currentStage === "qa" &&
    page.error?.code === "PAGE_REQA_FAILED" &&
    (page.repairHistory?.length ?? 0) > 0 &&
    (page.error.causeCode === "SCHEMA_ERROR" ||
      /结构化输出校验失败|Unrecognized key|Invalid (?:input|string)/i.test(
        page.error.message,
      ));
  if (!isStructurallyInvalidReQa) return page;

  const needsContentRewrite =
    page.content !== undefined && exceedsFixedCanvasCapacity(page.content);
  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage: needsContentRewrite ? "page_writer" : "html",
    ...(needsContentRewrite ? { content: undefined, assets: [] } : {}),
    htmlOutput: undefined,
    qualityReport: undefined,
    repairHistory: [],
    attempts: needsContentRewrite
      ? []
      : page.attempts?.filter(
          ({ stage }) => stage !== "html" && stage !== "qa",
        ),
    error: undefined,
  });
}

/**
 * 暂停可能发生在 Repair 请求或 re-QA 之间，此时课程 checkpoint 仍是
 * running，旧候选与累计修订历史不构成可安全续写的基线。显式恢复从稳定
 * DSL/素材重新生成 HTML；内容已经超出固定画布容量时先回到 Page Writer。
 */
function recoverInterruptedRepairFromCleanCheckpoint(
  page: PageGenerationState,
): PageGenerationState {
  if (
    page.status !== "running" ||
    page.currentStage !== "repair" ||
    (page.repairHistory?.length ?? 0) === 0
  ) {
    return page;
  }

  const needsContentRewrite =
    page.content !== undefined && exceedsFixedCanvasCapacity(page.content);
  return PageGenerationStateSchema.parse({
    ...page,
    currentStage: needsContentRewrite ? "page_writer" : "html",
    ...(needsContentRewrite ? { content: undefined, assets: [] } : {}),
    htmlOutput: undefined,
    qualityReport: undefined,
    repairHistory: [],
    attempts: needsContentRewrite
      ? []
      : page.attempts?.filter(
          ({ stage }) => stage !== "html" && stage !== "qa",
        ),
    error: undefined,
  });
}

/**
 * 运行中的页面不能继续向产品层暴露上一轮终态错误。显式恢复已经重新开放
 * 当前阶段，因此同步清空该阶段的旧预算，下一次 Worker 调度会真正执行。
 */
function clearStaleRunningPageError(
  page: PageGenerationState,
): PageGenerationState {
  if (page.status !== "running" || !page.error) return page;

  return PageGenerationStateSchema.parse({
    ...page,
    attempts: page.attempts?.filter(
      ({ stage }) => stage !== page.currentStage,
    ),
    error: undefined,
  });
}

/**
 * Repair 候选结构耗尽或质量停滞说明继续在同一份已反复打补丁的 HTML 上
 * 追加修改已经没有价值。用户显式重试时保留已完成章节及本页上游成果，
 * 从干净 HTML 检查点重建；旧的多题 quiz 已超出固定画布容量，则连同内容
 * 一起回到 Page Writer，按当前单页容量合同重新生成。
 */
function recoverFailedRepairFromCleanCheckpoint(
  page: PageGenerationState,
): PageGenerationState {
  const failureCode = page.error?.code ?? "";
  const failureMessage = page.error?.message ?? "";
  const repairExecutionIsStructurallyCorrupted =
    failureCode === "REPAIR_EXECUTION_RETRY_EXHAUSTED" &&
    (page.error?.causeCode === "SCHEMA_ERROR" ||
      /结构化输出校验失败|Unrecognized key|search 必须在当前文档中唯一匹配/.test(
        failureMessage,
      ) ||
      page.qualityReport?.issues.some(({ code }) =>
        ["CSS_DUPLICATE_RULE", "DUPLICATE_CSS_RULE", "DUPLICATE_CSS_RULES"].includes(
          code,
        ),
      ));
  if (
    page.status !== "failed" ||
    page.currentStage !== "repair" ||
    (failureCode !== "QUALITY_STALLED" &&
      !repairExecutionIsStructurallyCorrupted)
  ) {
    return page;
  }

  const content = page.content;
  const needsContentRewrite =
    content !== undefined &&
    (exceedsFixedCanvasCapacity(content) ||
      (content.interaction.type === "choice" &&
        (content.interaction.questions.length > 1 ||
          (content.functionalTemplateId === "interactive-quiz" &&
            content.blocks.length !== 1))));
  const currentStage = needsContentRewrite ? "page_writer" : "html";

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    currentStage,
    ...(needsContentRewrite ? { content: undefined, assets: [] } : {}),
    htmlOutput: undefined,
    qualityReport: undefined,
    repairHistory: [],
    attempts: needsContentRewrite
      ? []
      : page.attempts?.filter(
          ({ stage }) => stage !== "html" && stage !== "qa",
        ),
    error: undefined,
  });
}

/**
 * 用户显式恢复时重新开放可重试的瞬时 Repair 执行/候选失败，以及用户
 * 已经处理过的额度、认证或配置失败。结构污染和质量停滞已由前置 clean
 * checkpoint 迁移处理；紧急安全上限仍不重置。
 */
function rearmRecoverableRepairExecutionFailure(
  page: PageGenerationState,
): PageGenerationState {
  const recoverableCodes = new Set([
    "AUTH_ERROR",
    "CONFIG_ERROR",
    "QUOTA_ERROR",
    "REPAIR_EXECUTION_RETRY_EXHAUSTED",
    "REPAIR_FAILED",
    "REPAIR_TIMEOUT",
  ]);
  if (
    page.status !== "failed" ||
    page.currentStage !== "repair" ||
    !recoverableCodes.has(page.error?.code ?? "") ||
    (page.repairHistory?.length ?? 0) >= MAX_REPAIR_ATTEMPTS
  ) {
    return page;
  }

  return PageGenerationStateSchema.parse({
    ...page,
    status: "running",
    error: undefined,
  });
}

export async function startCourseGeneration(
  state: CourseGenerationState,
  input: CourseGenerationWorkflowInput,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const next = appendCourseGenerationEvent(state, dependencies.now, {
    type: "start",
    stage: state.currentStage,
    summary: input.existingState
      ? "整课生成已从服务端检查点恢复。"
      : state.workerConfig?.mode === "parallel"
        ? `整课生成已开始，Page Worker 最大并发度为 ${state.workerConfig.concurrency}。`
        : "整课串行生成已开始。",
  });
  return checkpointCourseGenerationState(next, dependencies);
}

/** 统一执行节点生命周期，节点本身不能写 checkpoint 或发布 SSE。 */
export async function runCourseGenerationNodes(
  state: CourseGenerationState,
  nodes: CourseGenerationNode[],
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
  retryFeedback?: CourseGenerationNodeContext["retryFeedback"],
): Promise<CourseNodeRunResult> {
  const result = await runSequentialWorkflow<
    CourseGenerationState,
    CourseGenerationNodeContext,
    CourseGenerationNodeEvent,
    CourseGenerationNodeName,
    CourseGenerationNode
  >({
    state,
    nodes,
    context: {
      runtime: context,
      pageCount: input.pageCount,
      dependencies,
      retryFeedback,
    },
    merge: (current, patch) =>
      CourseGenerationStateSchema.parse({ ...current, ...patch }),
    beforeNode: (current, node) => {
      let next: CourseGenerationState = {
        ...current,
        currentStage: node.stage,
        currentPageId: node.pageId,
      };

      if (node.pageId && isPageStage(node.stage)) {
        const pageStage = node.stage;
        next = updatePage(next, node.pageId, (page) => ({
          ...page,
          status: "running",
          currentStage: pageStage,
          error: undefined,
        }));
      }

      return beginAgent(next, dependencies, {
        stage: node.stage,
        pageId: node.pageId,
        agent: node.agent,
        summary: node.startSummary(next),
      });
    },
    afterNode: async (current, node, nodeResult) => {
      let next = appendNodeEvents(
        current,
        dependencies.now,
        node,
        nodeResult.events,
      );
      next = appendAgentDone(next, dependencies.now, {
        stage: node.stage,
        pageId: node.pageId,
        agent: node.agent,
        summary: node.doneSummary(next),
      });

      for (const event of node.afterDoneEvents?.(next) ?? []) {
        next = appendNodeEvent(next, dependencies.now, node, event, false);
      }

      return checkpointCourseGenerationState(next, dependencies);
    },
  });

  if (
    result.status === "failed" &&
    result.error instanceof CourseGenerationNodeError
  ) {
    const failedNode = nodes.find(
      ({ name }) => name === result.error.nodeName,
    );
    if (failedNode) {
      return {
        ...result,
        state: appendNodeEvents(
          result.state,
          dependencies.now,
          failedNode,
          result.error.events,
        ),
      };
    }
  }

  return result;
}

export function getCourseNodeRetryFeedback(
  state: CourseGenerationState,
  node: CourseGenerationNode,
  retryFailure?: WorkflowNodeError<CourseGenerationNodeName>,
): CourseGenerationNodeContext["retryFeedback"] {
  if (retryFailure) {
    return {
      nodeName: retryFailure.nodeName,
      code: retryFailure.code,
      message: retryFailure.message,
    };
  }

  const persistedError = node.pageId
    ? state.pages.find(({ pageId }) => pageId === node.pageId)?.error
    : undefined;
  return persistedError
    ? {
        nodeName: node.name,
        code: persistedError.code,
        message: persistedError.message,
      }
    : undefined;
}

export function failCourseGenerationNode(
  result: Extract<CourseNodeRunResult, { status: "failed" }>,
  nodes: CourseGenerationNode[],
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const node = nodes.find(({ name }) => name === result.error.nodeName);
  return failCourseGeneration(
    result.state,
    {
      stage: node?.stage ?? result.state.currentStage,
      pageId: node?.pageId,
      code: result.error.code,
      message: result.error.message,
    },
    context,
    dependencies,
    { agent: node?.agent ?? result.error.nodeName },
  );
}

export async function failCourseGeneration(
  state: CourseGenerationState,
  error: CourseGenerationError,
  context: AgentRuntimeContext,
  dependencies: CourseGenerationWorkflowDependencies,
  metadata: { agent?: string } = {},
) {
  const cancelled =
    context.abortSignal?.aborted ||
    error.code === "AGENT_ABORTED" ||
    error.code === "WORKFLOW_ABORTED";
  const completedAt = dependencies.now();
  let failed: CourseGenerationState = {
    ...state,
    status: cancelled ? ("cancelled" as const) : ("failed" as const),
    currentStage: error.stage,
    currentPageId: error.pageId,
    completedAt,
    durationMs: durationSince(state.startedAt, completedAt),
    errors: sameError(state.errors.at(-1), error)
      ? state.errors
      : [...state.errors, error],
  };

  if (error.pageId && isPageStage(error.stage)) {
    const pageStage = error.stage;
    failed = updatePage(failed, error.pageId, (page) => ({
      ...page,
      status: "failed",
      currentStage: pageStage,
      error: {
        code: error.code,
        causeCode: error.causeCode,
        message: error.message,
      },
    }));
  }

  failed = appendCourseGenerationEvent(failed, dependencies.now, {
    type: "error",
    stage: error.stage,
    pageId: error.pageId,
    agent: metadata.agent,
    summary: error.message,
  });
  return checkpointCourseGenerationState(failed, dependencies);
}

export function completeCourseGeneration(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const completedAt = dependencies.now();
  const completed = appendCourseGenerationEvent(
    {
      ...state,
      status: "completed",
      currentStage: "complete",
      currentPageId: undefined,
      completedAt,
      durationMs: durationSince(state.startedAt, completedAt),
    },
    dependencies.now,
    {
      type: "finish",
      stage: "complete",
      summary: `整课生成完成，共交付 ${state.pages.length} 个 HTML 页面。`,
    },
  );
  return checkpointCourseGenerationState(completed, dependencies);
}

export function appendCourseGenerationEvent(
  state: CourseGenerationState,
  now: () => string,
  event: Pick<
    CourseGenerationPublicEvent,
    "type" | "stage" | "summary"
  > &
    Partial<
      Pick<
        CourseGenerationPublicEvent,
        "pageId" | "agent" | "step" | "timestamp"
      >
    >,
): CourseGenerationState {
  const nextEvent: CourseGenerationPublicEvent = {
    id: crypto.randomUUID(),
    sequence: state.events.length + 1,
    traceId: state.traceId,
    timestamp: event.timestamp ?? now(),
    step: event.step ?? 0,
    type: event.type,
    stage: event.stage,
    pageId: event.pageId,
    agent: event.agent,
    summary: event.summary,
  };

  return { ...state, events: [...state.events, nextEvent] };
}

export async function checkpointCourseGenerationState(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
) {
  const parsed = CourseGenerationStateSchema.parse({
    ...state,
    updatedAt: dependencies.now(),
  });
  await dependencies.checkpoint(parsed);
  return parsed;
}

export function requireCourseGenerationValue<Value>(
  value: Value | undefined,
  name: string,
): Value {
  if (value === undefined) throw new Error(`课程工作流缺少 ${name}。`);
  return value;
}

type AgentBoundaryMetadata = {
  stage: CourseGenerationStage;
  agent: string;
  pageId?: string;
  summary: string;
};

function beginAgent(
  state: CourseGenerationState,
  dependencies: CourseGenerationWorkflowDependencies,
  metadata: AgentBoundaryMetadata,
) {
  return checkpointCourseGenerationState(
    appendCourseGenerationEvent(state, dependencies.now, {
      type: "agent_start",
      ...metadata,
    }),
    dependencies,
  );
}

function appendAgentDone(
  state: CourseGenerationState,
  now: () => string,
  metadata: AgentBoundaryMetadata,
) {
  return appendCourseGenerationEvent(state, now, {
    type: "agent_done",
    ...metadata,
  });
}

function appendNodeEvents(
  state: CourseGenerationState,
  now: () => string,
  node: CourseGenerationNode,
  events: readonly CourseGenerationNodeEvent[],
) {
  return events.reduce(
    (next, event) => appendNodeEvent(next, now, node, event),
    state,
  );
}

function appendNodeEvent(
  state: CourseGenerationState,
  now: () => string,
  node: CourseGenerationNode,
  event: CourseGenerationNodeEvent,
  inheritNodeAgent = true,
) {
  return appendCourseGenerationEvent(state, now, {
    type: event.type,
    stage: node.stage,
    pageId: node.pageId,
    agent: event.agent ?? (inheritNodeAgent ? node.agent : undefined),
    step: event.step,
    summary: event.summary,
    timestamp: event.timestamp,
  });
}

function updatePage(
  state: CourseGenerationState,
  pageId: string,
  updater: (page: PageGenerationState) => PageGenerationState,
): CourseGenerationState {
  return {
    ...state,
    pages: state.pages.map((page) =>
      page.pageId === pageId ? updater(page) : page,
    ),
  };
}

function isPageStage(
  stage: CourseGenerationStage,
): stage is "page_writer" | "assets" | "html" | "qa" {
  return (
    stage === "page_writer" ||
    stage === "assets" ||
    stage === "html" ||
    stage === "qa"
  );
}

function resolveWorkerConfig(
  input: CourseGenerationWorkflowInput,
  persisted?: CourseGenerationState["workerConfig"],
) {
  if (
    persisted &&
    ((input.executionMode && input.executionMode !== persisted.mode) ||
      (input.concurrency && input.concurrency !== persisted.concurrency))
  ) {
    throw new Error("恢复课程时不能更改已持久化的 Page Worker 配置。");
  }
  return PageWorkerConfigSchema.parse(
    persisted ?? {
      mode: input.executionMode ?? "parallel",
      concurrency: input.concurrency ?? 2,
    },
  );
}

function sameError(
  left: CourseGenerationError | undefined,
  right: CourseGenerationError,
) {
  return Boolean(
    left &&
      left.stage === right.stage &&
      left.pageId === right.pageId &&
      left.code === right.code &&
      left.message === right.message,
  );
}

function durationSince(startedAt: string, completedAt: string) {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}
