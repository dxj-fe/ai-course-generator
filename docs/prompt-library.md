# Specialist Prompt Library

Day 24 将课程生产中的九名 Specialist 组织成同一套版本化 Prompt Library。运行时唯一注册表是 [`src/server/prompts/specialist-library.ts`](../src/server/prompts/specialist-library.ts)，Prompt 正文保留在 [`src/server/prompts/templates`](../src/server/prompts/templates)，由现有 `prompt-loader` 加载和渲染。

Intent、Supervisor 和历史 SinglePage Agent 不属于这九名 Specialist。GenerateImage 是确定性 Skill，也不属于 Prompt Library。

## 统一合同

每个 System Prompt 必须按固定顺序包含八段：

1. `Role`：唯一角色身份。
2. `Goal`：本节点的单一成功目标。
3. `Inputs`：允许读取的最小类型化上下文，以及不可信内容的数据边界。
4. `Output Schema`：输出形状及下游真实 Schema。
5. `Rules`：完成当前职责所需的业务约束。
6. `Forbidden`：不能生成、修改、调用或决定的内容。
7. `Examples`：只演示字段形状，不成为业务事实。
8. `Failure Handling`：输入缺失或冲突时拒绝猜测，由运行层处理失败。

User Prompt 只负责把服务端数据装入模板。即使某个字段包含“忽略前文”、代码、HTML 或另一段 Prompt，它仍然只是数据，不能提升为系统指令。

## 九名 Specialist

| Specialist | 状态 | Prompt 版本 | 最小输入 | 输出合同 | 关键禁止项 |
| --- | --- | --- | --- | --- | --- |
| Planner | active | 2.0.1/2.0.0 | CourseIntent、模板清单 | CoursePlanSchema | 不写正文、HTML、素材 URI 或运行状态 |
| Pedagogy | active | 2.0.0/2.0.0 | CourseIntent、CoursePlan | PedagogyPlanSchema | 不决定故事、视觉或 HTML |
| Story | active | 2.0.0/2.0.0 | Intent、Plan、Pedagogy | StoryArcSchema | 不覆盖教学目标或虚构冲突事实 |
| Visual | active | 2.0.0/2.0.0 | 课程 briefs、StyleTemplate | VisualBriefSchema | 不生成图片、DSL、HTML 或新 Token |
| Page Writer | active | 2.0.0/2.0.0 | 单页 Plan、brief、模板 | PageContentDSLSchema | 不读取整课私有状态或输出 HTML |
| Image Prompt | active | 2.0.0/2.0.0 | 素材槽、视觉指导、样式 | AssetRequestSchema[] | 不调用 Provider，不发明槽位 |
| HTML Engineer | active | 2.1.0/2.1.0 | DSL、模板、brief、批准素材、同页校验反馈 | HtmlOutputSchema | 不改 DSL，不读取原始用户 Prompt |
| QA | active | 2.1.2/2.1.0 | 页面产物、课程上下文、静态与浏览器证据 | QualityReportSchema | 内容错误优先；report-only，不修改页面或宣布通过 |
| Repair | active | 1.0.1/1.0.0 | 当前页产物、来源 QA、授权 scope、两轮预算 | RepairResultSchema | 只返回 DSL block 候选、HTML patches 或拒绝；不自判通过 |

Day 27 已激活 Repair，并由 Page Worker 的确定性 `qa-repair-loop` 约束范围、预算、候选应用和 re-QA。Prompt 不能选择其他页面、修改预算或决定最终质量状态。

## 版本规则

- System 和 User Prompt 分别版本化，模型请求记录组合版本 `system/user`；active 模板文件的 `.vN.md` 必须与 SemVer 主版本一致。
- 改变职责、输入、输出或禁止项属于合同变化，应提升主版本。
- 仅澄清文案且不改变行为可提升补丁版本。
- Image Prompt 版本参与素材请求集缓存；版本提升会自然使旧 Prompt 编译缓存失效。
- 每次变更记录原因、影响和回滚边界，详见 [`prompt-changelog.md`](./prompt-changelog.md)。

## Lint 与运行时校验

执行：

```bash
npm run prompt:lint
```

Lint 检查九名 Specialist、独立 System/User 文件、八个必要段落、段落顺序、重复文件、模板变量、数据边界和 active 模块存在性。它只报告问题，不自动修改 Prompt。

Prompt Lint 不能替代运行时约束。模型输出仍必须经过 Zod Schema、业务一致性校验、Workflow `produces` 白名单、HTML 安全合同和有限 Supervisor 预算。
