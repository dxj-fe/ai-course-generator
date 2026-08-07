# 彻底修复生课高频失败

## 目标

从运行环境、任务调度、Agent Loop、模型路由、Browser Harness 和错误语义六个层面定位当前生课经常失败的根因，修复后保证：

1. 浏览器环境不可用时不启动昂贵的 Agent 任务，不把平台故障误判为页面质量问题；
2. Web 进程不再隐式恢复长任务，课程生成和 Playwright 由显式 Worker 承担；
3. 所有文本模型能力统一使用 Doubao Seed 2.0 Pro，不再降级到 mini/lite；
4. 供应商错误、Harness 错误和内容质量错误保持不同语义，避免 Agent 用改 HTML 的方式修“浏览器启动失败”。
5. Provider 瞬态超时与 Worker 中断从最近 WorkOrder checkpoint / workspace 恢复，不直接终态化整课。
6. 典型 4～5 页课程在三路 Page Creator 并行下稳定落在 15 分钟以内。

## 当前证据

- 历史 4 页失败任务 `task-2ea4...` 总计运行 17.3 分钟：规划两次耗时 7 分 39 秒；第 2、3 页分别在重复修订中运行 7 分 57 秒和 9 分 26 秒，第 4 页没有获得执行槽。慢点不是 HTML 文件写入，而是串联的 Provider 回合、固定画布返工和失败重试。
- Doubao Pro 健康调用约 1.4 秒；真实页面初稿通常 45～80 秒，局部修订约 3～80 秒，少数续调用会长尾到阶段截止。模型延迟有波动，但只有被 Harness 放大为多轮机械调用时才造成整课超时。
- 旧 Course Lead 首轮先调用 `search_references`，第二次 Provider 调用曾准确撞到 120 秒截止；相同任务重试后又能在 32 秒提交，说明“检索回合 + 二次生成”的结构会把 Provider 长尾放大为整轮失败。
- 旧 QA 要求整页塞入 922×460 / 712×650 固定画布并 contain-fit，丰富的自然网页被判定需要缩放到约 40%，引发多轮删内容和缩字。切换学习器纵向滚动后，纵向长度只做 warning。
- Browser 的旧裁切检测只要 `overflow:hidden` 容器含文字且装饰几何越界就报硬错误。太阳系轨道舞台因此连续修订四版仍失败；改为只在真实文字或交互盒越过裁切边界时阻断后，装饰轨道不再误报，正文真实裁切仍可精确定位。
- Worker 重启时，固定 15 分钟 CourseRun lease 会让新进程长期等待；现在恢复等待上限是当前阶段预算加 1 分钟，lease 基础下限为 2 分钟。
- Page Creator 达到修订预算后，旧链路还要求模型再做一次机械 `submit_page` / `block_page`，可能在终点再次超时或得到 `AgentTerminalNotCommittedError`；现在 Harness 直接执行唯一终态工具。
- 最终真实盲测 `task-0a35c1dc...` 使用固定 Doubao Seed 2.0 Pro 与 Chromium `149.0.7827.55`：Course Lead 33.676 秒一次提交，5 个页面三路并发全部完成，Reviewer 12.009 秒，Final Lead 2.161 秒，后端总耗时 416.523 秒；Demo 总耗时 421 秒、综合分 93.32、0 issue、0 warning。

## 根因判断

### P0：运行方式让 Browser Harness 处于不可用权限环境

当前实例是在受限进程中启动的 `next start`，Chromium 无法完成操作系统端口注册。这是最近批量失败的直接原因。

### P0：基础设施失败被建模为页面质量失败

Browser 启动失败不能由 Page Creator 修改 HTML 解决。旧链路却把它写入 `page_quality`，同时消耗模型、图片与修订预算，最后使整课失败。

### P1：Web 与 Worker 责任交叉

Web Route、Next 启动恢复和显式 Worker 都能执行生课。虽然有 lease 防止双写，但执行资源、Playwright 权限、日志和部署边界不清晰。正确方向是 Web 只创建持久任务，显式 Worker 做 Agent Loop 与 Browser Harness。

### P1：模型档位影响与平台错误混在一起

架构规划直接使用 mini，页面和 Reviewer 的 fallback 也会使用 mini。先统一 Pro 并取消跨档降级，才能在下一轮真实课程中隔离判断 Agent/Harness 问题。

### P0：瞬态 Provider 超时被当成整课终态

Agent 总预算内的网络/Provider 超时过去会把当前 WorkOrder 和 CourseRun 直接写成失败。现在同一个 Pro 模型最多进行三次有界 executionAttempt，期间保留 Artifact checkpoint 和稳定 WorkOrder workspace；Task 回到 queued，由 Worker 下一轮恢复。

### P0：高价值创作前串联了不必要的模型回合

资料只给索引会迫使 Lead 先检索再规划；页面先读上下文、再写 HTML、再单独 render/inspect 也会重复消耗长尾 Provider 请求。现在 Lead 的 Skill 核心说明和有界资料证据直接预加载，Provider 首轮只开放 `submit_course_architecture`；Page Creator 首轮已得到 CourseContext、PageTask、workspace 和事实边界，第一次动作直接编辑完整 HTML，编辑工具自动 checkpoint、Playwright 渲染并返回证据。

### P0：固定幻灯片画布与网页课程目标冲突

课程交付物是可滚动 HTML，不应把丰富内容强制压缩进一张短横向幻灯片。学习端现在使用自然纵向滚动；横向溢出、真实正文裁切、失效互动、运行时错误仍是硬错误，页面高度、折叠后主操作只做可达性观测。

### P1：粗粒度 Browser 指标制造无效返工

单纯比较容器 `scrollWidth/scrollHeight` 无法区分装饰性舞台裁切和正文丢失。Browser Harness 现在检查真实文字 Range 与交互控件盒是否越过裁切边界，并保留 selector、视口、DOM、Console 和互动证据。

### P1：页面工具状态机允许旧质量报告封死新 HTML

旧 activeTools 在等待 `inspect_page` 时仍暴露编辑工具，Provider 可能在相邻 step 中先检查后编辑；修订预算一到，系统又基于旧 `page_quality` 只开放 `block_page`。现在 `edit_page_workspace` 会自动完成 checkpoint、Playwright render 与 inspect，最终版本必须获得当前浏览器证据后才能 submit 或 block。

### P1：超时、租约和终态边界互相错配

不是简单把所有超时放大。Lead 在消除机械检索后使用 120 秒总预算；Page Creator 的多轮创作共享 300 秒总 deadline；Reviewer 120 秒；Final Lead 60 秒。每次 continuation 不重置页面 deadline。Worker lease 至少覆盖阶段预算加 1 分钟，异常恢复不再固定等待 15 分钟；唯一机械终态由 Harness 直接提交，避免在预算末端再赌一次模型响应。

## 实施计划

- [x] 把所有文本能力路由统一到 strong，取消 balanced/cheap fallback。
- [x] 把文本模型固定为 `doubao-seed-2-0-pro-260215`，取消专用 HTML 文本模型绕过。
- [x] 为 Browser Pool 增加健康预检与启动失败冷却，避免每页每轮重复拉起 Chromium。
- [x] Browser 启动失败直接抛出基础设施错误，不写入 PageQuality，不消耗页面修订轮数。
- [x] Web 创建/恢复课程只写 queued 任务；显式 Worker 在 Browser/Model 预检通过后才扫描并执行任务。
- [x] 提供可同时启动 Web + Worker 的本地命令，部署仍可分离启动两个进程。
- [x] 补充模型路由、Browser Pool、截图基础设施错误、Route 任务语义和 Worker 预检测试。
- [x] Provider/Agent 瞬态失败使用同一个 Pro 模型有界重试三次，Task 回到 queued 并保留 checkpoint。
- [x] WorkOrder workspace 跨 executionAttempt 使用稳定目录；数据库 checkpoint 只在本地文件缺失时初始化，不覆盖 Agent 未提交的新版本。
- [x] 收紧 Page Creator activeTools 状态机：编辑后强制 render、render 后强制 inspect、最终 HTML 不再被旧质量报告提前 block。
- [x] 学习器改为自然纵向滚动，纵向内容长度从硬错误降为 warning，保留横向溢出、真实裁切和互动错误硬门禁。
- [x] Course Lead 使用轻量 draft，由 Harness 投影稳定 ID 与兼容字段；资料证据和 Skill 核心说明首轮预加载，只开放提交工具。
- [x] Page Creator 首轮预加载全部页面上下文，编辑工具自动渲染检查；所有可运行页面进入三路连续补位并发池。
- [x] 页面最多进行 3 轮有证据的质量修订；唯一 submit/block 终态由 Harness 确定性执行。
- [x] CourseRun 与 WorkOrder lease 改为阶段预算驱动，基础下限 2 分钟，不再固定等待 15 分钟。
- [x] Browser 裁切检测区分装饰几何越界与真实文字/交互裁切。
- [x] 增加每次 Agent run、Provider 回合和 Tool 执行耗时日志。
- [x] 运行 lint、全量测试、真实 Chromium 集成测试和 build。
- [x] 以非受限 Worker 恢复真实课程，核对日志中只有 Doubao Seed 2.0 Pro 且不再出现 Browser launch 失败。
- [x] 完成固定 Doubao Seed 2.0 Pro 的 5 页真实盲测：421 秒通过，综合分 93.32，0 issue / 0 warning。

## 完成标准

- 环境不可用时任务留在 queued，不产生页面 blocked 产物；
- 正常环境下三视口 Browser Harness 能够稳定复用单一 Chromium 进程；
- 生课日志的文本模型 identity 只出现 `volcengine-ark/doubao-seed-2-0-pro-260215`；
- 平台故障、Provider 故障与页面质量故障分类清晰；
- 新建课程在显式 Worker 中完成，Web 进程只提供 API、SSE 与 UI。
- 典型 5 页课程三路并发在 15 分钟内完成；本次真实结果为 421 秒。

最终验证：全量回归 942 个测试通过、12 个按环境跳过；真实 Chromium 集成测试 10/10 通过；Prompt lint 通过；ESLint 0 error（历史模板资源 2 个 warning）；Next.js production build 通过。服务保持运行，Worker 预检模型为 `volcengine-ark/doubao-seed-2-0-pro-260215`，Chromium 为 `149.0.7827.55`。
