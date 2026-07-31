# 多 Agent 设计

## 角色

| 角色 | 职责 | 可提交产物 |
| --- | --- | --- |
| Curriculum Architect | 事实、目标、课程规则和逐页任务 | CourseArchitecture |
| Course Director | 派发依赖波次、处理审查结论 | WorkOrder |
| Page Builder | 页面内容、素材、HTML、QA 与摘要 | 页面 Artifact |
| Course Reviewer | 目标覆盖和跨页一致性 | CourseReview |

## 为什么拆分

架构、页面实现和整课审查需要不同上下文。拆分后每个 Agent 只读取完成当前工作所需的证据，提交动作也能由独立 Gate 验证。Course Director 不代替专业 Agent 生成内容，只负责编排和收敛。

## 工作单合同

WorkOrder 明确：

- 任务与课程范围；
- 输入 Artifact 引用；
- 依赖工作单与页面依赖；
- 可用工具和预算；
- 租约、执行次数和修订轮次；
- 验收条件与最终 Submission。

工具调用通过 Repository 事务写入，不以模型回复文本作为完成依据。重复调用由幂等键和工具账本收敛。

## 证据与 Gate

页面 Gate 校验 DSL、HTML、安全、三视口截图和质量结论。整课 Gate 将 Review 绑定到当前 manifest，拒绝引用过期 Artifact。公开事件只记录步骤摘要、证据 ID 和安全错误码。

## 恢复

任务暂停、恢复和取消通过持久化状态与租约边界执行。进程重启后，运行器从当前 CourseRun、WorkOrder 和 Artifact 指针继续；不会读取另一套历史协议。
