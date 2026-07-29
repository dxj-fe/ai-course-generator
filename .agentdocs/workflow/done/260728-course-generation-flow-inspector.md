# 一句话生成课程：交互式流程分析页

## 目标

基于当前工作区真实代码，把 `/chat` 中“一句话生成课程”从输入整理、异步任务、LangGraph 编排、全局设计、逐页生成、质量修复、持久化到前端播放的完整链路做成可交互流程图。使用者可以缩放、拖动画布，点击节点查看该节点的输入、动作、输出、模型调用、失败方式和源码证据。

## 范围与边界

- 新增只读诊断路由 `/analysis/course-generation`，不修改课程生成业务逻辑、状态 Schema、API 或模型 Prompt。
- 页面事实以 `docs/architecture/prompt-to-html-current-flow.md` 和对应源码为准。
- 不展示私有 chain-of-thought，只展示代码能够证明的职责、公开产物、重试边界和错误分类。
- 不引入新的流程图库；使用 React、SVG 连线与 CSS transform 实现可平移缩放的节点画布。

## 视觉与交互基准

- Visual thesis：暖白工程纸上的课程生产线路图，墨绿为正常主链，琥珀色标出质量风险，红色只表示终止级失败。
- Content plan：顶部概览与风险摘要、中央全画布流程、右侧节点检查器、底部图例与操作提示。
- Interaction thesis：
  - 首屏节点与连线分层淡入；
  - 画布支持拖拽平移、滚轮缩放和一键适配；
  - 点击或搜索节点后，画布平滑聚焦，检查器切换该节点的证据详情。

## 分阶段计划

- [x] 阶段 1：核对前端入口、任务 Route、Task Service、LangGraph、Page Worker、QA/Repair、SSE 和播放链路。
- [x] 阶段 2：定义节点、连线、阶段、风险等级与详情数据合同。
- [x] 阶段 3：实现 `/analysis/course-generation` 交互页面和响应式样式。
- [x] 阶段 4：补充数据完整性测试，运行 lint、test、build。
- [x] 阶段 5：浏览器检查桌面与窄屏布局，完成文档回顾并归档任务文档。

## 已确认的关键事实

1. 用户第一次提交只创建 `CourseCreationBrief`；目标明确后才编译 `taskPrompt` 并创建任务。
2. `POST /api/courses/tasks` 强制把新任务的运行源设为 `langgraph`，通过 `after()` 启动后台执行。
3. Supervisor 是 rule-first 的确定性路由器，不调用模型；它根据已校验状态选择 Intent、Planner、Course Design、Page Worker、Repair、Retry 或 Finalize。
4. Pedagogy、Story、Visual 串行生成整课 brief；单页 Worker 再执行 Page Writer、Assets、HTML Engineer、Page QA。
5. HTML 不是 Prompt 直接生成：Page Writer 先生成结构化 DSL，HTML Engineer 才将 DSL、视觉 brief 和已批准素材实现为完整 HTML。
6. QA 同时包含静态启发式、三视口浏览器证据和模型六维评价；未达标时进入受限 Repair/re-QA 循环。
7. 每次被接受的状态更新先通过 Schema 并写 checkpoint，再映射成公开 SSE；浏览器不接收 LangGraph 原生 chunk 或私有 Prompt。

## 当前优先排查方向

- P0：模型/Provider 配置、鉴权、额度和超时会在多个强模型节点重复暴露，容易造成整链路终止。
- P0：结构化模型输出必须通过严格 Zod Schema；长课程会放大 Planner 与三个整课 brief 的长度、对齐和超时风险。
- P0：每页至少有 Page Writer、HTML Engineer、QA 三次强模型调用，Repair 又会重复模型与浏览器 QA，质量循环可能显著放大耗时和错误概率。
- P1：图片失败虽然可降级，但 fallback 会直接降低素材可用性与最终观感；Repair 不能修复上游 Provider 素材失败。
- P1：并发模式默认只在 Worker 层隔离；单页失败可以保留其他完成页，但依赖页仍会停留未执行并使整课不能 Finalize。
- P1：Playwright 截图失败被设计为非阻断，这提高可用性，但会让缺少浏览器证据的页面继续依赖静态与模型 QA。
- P2：确定性 HTML fallback 保证合同可用，但通常会牺牲模型生成页面的视觉丰富度。

## 验证标准

- 所有节点 ID 唯一，所有连线端点存在，至少覆盖输入、任务、全局设计、逐页生成、质量闭环和交付六类阶段。
- 页面可通过键盘选择节点，支持搜索、风险筛选、拖拽平移、滚轮缩放与适配画布。
- 每个节点详情至少包含职责、输入、处理、输出、失败点和源码文件。
- `npm run lint`、相关 Vitest、`npm run build` 均通过。
- 桌面和窄屏浏览器截图中无关键内容裁切，节点详情在移动端可读取。

## 完成记录

- 已实现 22 个源码事实节点、27 条主链/条件/回环连线和 4 条优先风险摘要。
- 已实现拖拽平移、滚轮/按钮缩放、适配画布、阶段/风险筛选、节点搜索、点击聚焦与响应式详情抽屉。
- 已通过 ESLint、4 条数据/渲染测试、Next.js production build。
- 已用 Playwright 检查 1440×1000 桌面视口与 390×844 窄屏视口；开发服务器出现的 HMR WebSocket 日志来自 `127.0.0.1` dev origin 限制，production build 页面无对应运行错误。
