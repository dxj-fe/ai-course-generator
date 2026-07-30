import type {
  PageContentDSL,
  QualityIssue,
  QualityScreenshotEvidence,
} from "@/shared/course-schema";

type ScreenshotCapture = NonNullable<
  QualityScreenshotEvidence["captures"]
>[number];

export function collectBrowserIssues(
  pageId: string,
  evidence: ScreenshotCapture,
  content?: PageContentDSL,
): QualityIssue[] {
  if (evidence.status !== "captured" || !evidence.metrics) return [];
  const location = {
    pageId,
    viewport: `${evidence.viewport.width}x${evidence.viewport.height}`,
    description: "Playwright 固定视口渲染结果",
  };
  const issues: QualityIssue[] = [];
  if (
    evidence.metrics.viewportFitScale !== undefined &&
    evidence.metrics.viewportFitScale < 0.9
  ) {
    issues.push({
      code: "BROWSER_VIEWPORT_SCALE_TOO_SMALL",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `页面为装入画布被整体缩放到约 ${Math.round(evidence.metrics.viewportFitScale * 100)}%，正文和控件会难以阅读。`,
      location: {
        ...location,
        selector: "main[data-page-id]",
        description: "被播放器整体缩小的课程主画布",
      },
      repairHint:
        "减少单页内容密度并重组为横向或紧凑网格；限制竖版素材高度，必要时重新生成或拆分页面。不要继续只增大控件 CSS，也不要裁切必要内容。",
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
        "移除超出视口的固定宽度，使用响应式宽度后重新截图验证。",
    });
  }
  const verticalOverflowPx =
    evidence.metrics.verticalOverflowPx ??
    Math.max(
      0,
      evidence.metrics.documentHeight - evidence.viewport.height,
    );
  if (verticalOverflowPx > 0) {
    issues.push({
      code: "BROWSER_VERTICAL_OVERFLOW",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `页面产生 ${verticalOverflowPx}px 纵向溢出。`,
      location,
      repairHint:
        "压缩单页内容或在规划阶段拆分页面，确保全部教学内容在固定播放器画布内完整可见。",
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
        "移除正文或互动容器的 overflow-y 滚动，将超出单页容量的内容拆到相邻页面。",
    });
  }
  if (evidence.metrics.clippedElementCount > 0) {
    issues.push({
      code: "BROWSER_CONTENT_CLIPPED",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.clippedElementCount} 个元素存在可测量的内容裁切。`,
      location,
      repairHint:
        "检查 overflow 与固定高度，确保正文和交互内容完整可见。",
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
      message: `${evidence.metrics.primaryActionBelowFoldCount} 个课程主操作未完整出现在播放器首屏内。`,
      location: {
        ...location,
        selector: '[data-interaction-type="navigate"]',
        description: "播放器首屏中的课程导航主操作",
      },
      repairHint:
        "压缩首屏装饰、标题或重复信息，让核心说明与主操作在当前播放器视口完整可见。",
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
  if ((evidence.metrics.touchTargetUnder24Count ?? 0) > 0) {
    issues.push({
      code: "BROWSER_TOUCH_TARGET_UNDER_24",
      dimension: "htmlRuntime",
      severity: "error",
      source: "browser",
      message: `${evidence.metrics.touchTargetUnder24Count} 个可见交互控件小于 24×24px。`,
      location,
      repairHint:
        "将可点击区域的宽高都扩大到至少 24px，并保留清晰的控件间距。",
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
      severity: "error",
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
        "缩小或裁切素材，把标题、核心解释和学习动作放回首屏主焦点。",
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
      severity: "error",
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
        "在不引起画布溢出的前提下扩大素材容器，使可见面积至少占视口 8%，建议达到 12%–30%；配合 object-fit 或 background-size 保持主体完整、清晰且不遮挡正文。",
    });
  }
  if (
    evidence.metrics.visibleContentAreaRatio !== undefined &&
    evidence.metrics.visibleContentAreaRatio < 0.12
  ) {
    issues.push({
      code: "BROWSER_FIRST_SCREEN_TOO_EMPTY",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `首屏可见教学内容面积不足 ${Math.round(evidence.metrics.visibleContentAreaRatio * 100)}%。`,
      location,
      repairHint:
        "移除无效留白或空素材，让核心说明与互动形成完整首屏任务。",
    });
  }
  if (
    evidence.metrics.mainViewportCoverageRatio !== undefined &&
    evidence.metrics.mainViewportCoverageRatio < 0.9
  ) {
    issues.push({
      code: "BROWSER_CANVAS_NOT_FILLED",
      dimension: "layoutQuality",
      severity: "error",
      source: "browser",
      message: `课程主画布只覆盖约 ${Math.round(evidence.metrics.mainViewportCoverageRatio * 100)}% 的播放器视口。`,
      location: {
        ...location,
        selector: "main[data-page-id]",
        description: "新生成页面的主画布视口覆盖率",
      },
      repairHint:
        "让 html、body、main 使用 100% 宽高和 border-box，并把页面安全留白放入 main 内边距。",
    });
  }
  return issues;
}
