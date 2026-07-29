# AI Agent 前端训练历程

本文件保留项目从基础模型调用演进到完整课程生成系统的训练脉络。当前产品入口、启动和架构以根目录 [`README.md`](../README.md) 为准；每天的详细实现、面试题和复盘以 `notes/day-XX.md` 为准。

## 阶段一：AI 调用与结构化输出（Days 1–6）

- **Day 1–2**：完成 Next.js/TypeScript 基础工程、OpenAI-compatible Provider、普通与流式调用、统一 AI Client、请求参数和错误格式。
- **Day 3–4**：用 Zod/Structured Output 建立 `CourseIntent` 合同，并把 Intent Prompt 迁入可版本化、可审阅的模板。
- **Day 5–6**：实现 Skill Registry、Tool Calling、可序列化 AgentState、AgentEvent 和有步骤预算的最小 Agent Loop。

## 阶段二：课程领域、模板与页面 DSL（Days 7–12）

- **Day 7**：建立 Course、CoursePlan、PagePlan、Asset、Theme、QualityReport 等共享领域 Schema。
- **Day 8–9**：实现八种功能模板、六种样式模板和 Design Tokens，并验证功能/样式组合。
- **Day 10–11**：实现 Course Planner 以及 Pedagogy、Story、Visual 三个专业设计 Agent。
- **Day 12**：建立 `PageContentDSL`，明确语义内容、互动、素材槽与 HTML 的边界。

## 阶段三：HTML、素材、质量与长任务（Days 13–20）

- **Day 13–14**：定义生成 HTML 合同、安全预检和 sandbox iframe；接入 HTML Engineer。
- **Day 15–17**：实现六维 Page QA、图片 Prompt/生成 Skill、缓存、fallback 和素材到 HTML 的安全绑定。
- **Day 18–20**：完成多页课程工作流、可恢复 checkpoint、异步任务、严格 SSE 和前端任务状态投影。

## 阶段四：多 Agent 与质量闭环（Days 21–27）

- **Day 21–24**：梳理固定 Workflow、Supervisor/Specialist 边界、统一 Prompt Library 和结构化节点合同。
- **Day 25–26**：实现隔离 Page Worker、依赖感知调度、受控并发和 Playwright 多证据 QA。
- **Day 27**：接入定向 Repair/re-QA，区分内容/教学修复与 HTML/样式修复，并保存可审计的尝试记录。

## 阶段五：LangGraph 与资料检索（Days 28–33）

- **Day 28–31**：从独立 StateGraph 学习迁移到生产课程 Graph、严格 Graph stream mapper、规则型 Supervisor 条件边、单页重试和 Repair 路由。
- **Day 32**：接入 txt/md/pdf 资料解析、Reference Pack、页面级授权引用与 Prompt Injection 边界。
- **Day 33**：建立 Tool/Skill/Template/Reference Card 与有界检索，让 Agent 只接收短小、相关、可验证的上下文。

## 阶段六：产品化、可靠性与交付（Days 34–37）

- **Day 34**：完成课程历史、持久详情、断点返回、搜索筛选和 ZIP 导出。
- **Day 35**：补齐取消传播、有限超时、分级模型路由、结构化缓存、成本 telemetry 和有界降级。
- **Day 36**：建立三个固定 Demo、语义基线、CLI runner、Schema/HTML/QA/export checker 和人工评分方法。
- **Day 37**：把 README、架构入口、多 Agent 取舍和 3/8/15 分钟项目讲解整理为可复核的项目文档。

## 相关入口

- [架构入口](architecture/README.md)
- [固定 Demo](demo/prompts.md)
- [多 Agent 取舍](why-multi-agent.md)
- [项目讲解](interview-story.md)
- [训练进度](../.agentdocs/progress/frontend-training-progress.md)
