import type {
  PageContentDSL,
  QualityIssue,
  QualityScreenshotEvidence,
} from "@/shared/course-schema";

type ScreenshotCapture = NonNullable<
  QualityScreenshotEvidence["captures"]
>[number];

// Chromium 在短画布上会把多段 vmin、line-height 与边框分别取整；真实 Demo
// 可出现 8px 文档高度差，但内容可见率仍为 100%，且没有裁切、嵌套滚动或折叠
// 下操作。超过该范围仍按真实纵向溢出处理。
const MAX_LAYOUT_ROUNDING_OVERFLOW_PX = 8;
const SLIDE_DESIGN_WIDTH = 1920;
const SLIDE_DESIGN_HEIGHT = 1080;
// contain-fit 允许少量额外缩放吸收字体、边框和紧凑互动的高度差；超过 6%
// 才视为页面职责真实超载。5% 缩放仍保留正文可读性，且完整性另由裁切、
// 溢出、可见面积和交互可达性指标独立把关。
const MIN_EXPECTED_STAGE_SCALE_RATIO = 0.94;

export function collectBrowserIssues(
  pageId: string,
  evidence: ScreenshotCapture,
  content?: PageContentDSL,
  requirements: { requiresInteraction?: boolean } = {},
): QualityIssue[] {
  if (evidence.status !== "captured" || !evidence.metrics) return [];
  const location = {
    pageId,
    viewport: `${evidence.viewport.width}x${evidence.viewport.height}`,
    description: "Playwright 固定视口渲染结果",
  };
  const issues: QualityIssue[] = [];
  const pageError = evidence.diagnostics?.pageErrors[0];
  if (pageError) {
    issues.push({
      code: "BROWSER_PAGE_ERROR",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `页面运行时异常：${pageError}`,
      location,
      repairHint: "修复导致 pageerror 的页面结构或可信互动标记后重新渲染。",
    });
  }
  const consoleError = evidence.diagnostics?.console.find(
    ({ type }) => type === "error" || type === "assert",
  );
  if (consoleError) {
    issues.push({
      code: "BROWSER_CONSOLE_ERROR",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `控制台错误：${consoleError.text}`,
      location,
      repairHint: "根据控制台错误修正页面后重新渲染。",
    });
  }
  const requestFailure = evidence.diagnostics?.requestFailures[0];
  if (requestFailure) {
    issues.push({
      code: "BROWSER_REQUEST_FAILED",
      dimension: "assetUsability",
      severity: "error",
      source: "browser",
      message: `资源请求失败：${requestFailure.method} ${requestFailure.url}`,
      location,
      repairHint:
        "只使用 generate_page_image 返回的内部 URI，并确认素材仍可由 Browser Harness 读取。",
    });
  }
  const failedInteractionStep = evidence.diagnostics?.interaction.find(
    ({ status }) => status === "failed",
  );
  if (failedInteractionStep) {
    issues.push({
      code: "BROWSER_INTERACTION_STEP_FAILED",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `互动回放失败（${failedInteractionStep.action}）：${failedInteractionStep.detail}`,
      location,
      repairHint:
        "检查目标 selector、控件可见性和可信运行时标记，修正后重新执行互动回放。",
    });
  }
  if (
    requirements.requiresInteraction &&
    evidence.diagnostics?.dom.interactiveCount === 0
  ) {
    issues.push({
      code: "BROWSER_REQUIRED_INTERACTION_MISSING",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: "课程架构要求本页可操作，但真实 DOM 中没有可交互控件。",
      location: {
        ...location,
        selector: "main",
        description: "页面学习互动",
      },
      repairHint:
        "根据本页 learnerAction 自主设计一个真实可操作且有状态反馈的互动；保留自由 HTML 构图，不需要套用 DSL 插槽。",
    });
  }
  const rawMarkupSample = evidence.diagnostics?.dom.rawMarkupSamples?.[0];
  if (rawMarkupSample) {
    issues.push({
      code: "BROWSER_RAW_MARKUP_VISIBLE",
      dimension: "contentAccuracy",
      severity: "error",
      source: "browser",
      message: `页面把 HTML 标记当成正文展示：${rawMarkupSample}`,
      location: {
        ...location,
        selector: "main",
        description: "课程正文中的裸露 HTML 标记",
      },
      repairHint:
        "补齐或移除误写的 HTML 起始符号；如果课程确实讲解代码，请把示例放进 code/pre 元素。",
    });
  }
  if (evidence.metrics.horizontalOverflowPx > 0) {
    issues.push({
      code: "BROWSER_HORIZONTAL_OVERFLOW",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `页面产生 ${evidence.metrics.horizontalOverflowPx}px 横向溢出。`,
      location,
      repairHint:
        "把全部内容限制在 16:9 舞台内，使用相对尺寸或同比例构图后重新截图验证。",
    });
  }
  const expectedStageScale = Math.min(
    1,
    evidence.viewport.width / SLIDE_DESIGN_WIDTH,
    evidence.viewport.height / SLIDE_DESIGN_HEIGHT,
  );
  const exceedsAuthoredStage =
    evidence.metrics.documentWidth >
      SLIDE_DESIGN_WIDTH + MAX_LAYOUT_ROUNDING_OVERFLOW_PX ||
    evidence.metrics.documentHeight >
      SLIDE_DESIGN_HEIGHT + MAX_LAYOUT_ROUNDING_OVERFLOW_PX;
  const actualStageScale =
    evidence.metrics.requiredViewportScale ??
    Math.min(
      1,
      evidence.viewport.width / Math.max(1, evidence.metrics.documentWidth),
      evidence.viewport.height / Math.max(1, evidence.metrics.documentHeight),
    );
  if (
    exceedsAuthoredStage ||
    (evidence.metrics.requiredViewportScale !== undefined &&
      evidence.metrics.requiredViewportScale <
        expectedStageScale * MIN_EXPECTED_STAGE_SCALE_RATIO)
  ) {
    issues.push({
      code: "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `页面内容超过 1920×1080 舞台，被额外缩放到预期比例的 ${Math.round((actualStageScale / Math.max(expectedStageScale, 0.001)) * 100)}%。`,
      location,
      repairHint:
        "减少重复信息并重组二维构图；必要内容仍超载时要求 Course Lead 拆页，禁止继续缩字或依赖整体缩放。",
    });
  }
  const verticalOverflowPx =
    evidence.metrics.verticalOverflowPx ??
    Math.max(
      0,
      evidence.metrics.documentHeight - evidence.viewport.height,
    );
  if (verticalOverflowPx > MAX_LAYOUT_ROUNDING_OVERFLOW_PX) {
    issues.push({
      code: "BROWSER_VERTICAL_OVERFLOW",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `页面内容超出 16:9 舞台 ${verticalOverflowPx}px，学习器不会提供纵向滚动。`,
      location: {
        ...location,
        ...(evidence.metrics.largestVisualSelector
          ? { selector: evidence.metrics.largestVisualSelector }
          : {}),
      },
      repairHint:
        "重新组织为画布级网格、对照、叠层或渐进互动；仍超载时要求 Course Lead 拆页，禁止缩小正文、裁切或增加滚动条。",
    });
  }
  if ((evidence.metrics.nestedVerticalOverflowCount ?? 0) > 0) {
    issues.push({
      code: "BROWSER_NESTED_VERTICAL_OVERFLOW",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.nestedVerticalOverflowCount} 个嵌套区域产生纵向滚动。`,
      location: {
        ...location,
        description: "播放器画布中的嵌套滚动区域",
      },
      repairHint:
        "取消嵌套滚动并重新分配画布空间；若必要内容无法完整展示，拆分为更多页面。",
    });
  }
  if (evidence.metrics.clippedElementCount > 0) {
    const clippedSelectors =
      evidence.metrics.clippedElementSelectors ?? [];
    issues.push({
      code: "BROWSER_CONTENT_CLIPPED",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.clippedElementCount} 个元素存在可测量的内容裁切${clippedSelectors.length > 0 ? `：${clippedSelectors.slice(0, 3).join("、")}` : ""}。`,
      location: {
        ...location,
        ...(clippedSelectors[0]
          ? { selector: clippedSelectors[0] }
          : {}),
      },
      repairHint:
        clippedSelectors[0]
          ? `优先检查 ${clippedSelectors[0]} 的 overflow、固定高度和内部正文；修复后重新渲染，不要盲目改动无关区域。`
          : "检查 overflow 与固定高度，确保正文和交互内容完整可见。",
    });
  }
  if (
    (evidence.metrics.primaryActionBelowFoldCount ?? 0) > 0
  ) {
    issues.push({
      code: "BROWSER_PRIMARY_ACTION_BELOW_FOLD",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.primaryActionBelowFoldCount} 个课程主操作超出 16:9 舞台，学习器中不可达。`,
      location: {
        ...location,
        selector: '[data-interaction-type="navigate"]',
        description: "播放器首屏中的课程导航主操作",
      },
      repairHint:
        "把主要操作重新编排到舞台内；若页面职责过载则要求 Course Lead 拆页。",
    });
  }
  if (evidence.metrics.zeroSizeInteractiveCount > 0) {
    issues.push({
      code: "BROWSER_ZERO_SIZE_INTERACTIVE",
      dimension: "htmlRuntime",
      severity: "warning",
      source: "browser",
      message: `${evidence.metrics.zeroSizeInteractiveCount} 个交互元素没有可见尺寸。`,
      location,
      repairHint:
        "为交互控件提供可见尺寸和明确标签，或移除不可操作的隐藏控件。",
    });
  }
  if ((evidence.metrics.inertButtonCount ?? 0) > 0) {
    issues.push({
      code: "BROWSER_INERT_BUTTON",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.inertButtonCount} 个按钮没有可信运行时或原生表单行为。`,
      location: {
        ...location,
        selector: "button",
        description: "无法完成任何动作的按钮",
      },
      repairHint:
        "移除伪交互，改用可原生工作的 details/form，或接入可信互动运行时并通过 interactionSteps 回放验证。",
    });
  }
  if ((evidence.metrics.touchTargetUnder24Count ?? 0) > 0) {
    const targetDetails =
      evidence.metrics.touchTargetUnder24Selectors?.join("；");
    issues.push({
      code: "BROWSER_TOUCH_TARGET_UNDER_24",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.touchTargetUnder24Count} 个可见交互控件小于 24×24px。${targetDetails ? `具体目标：${targetDetails}。` : ""}`,
      location,
      repairHint: targetDetails
        ? `直接修复这些命中区域：${targetDetails}。对于 radio/checkbox，应扩大关联 label 的 min-height 或 padding，不能只修改内部图标。`
        : "将可点击区域的宽高都扩大到至少 24px，并保留清晰的控件间距。",
    });
  }
  if ((evidence.metrics.touchTargetUnder44Count ?? 0) > 0) {
    issues.push({
      code: "BROWSER_TOUCH_TARGET_UNDER_44",
      dimension: "htmlRuntime",
      severity: "info",
      source: "browser",
      message: `${evidence.metrics.touchTargetUnder44Count} 个可见交互控件小于建议的 44×44px。`,
      location,
      repairHint:
        "优先将触控目标扩大到 44×44px，尤其是移动端的主要操作。",
    });
  }
  if (
    (evidence.metrics.feedbackVisibleByDefaultCount ?? 0) > 0
  ) {
    issues.push({
      code: "BROWSER_FEEDBACK_VISIBLE_BY_DEFAULT",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.feedbackVisibleByDefaultCount} 个答题反馈在提交前已经可见。`,
      location: {
        ...location,
        selector: "[data-feedback-kind]",
        description: "测验的初始反馈状态",
      },
      repairHint:
        "为成功与重试反馈添加 hidden，并只由可信运行时在提交后显示。",
    });
  }
  if (evidence.metrics.interactionSubmitTested === false) {
    issues.push({
      code: "BROWSER_INTERACTION_SUBMIT_UNTESTED",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: "浏览器无法完成选择题提交动作。",
      location: {
        ...location,
        selector: '[data-runtime-submit="true"]',
        description: "选择题提交控件",
      },
      repairHint:
        "提供可点击的提交按钮和可选择的原生控件，并重新执行浏览器测试。",
    });
  }
  if (
    evidence.metrics.interactionSubmitTested === true &&
    evidence.metrics.interactionFeedbackVisible === false
  ) {
    issues.push({
      code: "BROWSER_INTERACTION_FEEDBACK_MISSING",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: "选择题提交后没有出现文字反馈。",
      location: {
        ...location,
        selector: "[data-keya-runtime-feedback]",
        description: "可信运行时答题反馈区域",
      },
      repairHint:
        "检查 option ID、提交标记与运行时配置，确保提交后显示解释性文字反馈。",
    });
  }
  if ((evidence.metrics.largestVisualAreaRatio ?? 0) > 0.7) {
    issues.push({
      code: "BROWSER_VISUAL_DOMINATES_VIEWPORT",
      dimension: "assetUsability",
      severity: "info",
      source: "browser",
      message: `单个视觉素材占据约 ${Math.round((evidence.metrics.largestVisualAreaRatio ?? 0) * 100)}% 的首屏面积。`,
      location: {
        ...location,
        ...(evidence.metrics.largestVisualSelector
          ? { selector: evidence.metrics.largestVisualSelector }
          : {}),
        description: "播放器首屏中占比最大的可见视觉素材",
      },
      repairHint:
        "仅作为构图观察：沉浸式或海报页可以合理使用大面积主视觉。",
    });
  }
  if (
    content?.assetSlots.some(
      (slot) =>
        slot.required &&
        slot.role !== "decorative" &&
        slot.type !== "icon",
    ) &&
    evidence.metrics.largestVisualAreaRatio !== undefined &&
    evidence.metrics.largestVisualAreaRatio < 0.08
  ) {
    const requiredSlot = content.assetSlots.find(
      (slot) =>
        slot.required &&
        slot.role !== "decorative" &&
        slot.type !== "icon",
    );
    issues.push({
      code: "BROWSER_VISUAL_TOO_SMALL",
      dimension: "assetUsability",
      severity: "info",
      source: "browser",
      message: `页面要求展示的主插图仅占首屏约 ${Math.round(evidence.metrics.largestVisualAreaRatio * 100)}%，无法形成清晰的视觉焦点。`,
      location: {
        ...location,
        selector:
          evidence.metrics.largestVisualSelector ??
          `[data-asset-slot-id="${requiredSlot?.id ?? "asset-slot-01"}"]`,
        description: "播放器首屏中面积过小的必需视觉素材",
      },
      repairHint:
        "仅作为构图观察：由页面视觉命题判断素材是否需要更大，不以固定面积阈值返工。",
    });
  }
  if (
    content?.functionalTemplateId !== "course-cover" &&
    evidence.metrics.visibleContentAreaRatio !== undefined &&
    evidence.metrics.visibleContentAreaRatio < 0.12
  ) {
    issues.push({
      code: "BROWSER_FIRST_SCREEN_TOO_EMPTY",
      dimension: "layoutQuality",
      severity: "info",
      source: "browser",
      message: `首屏可见教学内容面积不足 ${Math.round(evidence.metrics.visibleContentAreaRatio * 100)}%。`,
      location,
      repairHint:
        "仅作为构图观察：有意图的留白与陈述页不以面积阈值返工。",
    });
  }
  if (
    evidence.metrics.mainViewportCoverageRatio !== undefined &&
    evidence.metrics.mainViewportCoverageRatio < 0.9
  ) {
    issues.push({
      code: "BROWSER_CANVAS_NOT_FILLED",
      dimension: "layoutQuality",
      severity: "warning",
      source: "browser",
      message: `课程主画布只覆盖约 ${Math.round(evidence.metrics.mainViewportCoverageRatio * 100)}% 的播放器视口。`,
      location: {
        ...location,
        selector: "main[data-page-id]",
        description: "新生成页面的主画布视口覆盖率",
      },
      repairHint:
        "检查主画布是否有意覆盖视口；只有真实裁切或不可达时才阻断交付。",
    });
  }
  return issues;
}
