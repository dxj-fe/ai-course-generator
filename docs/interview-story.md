# 课芽项目讲解：当前 agent-v2 版本

本文用于练习项目讲解。所有表述以当前源码和验证结果为准，不把部署前 Gate 或历史 Demo 说成已上线能力。

## 3 分钟版本

课芽把一句自然语言需求和可选资料，生成一门由多份互动 HTML 组成的课程。难点不是“让模型多写一点”，而是先保证整课目标和页面职责一致，再让页面并行生产，同时处理 HTML 安全、互动、跨页连贯、失败恢复和前端长任务状态。

当前系统只保留四类真正的 Agent：

1. Curriculum Architect 先一次性产出整课事实底稿、统一规则和全部 `PageTask`。
2. Course Director 从目标和学习体验验收完整架构。
3. Director 接受后，系统在一个事务里创建恰好 N 张 Page WorkOrder；独立页并行，依赖页等待上游已验收 `PageSummary`。
4. Page Builder 在单页权限内自主调用 Writer、Image、HTML、QA、Repair 等 Model Step 和 Tool。
5. 所有页面通过代码 Gate 后，Course Reviewer 检查整课目标覆盖、重复、断层和一致性；Director 最后决定发布、局部返工或重规划。

每次 Agent 回合都有持久化 WorkOrder、Artifact 版本、工具白名单、预算和数据库 lease。进程中断后由显式 worker 重新领取，不依赖一次超长模型调用。

前端仍使用原来的 Task API 和 SSE，只展示公开 snapshot、事件和终态，不展示 Prompt、资料原文或模型私有推理。最终 HTML 经过结构、安全、互动和质量检查，在受限 iframe 中运行。

## 8 分钟版本

### 1. 产品入口

- `/chat` 把用户描述整理成结构化 `CourseCreationBrief`；
- `POST /api/courses/tasks` 创建 `source: "agent-v2"` 的异步任务；
- `/chat` 展示公开生成进度；
- `/course/[courseId]` 学习和导出完成课程。

任务创建后 `CourseGenerationTaskService` 驱动 `CourseRunEngine`。Next 的 `after()` 只是当前请求后的快速唤醒；持续恢复必须运行 `npm run worker:course`。

### 2. 为什么先规划整课

Architect 必须一次提交：

- `CoursePack`：事实、术语、例子和资料引用；
- `CourseBlueprint`：受众、目标、教学和视觉规则；
- `PageTask[]`：每页职责、互动、验收和真实 build 依赖。

Architecture Gate 先检查 ID、目标覆盖和无环依赖；Director 再做语义验收。只有完整架构被接受后，Repository 才原子派发全部页面工作单。这样不会出现一边改规划、一边用旧计划生成页面的混乱。

### 3. 页面如何协作

`order` 决定学习展示顺序，`buildDependsOnPageIds` 才决定生成顺序。Engine 每次找出依赖已满足的页面，按并发上限运行一个 wave。

Page Builder 读取一张封口的 WorkOrder，可以根据工具结果决定：

- 是否检索资料；
- 是否生成图片；
- 先改内容还是改 HTML；
- 质量问题应该定向修哪一层；
- 继续修订、提交或明确阻塞。

它不能改其他页、扩大预算或宣布自己验收通过。Page Gate 接受后，Repository 保存 `PageSummary` 并解锁后继页。

### 4. 为什么 Model Step 不叫 Agent

Page Writer、Image Prompt、HTML Engineer、Page QA、Repair、Pedagogy、Story 和 Visual 都是有价值的模型能力，但它们没有独立 WorkOrder、调度权和恢复边界，所以现在统一叫 Model Step。

Agent 是任务角色；Model Step 是 Agent 可以使用的一次专业生成；Tool 执行查询或副作用；Gate 用确定性代码做验收。这个命名让运行轨迹更真实，也减少“看起来很多角色、实际只是固定函数”的假 Agent。

### 5. 质量闭环

Page Gate 检查：

- DSL 是否完成本页目标和互动；
- 素材槽是否齐全；
- HTML 合同、安全和素材绑定；
- 完成条件和反馈；
- 质量与截图证据是否属于当前 Artifact 版本。

全部页面完成后，系统冻结 `CourseManifest`。Reviewer 读取所有当前页摘要和受控质量证据，检查整课目标、重复、断层、难度、术语和首尾一致性。Director 可以只返工点名页和真实依赖闭包，或在架构本身错误时重规划。

发布前 Final Gate 会从 current 指针重新构建 manifest；旧 Review 不能发布新页面。

### 6. 可靠性和状态

SQLite 中持久化：

- `CourseRun`：当前架构、页面、Review、阶段和整课 lease；
- `WorkOrder`：输入、权限、预算、状态和执行 lease；
- `Artifact`：不可变业务产物；
- `CourseRunEvent`：有序公开事件；
- `ToolOperation`：工具审计记录。

所有关键写入使用事务、版本围栏和 trace fencing。pause、resume、cancel 与执行进程通过 CAS 仲裁，旧 runner 不能覆盖新 trace 或终态。

需要如实说明：`ToolOperation` 不是外部 Provider 的通用 exactly-once 层；外部调用成功但结果尚未落库时，仍可能出现重复调用窗口。

### 7. 为什么移除 LangGraph

旧 LangGraph 没有承载原生 checkpoint 或子图能力，只是再次包裹项目已有的固定 Workflow。当前用 AI SDK `ToolLoopAgent` 处理单张 WorkOrder 内的自主工具循环，用 `CourseRunEngine` 处理跨 Agent 的耐久调度。两层各做一件事，不再叠第三套运行时。

### 8. 验证与当前边界

本地自动化覆盖 Schema、Repository、租约、Agent 工具权限、依赖 wave、质量 Gate、返工、Task/SSE 和 UI 投影。真实 Provider 多步工具 spike 已准备，但必须在有凭据的部署环境执行。

当前仍是本地 SQLite 架构，没有账号、租户权限、对象存储、分布式消息总线或生产 SLA。显式 worker 是部署必要条件。

## 高频追问

### 为什么不是所有步骤都交给 Agent？

模型负责开放的语义判断；依赖、权限、预算、并发、事务、安全和发布条件必须由代码决定。把机械动作也交给模型只会增加成本和随机性。

### 为什么不是一个 Director 同步调用所有子 Agent？

同步嵌套会把整个课程绑在一个进程和一次调用里。独立 WorkOrder 才能让页面并行、暂停、恢复、失败隔离和跨进程接管。

### 为什么 SSE，不用 WebSocket？

课程进度主要是服务端单向推送。SSE 自带 HTTP 兼容、事件 ID 和重连；暂停、恢复、取消继续使用普通 HTTP 控制接口。

### 最核心的技术贡献是什么？

把开放的模型能力放进一条可验证的课程生产线：先全局架构、再原子派工、页面按真实依赖并行、独立整课验收，并用 WorkOrder、Artifact、lease 和 Gate 保证过程可以恢复和排错。

## 证据入口

- [架构入口](architecture/README.md)
- [多 Agent 执行流程](architecture/multi-agent-flow.md)
- [从提示词到最终 HTML](architecture/prompt-to-html-current-flow.md)
- [为什么只保留四类 Agent](why-multi-agent.md)
- [Demo 验收方法](demo/prompts.md)
