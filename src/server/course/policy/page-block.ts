import {
  countPageBuilderRepairs,
  hasPageBuilderRepairDeclined,
  hasPageBuilderSubstantiveFix,
  loadPageBuilderWorkingSnapshot,
  type PageBuilderExecution,
} from "@/server/agent/plugins/contexts/course/page-builder";
import { planRepairRound } from "@/server/course/page/repair-plan";

/**
 * 首次呈现后只允许一次基于证据的定向修订。修订结果仍未通过时保留模型产物
 * 作为失败证据并阻塞 WorkOrder，不再进入下一轮修复或固定模板回退。
 */
export const MAX_PAGE_QUALITY_REVISIONS = 1;

export type PageBlockEligibility =
  | {
      ok: true;
      evidence: string[];
    }
  | {
      ok: false;
      message: string;
      feedback: string[];
    };

/**
 * block_page 是质量修订的故障出口，不是模型的自由选择。封口输入错误会在
 * Page Builder 创建前直接失败，不允许转成由模型决定的 blocked。
 */
export function evaluatePageBlockEligibility(
  execution: PageBuilderExecution,
): PageBlockEligibility {
  const snapshot = loadPageBuilderWorkingSnapshot(execution);
  if (!hasPageBuilderSubstantiveFix(execution)) {
    return {
      ok: false,
      message: "Fix WorkOrder 尚未产生获准的实质修订，不能阻塞页面。",
      feedback: ["先按 fixPlan 生成新的 PageContent 或 PageHTML。"],
    };
  }
  if (
    snapshot.quality?.decision === "pass" &&
    !snapshot.quality.shouldRepair
  ) {
    return {
      ok: false,
      message: "当前页面质量已经通过，不能用 block_page 代替提交。",
      feedback: ["调用 submit_page 完成确定性 Page Gate。"],
    };
  }

  if (!execution.progress.contextRead) {
    return {
      ok: false,
      message: "不能在未读取页面上下文时直接阻塞页面。",
      feedback: ["先调用 read_page_context，再处理当前缺少的产物。"],
    };
  }

  if (!snapshot.quality) {
    return {
      ok: false,
      message: "没有当前 PageQuality 时不能阻塞页面。",
      feedback: [
        "普通内容、素材、HTML 或 Provider 失败只能重试；先生成完整页面并执行 inspect_page。",
      ],
    };
  }

  if (hasPageBuilderRepairDeclined(execution)) {
    return {
      ok: true,
      evidence: [
        "当前 PageQuality 未通过，且定向 repair 已明确拒绝在授权范围内修改",
      ],
    };
  }

  const repairCount = countPageBuilderRepairs(execution);
  if (repairCount >= MAX_PAGE_QUALITY_REVISIONS) {
    return {
      ok: true,
      evidence: [
        `当前质量报告仍未通过，已完成 ${repairCount} 轮定向质量修订`,
      ],
    };
  }
  const repairPlan = planRepairRound({
    pageId: execution.pageId,
    content: snapshot.content!,
    html: snapshot.html!.html,
    visualBrief: execution.projection.briefs.visual,
    assets: snapshot.assets ?? [],
    report: snapshot.quality,
    attemptCount: repairCount,
  });
  if ("status" in repairPlan) {
    return {
      ok: true,
      evidence: [
        `当前质量问题无法在授权范围内定位修复：${repairPlan.message}`,
      ],
    };
  }

  return {
    ok: false,
    message: "当前问题仍有正常生成或定向修订路径，不能提前阻塞页面。",
    feedback: [
      `按确定性 repair 计划继续修订；只有 repair 明确 declined、计划无法授权修复，或用尽 ${MAX_PAGE_QUALITY_REVISIONS} 轮修订后才能阻塞。`,
    ],
  };
}
