# Day 36 固定 Demo 与验收基线

## 为什么固定

面试主 Demo 必须同时可复现、可诊断、可比较。自由 Prompt 仍可展示系统
灵活性，但不用于判断一次代码修改是否破坏主链路。

固定 Demo 统一使用：

- 5 页；
- `agent-v2` 运行源和结构化 `CourseCreationBrief`；
- agent-v2 依赖波次调度、并发上限 1（便于稳定对比）；
- 自动 Page QA 和 Playwright 截图证据；
- 课程详情页桌面端与 390 × 844 移动端截图；
- ZIP 导出复核。

## 三个固定案例

### 火星探险

为 10–12 岁学生生成一门 5 页《火星探险任务》课程，依次建立探险情境、
解释火星环境、分析生存挑战、完成一道选择题并总结探险方案。必须讲到稀薄
大气、低温、水或氧气等生存资源，使用中文和轻松但科学准确的科幻风格。

基线：[`baselines/mars-exploration.json`](./baselines/mars-exploration.json)

### 太阳系

为 8–10 岁学生生成一门 5 页太阳系入门课程，依次介绍探索目标、解释太阳与
行星的区别、梳理八大行星的顺序或轨道、完成一道选择题并总结。必须讲到太阳
是恒星、行星围绕太阳运行，使用中文和清晰活泼的视觉风格。

基线：[`baselines/solar-system.json`](./baselines/solar-system.json)

### AI 素养

为初中生生成一门 5 页 AI 素养课程，依次说明 AI 能做什么与不能做什么、解释
幻觉和事实核验、讨论隐私与偏见风险、完成一个安全使用判断任务并总结负责任
使用原则。使用中文和专业简洁的视觉风格，不把 AI 描述成永远正确的人类。

基线：[`baselines/ai-literacy.json`](./baselines/ai-literacy.json)

## 一条命令运行

先保证 `.env.local` 或 `.env` 中存在真实模型和图片 Provider 配置，并安装
Playwright Chromium。Runner 会按 Next.js 的环境文件优先级加载配置，并在启动
服务前拒绝缺失值、占位 Key、占位模型 ID 和占位 Base URL，不会把明显无效的
配置发送给外部 Provider：

```bash
pnpm exec playwright install chromium
pnpm demo:run
```

Runner 默认启动独立本地 Next.js 开发服务，并强制启用截图 QA，避免复用旧
开发进程时继承错误的环境变量；因此不依赖线上部署。只有明确设置
`DEMO_BASE_URL` 时才复用指定服务。正式留存精选报告和截图时使用：

```bash
pnpm demo:run -- --record
```

排查单个案例时使用 `--case`；可选 ID 为 `mars-exploration`、
`solar-system` 和 `ai-literacy`。聚焦运行不能使用 `--record`，避免把不完整
案例集误记成正式通过：

```bash
pnpm demo:run -- --case solar-system
```

默认图片模型复用 `ARK_API_KEY`。只有使用独立图片 Provider 时，才同时填写
`IMAGE_API_KEY`、`IMAGE_BASE_URL`、`IMAGE_MODEL_ID` 和
`IMAGE_PROVIDER_NAME`；不要保留这组变量的示例占位值，否则它会覆盖 Ark 生图
配置。

原始课程 JSON、ZIP、服务日志和截图保存在 `.data/demo-runs/<runId>`。`--record`
只把聚合报告、桌面/移动截图和人工评分表复制到 `docs/demo/results/<runId>`。
聚合报告同时记录课程架构尝试/退回次数、整课是否首轮完成、首轮通过页面
数/比例、真正由模型生成且未返修的页面比例、确定性 HTML fallback 数量、
图片素材 ready/fallback 比例、Repair 总次数与平均次数、平均 QA/视觉分和
综合分，用来判断质量是否真的来自上游 Prompt、Tool、Skill、模型和 Context，
而不是靠重规划、更多返修或安全 fallback 换取表面通过。

单独复核已有产物：

```bash
pnpm demo:check -- \
  --course .data/demo-runs/<runId>/<case>/course.json \
  --baseline docs/demo/baselines/<case>.json \
  --archive .data/demo-runs/<runId>/<case>/<courseId>.zip
```

## 基准回归发布门槛

- `CourseGenerationStateSchema` 必须完整通过；
- 课程和全部页面必须为 completed；
- 大纲页数、页面职责、页型、交互和必备知识覆盖符合案例基线；
- 每页重新通过现有 HTML Engineer 的 DSL、HTML、安全和素材引用合同；
- 每页最终 QA 必须为 `pass`、`shouldRepair=false`；
- 每页必须由 HTML 模型完成，不能把确定性安全 fallback 计作模型质量通过；
- 已声明的图片素材必须为 `ready`，Provider fallback 只能作为生产降级，不能作为 Demo 成功证据；
- 每页总分至少 85；六维单项参考线用于观测与定位上游改进方向，低于参考线记
  warning，但不在没有具体交付错误时阻断 Demo；
- 每页必须带 `captured` Playwright 截图证据；
- 报告必须保留首轮通过率与 Repair 次数；最终通过但返修明显增加不能视为质量提升；
- ZIP 必须包含 `course.json`、全部有序页面 HTML 和素材清单；
- `/course/[courseId]` 桌面端和移动端无页面错误，移动端无横向溢出。

这里的分数用于整批基准比较和发布复核，不是生产 Page Gate 的自动 Repair 条件。生产链只有在出现可定位 `error` 时才返工；持续低分应优先回到 Prompt、模型、Skill、模板和上下文设计。

## 快照策略

模型输出不是逐字符确定的。基线只把页面职责、允许页型/交互和关键知识覆盖作为
硬门槛；标题、学习目标和摘要的措辞差异进入人工复核，不使用字符串快照阻止
合理生成变化。修改基线时必须说明是课程要求改变，还是在放宽一次失败结果。

## 人工评分

自动验收通过后，按内容正确性、教学连贯性、页面排版、风格一致性、HTML/交互
可用性、素材可用性六项各评 1–5 分。总分至少 24/30，且不能出现低于 3 分的
单项。模型自己的 QA 结论不能替代人工复核。
