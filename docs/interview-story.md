# 课芽项目讲解：3 / 8 / 15 分钟

本文用于练习面试表达。讲解必须以当前源码和验证证据为准，不把计划、设计稿或失败的 Demo 记录描述为已通过能力。

## 讲解原则

1. 先讲用户问题，再讲技术方案。
2. Agent 名称不等于架构价值；要解释职责、合同和失败边界。
3. 每个亮点都按“问题 → 方案 → 项目落点 → 取舍”展开。
4. 主动说明当前边界：单进程任务执行、本地 SQLite、无 OCR/向量库/账号权限。
5. 不声称仓库中的 2026-07-23 Demo 已通过；现有两次记录均为失败证据。

## 3 分钟版本

### 0:00–0:35 · 项目是什么

我做的是一个叫课芽的 AI 个性化课程生成器。用户输入一句自然语言需求，或者上传几份 txt、Markdown、PDF 资料，系统会先确认课程主题、受众和学习目标，再生成一门有教学顺序、统一视觉和互动练习的多章节 HTML 课程。生成完成后可以在安全的课程播放器里学习，也可以从历史记录恢复和导出。

### 0:35–1:20 · 为什么难

难点不只是调用模型，而是同时保证课程结构、内容正确性、跨页风格、HTML 可运行、互动可用和失败恢复。如果让一个超级 Prompt 同时规划整课、写所有页面、做视觉和评价自己，输出很容易截断，问题也无法定位。任意一页失败，还可能重跑整门课。

### 1:20–2:15 · 核心方案

所以我把系统拆成受约束的多 Agent。Intent 和 Planner 负责全局课程；Pedagogy、Story、Visual 负责教学、叙事和视觉；每个页面进入隔离 Page Worker，依次生成 PageContentDSL、图片素材和 HTML。HTML 先经过确定性合同和安全检查，再由 Page QA 结合启发式、三个 Playwright 视口和模型评价出六维报告。需要修复时，Repair 只能修改服务器指定的 DSL block 或 HTML 位置，然后重新 QA。

新课程由 LangGraph 的规则型 Supervisor 调度，但业务规则仍在 Route Handler、Agent 和 Worker 中。Supervisor 不能自由编造节点或扩大预算。

### 2:15–3:00 · 前端与工程价值

前端使用严格 SSE，只接收已校验 snapshot、公开事件和终态；Prompt、资料原文和 chain-of-thought 不会进入浏览器。任务、课程和会话保存到 SQLite，支持暂停、恢复、取消和断点续跑。生成 HTML 运行在 sandbox iframe 中，不会进入主应用 DOM。

这个项目主要展示的是 AI 应用工程和重前端能力：我不仅做了 Agent 编排，也处理了长任务状态、复杂学习界面、生成 HTML 安全、质量闭环、可靠性和可测试性。

## 8 分钟版本

### 0:00–1:00 · 场景与产品流程

- 用户在 `/chat` 输入需求或上传资料。
- 前端先建立课程简报，只在缺少学习目标时追问。
- 确认后创建后台任务，生成过程可以暂停、恢复和取消。
- 已完成页面可以提前预览，完整课程进入 `/course/[courseId]` 学习和导出。

重点：它不是聊天机器人，而是把自然语言编译成持久课程产物。

### 1:00–2:00 · 领域合同

模型输出不是直接交给 UI。项目用 Zod 定义 CourseIntent、CoursePlan、PageContentDSL、QualityReport、RepairResult 和 CourseGenerationState。

每个 Agent 只返回一种结构化产物；合并前后都重新校验。这样能把“模型偶尔少字段”从前端运行时错误，提前变成可定位的阶段错误。

### 2:00–3:30 · 多 Agent 与 LangGraph

全局层包括 Intent、Planner、Pedagogy、Story、Visual。页面层由 Page Worker 隔离 Writer、Assets、HTML、QA 和 Repair。

LangGraph 从规则型 Supervisor 开始，条件边只读取已校验的决策。多数时候合法动作唯一，所以规则优先，不额外调用模型做显而易见的路由。手写 Workflow 保留为兼容入口，两种运行时复用同一套 Agent、Worker 和领域状态。

取舍：调用和状态更多，但错误归因、恢复粒度和测试边界明显更好。

### 3:30–4:45 · 模板、DSL 与素材

功能模板解决教学结构，例如知识卡、对比、时间线和选择题；样式模板解决颜色、字体、间距和素材指导。二者分开后，同一教学模板可以组合不同视觉风格。

Page Writer 生成混合 DSL，而不是自由 HTML。图片只作为背景、角色、图标和纹理；文字与互动仍是 HTML。图片 Provider 失败时使用 CSS、SVG 或占位 fallback，页面主链不会因为一张图片完全中断。

### 4:45–6:00 · QA/Repair 和安全

HTML Engineer 输出后先经过文档结构、安全、DSL marker 和素材绑定检查。Page QA 再综合静态启发式、三个固定视口的 Playwright 几何/互动证据和模型评价。

QA 不修改 HTML。确定性分类器决定问题应该修 DSL 还是 HTML；Repair 只能在授权范围内返回候选，候选重新通过原合同和 re-QA。连续三次无改善会安全停止。

生成 HTML 不使用 `dangerouslySetInnerHTML` 放进主 DOM，而是进入无同源权限的 sandbox iframe。学习器脚本由平台注入，不由模型生成。

### 6:00–7:10 · 长任务与前端状态

Task API 返回 `202` 后在服务端继续执行。checkpoint 成功写入 SQLite 后才发布公共事件。SSE 支持 snapshot、增量 event、terminal 和 Last-Event-ID 重放。

API client 和 `useSSETask` 负责传输，`ChatApp` 负责每个会话独立的任务、draft、附件和 stream。展示组件不直接调用业务 API，也不解析 LangGraph chunk。

### 7:10–8:00 · 可靠性、验证与边界

AbortSignal 贯穿 Agent、模型和图片调用；模型按 cheap、balanced、strong 路由，对有限瞬时错误只做一次降级。Intent、Planner 和模板检索有版本化、Schema-valid 缓存。

自动测试覆盖 Schema、Workflow、任务/SSE、HTML/QA/Repair 和 UI 投影；真实模型用三个固定 Demo 和语义基线单独验收。

当前不足是单进程任务执行、本地存储、没有账号权限和分布式队列，也没有 OCR 或向量库。继续生产化会先补耐久 Worker、对象存储、权限与发布门槛。

## 15 分钟版本

### 0:00–1:30 · 产品问题

先演示从 `/chat` 建立课程简报，再展示生成中的课程章节和最终播放器。说明目标不是输出一段文章，而是交付一门可以学习、互动、恢复和导出的课程。

### 1:30–3:00 · 为什么不能一次生成

用四个具体失败说明超级 Prompt 的上限：

1. 课程规划和单页视觉指令冲突；
2. 多页 HTML 容易超长或截断；
3. 一页错误无法独立恢复；
4. 生成者评价自己容易漏掉内容和交互问题。

引出结构化 handoff 和页面隔离。

### 3:00–5:00 · Schema 与状态

讲解 `CourseGenerationState` 如何连接全局产物、页面产物、错误、attempt、公开事件和 checkpoint。说明持久化前后都校验，以及为什么并发 Worker 必须通过单一 merge 队列写整课状态。

可追问：

- 旧 checkpoint 如何兼容新增字段？
- 为什么 UI 不维护第二套业务状态？
- 为什么公开事件 summary 不能反向作为路由事实？

### 5:00–7:00 · 编排与职责

沿着 Intent → Planner → Design → Page Worker → Finalize 说明。强调：

- Supervisor 是控制面；
- Specialist 生成专业产物；
- Worker 管理执行范围；
- Skill 执行工具；
- Validator 判断合同；
- Template 提供结构和 Token。

再解释为什么 Graph 是编排实现，不是业务事实来源；手写兼容入口和 Graph 共用领域原语。

### 7:00–9:00 · 页面生成

从一个 PagePlan 开始：

1. Planner 选功能/样式模板和资料引用；
2. Page Writer 生成 DSL；
3. Image Prompt 生成素材请求；
4. Skill 查询缓存、调用 Provider 或返回 fallback；
5. HTML Engineer 实现 DSL 和素材；
6. 服务端验证 HTML；
7. QA/Repair 迭代到通过或安全停止。

说明为什么图片不能承载文字与互动，以及混合 DSL 相比自由 HTML/纯组件树的取舍。

### 9:00–11:00 · 质量和安全

展示六维 QualityReport、三视口 Playwright 证据和 Repair 历史。解释确定性检查与模型评价互补：

- 程序适合检查合同、危险属性、overflow 和互动协议；
- 模型适合判断教学连贯、解释质量和风格一致性；
- 人工仍负责最终审美和事实验收。

然后说明 sandbox、平台脚本、消息来源校验和权限限制。

### 11:00–13:00 · 长任务前端

讲 Task API、SQLite checkpoint、EventBus、SSE 和 `useSSETask`。重点说明：

- 断开 SSE 不等于取消任务；
- pause 是非终态，cancel 是终态；
- 每个会话有独立 runner、draft 和附件；
- 刷新后从持久化记录恢复；
- 完成课程在 `/course` 统一查询和导出。

### 13:00–14:00 · 可靠性与测试

讲超时、AbortSignal、模型档位、一次瞬时 fallback、结构化缓存和安全 telemetry。自动测试与真实模型验收分开：fixture 检查确定性合同，固定 Demo 检查真实模型、图片、浏览器和导出。

不要声称现有记录已经通过；可以说明失败结果如何定位页面数量、QA、截图和 ZIP 缺失。

### 14:00–15:00 · 取舍与下一步

主动承认当前边界，并给出生产化顺序：

1. 耐久任务队列、course lease 和跨实例事件；
2. 对象存储与有时效资源 URL；
3. 用户、权限和租户隔离；
4. 成本账本、发布审批和真实用户质量反馈；
5. 在明确需求出现后再考虑向量检索或编辑器。

收尾句：这个项目的核心不是 Agent 数量，而是把开放模型能力放进了可验证、可恢复、可安全展示的前端产品。

## 高频追问

### 1. 为什么 SSE，不用 WebSocket？

课程生成主要是服务端单向推送，SSE 原生支持事件 ID、自动重连和 HTTP 基础设施；控制操作继续使用 POST/PATCH/DELETE。若未来需要高频双向协作编辑，再考虑 WebSocket。

### 2. 为什么不是纯 Workflow？

固定的校验、合并和工具调用就是 Workflow；开放的课程规划、内容、视觉和质量判断交给 Agent。项目不是所有步骤都动态路由，而是在需要模型生成专业产物的边界使用 Agent。

### 3. 为什么 Graph 不直接把 stream 传给前端？

框架 chunk 含内部节点与状态，协议会随实现变化。服务端 mapper 只投影共享 Schema，未来替换 Graph 或传输方式时不用重做 UI。

### 4. 怎么控制循环？

节点合法集合、页面 attempt、错误可恢复性、质量停滞计数和紧急上限都由确定性代码控制。Supervisor 不能提高预算，Repair 不能自行宣布通过。

### 5. 最核心的技术贡献是什么？

把模型调用扩展为端到端课程交付系统：结构化 Agent handoff、页面级质量闭环、可恢复任务/SSE、生成 HTML 安全和可消费的复杂前端状态共同形成一条可验证主链路。

## 证据入口

- [项目 README](../README.md)
- [架构入口](architecture/README.md)
- [从提示词到最终 HTML](architecture/prompt-to-html-current-flow.md)
- [为什么采用多 Agent](why-multi-agent.md)
- [Demo 验收方法](demo/prompts.md)
- [共享 Schema](schema.md)
- [可靠性与成本](reliability-cost.md)
