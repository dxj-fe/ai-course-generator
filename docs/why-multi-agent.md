# 为什么课芽只保留四类 Agent

课芽要交付的不是一段文章，而是一门由多份可学习、可互动、可恢复的 HTML 页面组成的课程。这里确实需要多个模型角色，但不需要把每一次模型调用都包装成 Agent。

## 1. 判断一个角色是不是 Agent

当前项目只把满足以下条件的角色叫 Agent：

- 接收一张独立、可持久化的 `WorkOrder`；
- 输入绑定到明确的 Artifact 版本；
- 可以在工具白名单内根据结果选择下一步；
- 有自己的步骤、工具、时间和成本预算；
- 最后必须提交可验证产物，或者明确阻塞；
- 进程中断后可以由其他 worker 重新领取。

只完成一次结构化生成、没有独立工作单和调度权的能力叫 Model Step。资料检索、生图和浏览器检查叫 Tool。Schema、安全和质量硬条件叫 Gate。

## 2. 当前四类 Agent

| Agent | 负责 | 不负责 |
| --- | --- | --- |
| Curriculum Architect | 一次设计完整 CoursePack、CourseBlueprint 和全部 PageTask | 写单页 HTML、派工、发布 |
| Course Director | 验收整课架构；根据整课 Review 决定发布、修页或重规划 | 每步调度、直接改页面、绕过 Gate |
| Page Builder × N | 在单页边界内自主生成内容、素材、HTML、质量证据和定向修订 | 改架构、改别页、自评通过 |
| Course Reviewer | 读取冻结 manifest，检查目标覆盖、重复、断层、难度和跨页一致性 | 修改页面、创建任意任务、发布 |

原来的 Planner、Pedagogy、Story、Visual、Writer、Image Prompt、HTML Engineer、Page QA 和 Repair 不再分别宣称 Agent。它们有价值的能力仍保留在 `src/server/agent/plugins/model-steps/course/`、Tool 和 Gate 中。

## 3. 为什么不能只用一个超级 Agent

| 问题 | 一个长 Agent 的表现 | 当前处理 |
| --- | --- | --- |
| 全局和单页冲突 | 一边改目标，一边写页面，后页不知道该信哪一版 | Architect 先提交完整架构，Director 接受后才派工 |
| 上下文膨胀 | 全部 HTML、素材和历史一起进入模型 | Artifact 只传引用和受控摘要 |
| 页面互相断裂 | 所有页同时生成，却看不到上游真实结果 | 真实依赖页等待上游 accepted PageSummary |
| 自我验收 | 生成者说“完成”就发布 | Page Gate、Reviewer 和 Final Gate 独立验收 |
| 失败重跑 | 一页失败导致整课从头开始 | 每页独立 WorkOrder、Artifact 和 lease |
| 进程中断 | 一次长 ToolLoopAgent 调用无法续跑 | SQLite CourseRun/WorkOrder + 显式恢复 worker |

## 4. 为什么页面按 wave 并行

课程展示顺序不等于生成依赖。只有后页必须使用前页实际产物时，才声明 `buildDependsOnPageIds`。

```text
page-1：无依赖
page-2：无依赖
page-3：依赖 page-1
page-4：依赖 page-1

wave 1：page-1 + page-2
wave 2：page-3 + page-4
```

这样既保留速度，也保证依赖页读取的是已经验收的事实、术语和学习结果，而不是未完成草稿。

## 5. 为什么仍然需要确定性代码

Agent 负责开放的语义判断，TypeScript 负责不能靠猜的事情：

- WorkOrder claim、lease、CAS 和超时；
- 原子接受架构并创建恰好 N 张页面工作单；
- 依赖 DAG、wave 和并发上限；
- Artifact 版本、hash、current 指针和 stale 传播；
- Schema、HTML 安全、互动协议和质量证据；
- pause、resume、cancel、恢复和 SSE 投影；
- 发布前重建 manifest，拒绝旧 Review 发布新页面。

这不是“Agent 不够自主”，而是把自主权放在真正需要模型判断的边界内。

## 6. 为什么不再使用 LangGraph

旧 LangGraph 只是包裹固定节点，没有使用它的原生 checkpointer、subgraph 或 durable execution；真正的状态、页面并发、恢复和 SSE 都在项目自己的代码里。

当前方案是：

```text
AI SDK ToolLoopAgent：单张 WorkOrder 内的模型—工具循环
CourseRunEngine：跨 Agent 的耐久调度、并发和恢复
```

这两层职责清楚，不需要再叠一套 Graph runtime。只有未来确实需要从图中任意内部步骤精确恢复、time travel 或动态子图时，才重新评估 LangGraph。

## 7. 当前边界

- `ToolOperation` 是审计台账，不保证所有外部副作用 exactly-once；
- Next 启动扫描只运行一次，持续恢复必须部署 `npm run worker:course`；
- Reviewer 使用页面摘要和受控质量证据，不替代人工事实与审美验收；
- 真实 Provider 的多步工具兼容性仍需在部署环境运行 spike。

继续阅读：

- [架构入口](architecture/README.md)
- [多 Agent 执行流程](architecture/multi-agent-flow.md)
- [从一句话到 HTML](architecture/prompt-to-html-current-flow.md)
- [完整技术设计](multi-agent-design.md)
