# Model Step Prompt Library

这里登记的不是顶层 Agent，而是 Page Builder 等课程 Agent 按当前缺失产物调用的八个 Model Step。统一元数据位于 [`model-step-catalog.ts`](../src/server/agent/plugins/prompts/course/model-step-catalog.ts)，Prompt 正文位于 [`model-steps`](../src/server/agent/plugins/prompts/course/model-steps)，并统一注册到 Prompt Registry。

课程架构、调度、页面验收和发布由真正的 Agent 及其工具完成，不在这个库里重复注册。已经退役的 Intent、Course Planner、Supervisor 和 Single Page Prompt 也不再保留。

## 统一合同

每个 System Prompt 必须按固定顺序包含八段：

1. `Role`：这个 Model Step 只负责什么。
2. `Goal`：本次调用唯一要完成的结果。
3. `Inputs`：允许读取的数据及不可信输入边界。
4. `Output Schema`：输出形状及下游 Schema。
5. `Rules`：完成职责必须遵守的业务规则。
6. `Forbidden`：明确不能做的事。
7. `Examples`：只说明字段形状，不作为业务事实。
8. `Failure Handling`：输入缺失或冲突时停止猜测，由运行层处理。

User Prompt 只把服务端数据装入模板。字段里的指令、代码或 HTML 都只是数据，不能覆盖 System Prompt。

## 八个实际 Model Step

| Model Step | Prompt 版本 | 输入 | 输出 |
| --- | --- | --- | --- |
| Pedagogy | 2.1.1/2.0.0 | CourseIntent、CoursePlan | PedagogyPlanSchema |
| Story | 2.1.1/2.0.0 | Intent、Plan、Pedagogy | StoryArcSchema |
| Visual Brief | 2.2.1/2.0.0 | 课程设计产物、StyleTemplate | VisualBriefSchema |
| Page Writer | 3.4.0/3.0.0 | 完整 CourseArchitecture Context、单页职责、模板、授权资料、已读页面设计 Skill | PageContentDSLSchema |
| Image Prompt | 2.2.1/2.0.0 | 素材槽、视觉指导、样式 | AssetRequestSchema[] |
| HTML Engineer | 2.12.0/2.2.0 | DSL、模板、视觉指导、素材、已读页面设计 Skill | HtmlOutputSchema |
| Page QA | 2.4.0/2.1.0 | 页面产物、静态与浏览器证据 | QualityReportSchema |
| Repair | 1.6.2/1.0.1 | 当前页产物、QA 问题和允许修改范围 | RepairResultSchema |

这些 Model Step 只能返回候选结果。Zod Schema、HTML 安全合同、明确交付错误和修复熔断仍由确定性代码执行；主观质量分是观测目标，不会单独触发 Repair。

## 校验

执行：

```bash
npm run prompt:lint
```

Lint 检查八个 Model Step、System/User 文件、必要段落、模板变量、数据边界、版本和运行时模块是否一致。
