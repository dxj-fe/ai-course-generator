# 架构总览

## 边界

课芽只有一套产品界面和一条课程生成链路：

- `src/app` 负责页面与 Route Handler。
- `src/features/keya` 负责产品组件、状态与浏览器端 API。
- `src/server/setup` 负责组合服务。
- `src/server/agent` 负责 Agent 定义、运行时、Prompt、工具和 Skill。
- `src/server/course` 负责课程领域、编排、Gate、投影和持久化。
- `src/shared` 负责前后端共享协议与 HTML 运行时。

Route Handler 不直接创建 Store 或 Agent，通过 `src/server/setup/web.ts` 获取已装配服务。课程运行入口是 `src/server/course/run/engine.ts`，状态读取入口是 `src/server/course/run/state-loader.ts`。

## 核心实体

- `CourseTaskRecord`：用户任务及其控制状态。
- `CourseRun`：一次课程编排运行。
- `WorkOrder`：Agent 可领取、可续租、可提交的工作单。
- `CourseArtifact`：不可变产物；`revision` 表示同一范围内的递增修订。
- `CourseGenerationState`：面向产品与 API 的当前课程投影。

## 运行原则

- 任务、运行和工作单使用租约与 CAS 防止重复执行。
- Agent 只能通过注册工具读写受控上下文。
- 页面和整课提交必须经过确定性 Gate。
- SSE 只公开结构化摘要、状态和安全错误，不公开私有推理。
- Prompt、Schema 和任务协议只有当前定义，不根据历史标识分流。
- SQLite 表只按当前结构初始化；结构变化由开发阶段重新创建本地数据库。

详细链路见[提示词到课程 HTML](generation-flow.md)。
