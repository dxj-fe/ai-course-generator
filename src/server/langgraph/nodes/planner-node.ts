import { CourseWorkflowDemoStateSchema } from "../course-workflow-demo-state";

/** Day 28 的独立 Planner Node：只返回 State 更新，不调用真实模型。 */
export const plannerNode: typeof CourseWorkflowDemoStateSchema.Node = (
  state,
) => ({
  plan: [
    `明确学习目标：${state.prompt}`,
    "按引入、讲解、练习、总结组织课程页面",
    "为每页保留可验证的学习结果",
  ],
  events: [
    {
      node: "planner",
      summary: "Planner 已生成确定性的课程结构。",
    },
  ],
});
