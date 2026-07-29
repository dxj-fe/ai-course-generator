# Day 37 · README 与架构文档

## 今日产出

- 将根 README 从逐日交付流水账重构为面向面试官和开发者的五分钟项目入口。
- 新增架构入口，串联产品表面、Task Controller、LangGraph、Agent、Skill、Template、QA/Repair、持久化和 SSE。
- 新增单 Agent 与多 Agent 的事实对比，回答超级 Prompt、模板系统、混合 DSL 和图片素材的设计原因。
- 新增 3、8、15 分钟项目讲解和高频追问。
- 将历史训练记录迁移到独立训练日志。
- 审计 Demo 结果、截图和导出声明；保留失败事实，不把未通过记录包装为成功。

## README 的信息架构

README 只承担第一次阅读所需的信息：

1. 产品是什么、用户能做什么；
2. 一条课程如何生成；
3. 最重要的技术亮点和取舍；
4. 如何配置、启动和验证；
5. 当前安全边界、限制和文档入口。

每日实现细节迁入 `docs/training-log.md` 和既有 `notes/day-XX.md`，避免面试官先阅读训练流水账。

## 架构文档的事实来源

文档按以下优先级校验：

1. Route Handler 和 task service 决定当前产品入口和运行源；
2. Agent、Workflow、Graph node 和共享 Schema 决定业务合同；
3. API client、`useSSETask` 和 `ChatApp` 决定前端状态边界；
4. 测试和 Demo checker 决定可验证声明；
5. 历史训练文档只解释演进，不覆盖当前源码事实。

## 关键取舍

### 为什么没有新增 Day 37 产品页面

Day 37 是文档交付。README、架构图和面试讲解不需要新的产品路由、组件或第二套视觉系统。

### 为什么保留手写 Workflow 文档

`/chat` 新任务默认使用 LangGraph，但批量接口仍使用手写兼容 Workflow。两者复用同一 Agent、Page Worker、Schema 和 checkpoint 语义。删除兼容文档会让历史任务和批量入口失去解释；把它写成默认路径又会造成文档漂移。

### 为什么不展示失败 Demo 截图

仓库中两次正式记录都没有通过，且没有产生桌面/移动截图或 ZIP。文档明确记录这一状态；只有重新运行并通过 `pnpm demo:run -- --record` 后，才能把新证据放入 README。

## 面试复盘

### 如何向非项目成员解释架构？

先说课芽把一句需求变成一门可互动课程，再用“课程总设计 → 每页独立制作 → 质量检查与返工 → 持久化交付”四段解释。最后再映射到 Planner、Page Worker、QA/Repair 和 SSE，不从框架名开始。

### 为什么项目文档也是工程能力？

AI 系统的默认路径、公开/私有边界、重试语义和验证证据无法仅靠目录名理解。高质量文档把隐式假设变成可复核合同，也能暴露“源码已经变化、旧文档仍在描述过去”的漂移风险。

### 多 Agent 的价值如何量化？

本项目不虚构业务提升数字，而用工程结果说明：输出能按 Schema 校验，错误能定位到页面和阶段，完成页面能在失败后保留，QA 和 Repair 有独立记录，前端不依赖框架事件。这些都是可由测试和状态记录验证的结果。

## 验证结果

已执行：

```bash
pnpm lint
pnpm prompt:lint
pnpm test
pnpm build
```

- ESLint 通过。
- Prompt lint 通过：9 个 Specialist、8 个必需章节。
- Vitest 通过：104 个测试文件、768 个测试。
- Next.js 生产构建与 TypeScript 检查通过，共生成 33 个应用及 API 路由。
- 生产服务冒烟检查通过：`/`、`/chat`、`/course`、`/templates` 均返回 HTTP 200。
- 86 个 Markdown 文件的相对链接与图片路径检查通过。
- `git diff --check` 通过。

沙箱内首次运行测试和构建时，Playwright/Turbopack 因系统端口与进程权限被拒绝；在获准的非沙箱环境中重跑后全部通过。未调用真实模型或图片 Provider。
