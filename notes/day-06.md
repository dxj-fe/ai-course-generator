# Day 06 复盘：最小 Agent Loop

## 1. 今天完成的代码

- 定义 `Agent<State>`、AgentState、AgentEvent 和 AgentRuntimeContext。
- 手写包含状态、步骤预算、事件收集、终止判断和错误转换的最小 Agent Loop。
- 实现 SinglePageAgent：选择模板工具后生成结构化 PagePlan 草稿。
- 新增单页 Agent API、版本化 Prompt 和单元测试。
- AgentState 和 AgentEvent 均可序列化，不包含模型实例、函数、AbortSignal 或原始 Error。

## 2. 面试题与详细答案

### Q1：你如何定义 Agent？它和 Workflow、Tool Calling 是什么关系？

Agent 是一个围绕目标持续运行的执行系统，至少包含状态、下一步决策、模型或工具执行、结果回写和终止判断。Tool Calling 只是 Agent 可以使用的一种动作协议：模型提出工具调用，应用校验并执行。Workflow 则通常由代码预先规定步骤和分支，执行路径更确定。

三者不是互斥关系。Agent 可以运行在 Workflow 中，也可以用 Tool Calling 完成某一步。当前 SinglePageAgent 的主循环和完成条件由代码控制，模板选择由模型与 Tool Calling 完成，因此属于受控 Agent，而不是完全开放的自主系统。

### Q2：Agent 与一次 `generateText` 调用的本质区别是什么？

一次 `generateText` 是单次模型计算：输入 Prompt，得到文本或 Tool Call 后结束。Agent 会在多次模型和工具调用之间保存状态，根据中间结果决定下一步，并持续运行到完成、失败、取消或预算耗尽。

因此区别不在 Prompt 长度，而在运行时结构。SinglePageAgent 第一步选择模板，第二步根据模板生成 PagePlan；这两个动作通过 AgentState 连接，并由显式完成条件和步骤预算控制。

### Q3：为什么 Agent 系统必须显式保存 State？

多步骤任务不能依赖模型“自行记住”执行进度。显式 State 记录原始任务、中间产物、已调用工具、当前步骤、预算、最终结果和失败信息，使下一步决策有确定的数据来源。

State 还支持恢复、重试、调试和测试。没有显式 State，系统无法可靠判断某个工具是否已经调用，也很难避免重复执行和定位失败发生在哪一步。

### Q4：为什么 AgentEvent 应该是后端协议，而不是前端临时文案？

事件产生于真实执行过程，只有后端知道模型调用、工具调用、耗时和错误发生的准确时机。如果前端根据最终结果猜测 Timeline，不仅顺序可能错误，也无法表达正在运行、重试和失败等中间状态。

把 AgentEvent 定义成带类型、顺序号、traceId、时间和公开数据的协议后，前端只负责渲染。未来切换为 SSE 时仍然可以复用同一事件结构，而不需要重新解释日志文本。

### Q5：如何保证 Agent Loop 一定能够终止？

Agent 必须同时具备业务完成条件和系统保护条件。业务条件判断目标是否已经达成，例如 PagePlan 是否存在；系统条件包括最大步骤数、超时、AbortSignal、Token 或成本预算。任何一个保护条件触发都要进入明确的失败或取消状态。

还应限制相同工具的重复调用，确保工具结果能够改变 State，并对具有副作用的动作使用幂等键或人工审批。不能依赖模型主动说“我完成了”作为唯一终止条件。

### Q6：为什么 AgentState 必须可序列化？

可序列化 State 才能通过 API、SSE、数据库或任务队列传输和保存，也能在进程重启后恢复。模型实例、函数、AbortSignal 和 Error 对象都包含运行时引用或不可枚举信息，放入 State 会造成丢失、泄漏或恢复失败。

因此这些对象应放在 AgentRuntimeContext，State 只保存 JSON 数据。错误也应转换成稳定的 `code` 和 `message`，而不是直接保存 Error 实例和堆栈。

### Q7：模型调用成功但工具执行失败时，State 应该如何变化？

Tool Call 本身只能说明模型做出了调用决策，不能代表任务成功。工具失败后应写入失败的 tool event，保存工具名称和安全错误摘要，并根据错误类别决定重试、换工具或终止。

如果错误不可重试，AgentState 应进入 `failed`，保留之前已经完成的事件和中间产物。不能因为模型调用成功就写入 `finish`，也不能丢弃 traceId 和失败步骤。

### Q8：手写 Agent Loop 与 AI SDK `ToolLoopAgent` 应该如何选择？

当流程很小、目标是理解状态变化或需要精确控制事件协议时，手写循环更透明，调试成本也更低。它能清楚展示每次状态更新、预算检查和错误转换发生在哪里。

当多个 Agent 都重复相同的工具循环、停止条件、消息管理和流式处理后，可以迁移到 `ToolLoopAgent` 减少样板代码。迁移前应先明确自己的 State 和 Event 契约，避免为了使用框架而让业务状态依赖框架内部对象。

### Q9：为什么现在不应该直接引入 LangGraph？

当前流程只有模板选择和 PagePlan 生成两个步骤，手写循环已经足够。此时引入图运行时会增加 Node、Edge、Reducer 和状态适配成本，却没有复杂分支、并行节点或持久化恢复等需求来证明这些成本合理。

先手写可以暴露真实问题：哪些状态需要合并、事件在哪里产生、终止条件是什么。等流程出现多 Agent、条件边、重试和恢复需求后，再迁移 LangGraph，才能明确框架具体解决了什么问题。

## 3. 今日验证清单

- [x] `pnpm test`：5 个测试文件、16 个测试全部通过。
- [x] `pnpm lint`：通过。
- [x] `pnpm build`：通过，并生成 `/api/agents/single-page` 动态路由。
- [x] 真实模型为“8 岁儿童太阳系互动问答页面”选择 `interactive-quiz`。
- [x] SinglePageAgent 在两个步骤内返回通过 Zod 校验的 PagePlan。
- [x] 事件顺序为 `start → model_call → tool_call → model_call → finish`。
- [x] 最终 State 已通过 API JSON 序列化返回。
- [x] 单元测试确认达到步骤上限时状态变为 `failed`。
