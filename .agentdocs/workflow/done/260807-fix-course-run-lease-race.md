# 修复生课租约竞态、机械模型回合与页面阻塞恢复

## 目标

彻底修复课程生成在 Agent 尚未真正开始或仍处于阶段预算内时，被恢复 Worker 抢占并错误标记整课失败的问题；同时消除 Harness 已知下一步仍重复请求模型的长尾等待，并让单页质量阻塞回到 Course Lead 重新分配职责。租约只能用于避免重复执行，不能把可恢复的调度竞争或局部页面过载转化成整课失败。

## 现场证据

失败任务：`task-a909f24f-c172-46b6-9989-d7044cf91b2b`。

- CourseRun 于 `2026-08-07T06:27:31.943Z` 建立，基础租约为 120 秒；
- Architect WorkOrder 于 `06:27:32.043Z` 被领取，阶段预算 120 秒，含 60 秒宽限后的子租约到 `06:30:32.043Z`；
- 子 WorkOrder 的 `lockVersion=1`，说明只完成领取、尚未完成首次统一续租；
- 恢复 Worker 于约 125 秒后接管已过期的父 CourseRun，但子 WorkOrder 仍有约 55 秒有效租约；
- 新 Engine 无法领取子 WorkOrder，抛出 `CourseRunLeaseUnavailableError`；
- Engine 把该调度错误错误地执行为 `course_failed`，最终产生 `COURSE_RUN_ENGINE_FAILED`；
- 事件中没有模型调用、工具调用或架构提交，因此本次失败与 Doubao 模型质量和响应速度无关。

## 根因

### 1. 父子租约存在不一致窗口

Engine 先领取 WorkOrder，再续期 CourseRun。若进程在两步之间退出、卡住或被其他执行入口中断，会形成：

```text
CourseRun lease = 120 秒
WorkOrder lease = 阶段 timeout + 60 秒 = 180/360 秒
```

父租约早于子租约过期，恢复 Worker 会错误判断整个运行可以接管。

### 2. 恢复扫描只检查父租约

恢复扫描没有检查仍有效的 running WorkOrder。父租约一旦过期，即使子 Agent 仍持有工作单，也会被列为恢复候选。

### 3. Engine 错误分类顺序不正确

Task Service 已把 `CourseRunLeaseUnavailableError` 视为并发输家退出，但 Engine 在错误到达 Task Service 前先调用 `failCourse`，将可恢复调度错误永久化。

### 4. Planner 的声明预算与实际预算冲突

配置层允许 Lead 使用 300 秒，代码注释也声称 Planner 有 5 分钟预算，但 Agent Catalog 把 Architect WorkOrder 写死为 120 秒。真实 Doubao 2.0 Pro 首次请求恰好在 120.084 秒被本地总预算中断，下一 executionAttempt 仅 40.618 秒便成功，证明这是长尾 Provider 调用被过短本地 deadline 截断，不是循环。

### 5. Harness 已知机械下一步仍经过 Provider

Page Creator 已把 CourseContext 和 workspace 预加载进 Prompt，`edit_page_workspace` 也会自动渲染；但读取预加载状态、把浏览器证据封装为 PageQuality、最终 submit/block 仍可能各消耗一次 Pro 模型调用。工具通常只需几十毫秒到一秒，模型机械回合却可能需要 30～70 秒，多个质量修订会把 300 秒页面预算耗尽。

### 6. 单页阻塞被错误放大成整课失败

Page Creator 在真实三视口中完成最多三轮修订后，若页面职责仍过载，会合法提交 blocked。旧 Engine 将任何当前分支 blocked WorkOrder 直接执行为 `course_failed`，Course Lead 没有机会根据 PageQuality 重新分配同一页数内的教学职责。这违背多 Agent 协作边界，也让局部排版问题永久污染整课。

### 7. 课程级并发叠加页面并发，压垮 Provider 长尾

恢复 Worker 默认同时执行两门课程，而每门课程内部又允许三个 Page Creator 并行。真实盲测因此同时向同一 Doubao Provider 发出六个长 HTML 请求；正常请求约 45～100 秒，但高压下多个回合一直等待到 300 秒总预算才由本地 AbortSignal 中断。多 Agent 并发应该发生在一门课程内部，课程队列不应在没有独立容量池时再次倍增并发。

### 8. SDK 隐式重试和单步 deadline 过长

Agent Loop 已具备 WorkOrder、workspace 与 Artifact checkpoint 恢复，AI SDK 的同回合隐式重试不会增加可靠性，反而会让相同 HTTP 请求原地占用完整阶段预算。此前单步 Provider 上限 240 秒，也几乎吃光 Page Creator 的 300 秒总预算，导致失败后没有足够时间利用已有 checkpoint 收敛。

### 9. 兼容投影掩盖了可验证的质量承诺

- 轻量规划省略年龄区间时，小学五年级被兼容默认成 16～65 岁；
- `requiresInteraction=true` 只停留在架构里，HTML 即使没有任何可操作 DOM 也能通过；
- contain-fit 会把 1920×1096 等非 16:9 文档整体缩小，旧 4% 容差让它伪装成无滚动页面。

这些不应交给固定模板解决，而应由 Harness 对年龄语义、互动存在性和舞台几何做最小且可验证的约束。

### 10. 固定画布测量把装饰动画误判成整页溢出

真实失败页的 `body/main` 已是 1920×1080，但绝对定位光晕、波纹或关键帧动画会短暂越过舞台边缘。旧 contain-fit 使用所有后代的滚动边界计算原始尺寸，先把整个页面额外缩小，再由 Browser Harness 把同一装饰越界报告成正文溢出。固定画布的 contain-fit 应以 authored `body/main` 尺寸为准，文字和控件裁切则继续由独立 DOM Range/交互盒检查。

### 11. Architect 工具封装诱发无价值重试

Doubao 会在合法 `draft` 之外补出 `architecture:null`、`patches:null`。旧 Handler 把这种机械 envelope 视为三选一冲突，真实规划连续三次收到相同拒绝，149 秒后才提交。Harness 现在按 `draft > architecture > patches` 选择唯一有效载荷；门禁修订继续提交轻量 draft，由 Harness 提取问题范围，不要求模型编写补丁 DSL。

### 12. 页面修订历史线性放大 Provider 上下文

每次 `edit_page_workspace` 都会把一份完整 HTML 留在 ToolLoop 对话里，三轮修订后模型会同时收到多个旧 HTML、旧工具结果和三张新截图。真实盲测中首轮通常 80～110 秒，后续在膨胀上下文上出现 300 秒总预算耗尽。质量修订现在只保留系统消息和最初封口任务，由 Harness 重新注入唯一当前 HTML、精确 issue/selector/repairHint 以及最新三视口截图。

同时，首稿 Prompt 明确唯一 `main`、1920×1080 内容预算、缩放后的最小命中区、真实原生互动和禁止失效按钮，减少本可在首稿避免的结构返工。

### 13. “有控件”不等于“互动有效”

真实完成课程的互动页使用了 range，但用 CSS `[value]` 选择器期待拖动后改变动画和反馈；浏览器只更新 input property，不更新 HTML attribute，因此滑块看似可拖，页面结果永远不变。旧 Gate 只检查 `interactiveCount > 0`，会把伪互动当作通过。Browser Harness 现在会真实操作 details、checkbox/radio、select、文本控件和 range，并比较控件之外的 DOM/可见样式/伪元素反馈；只有产生可观察状态变化才通过。

### 14. 单一成功控件会掩盖同页伪互动，正文裸露标记未被识别

第二轮真实盲测暴露出两个语义 QA 缺口：页面同时包含有效 details 和无反馈 range 时，旧 Harness 遇到第一个可用控件就返回成功，没有继续验证其他状态控件；另一页把 `span class="highlight">` 当正文直接展示，机械 HTML 合同合法、Reviewer 也未识别。Harness 现在会同时回放代表性的 details 和状态控件，任何一个伪互动都阻断交付；浏览器还会扫描 code/pre 之外的可见文本节点，裸露 HTML 标记按内容错误返工。

## 修复原则

1. 领取子 WorkOrder 前，先把父 CourseRun 续期到至少与该 WorkOrder 相同的阶段预算；
2. 恢复扫描必须同时检查父 CourseRun 和任何仍有效的 running WorkOrder；
3. 所有租约不可用错误在 Engine 层直接向外传播，绝不写 `course_failed`；
4. 明确区分“父租约已有赢家”和“父租约已接管但子租约仍有效”，后者回到 queued 等待安全恢复；
5. 增加结构化租约日志，能够直接看到 owner、expiresAt、阶段和等待原因；
6. 只有真实证据表明声明预算与实际预算矛盾时才对齐 deadline，不通过普遍放大超时掩盖循环；模型路由仍固定 Doubao 2.0 Pro；
7. Harness 自动执行 read/render/inspect/submit/block 等唯一确定性状态迁移，模型只用于规划、创作和有选择空间的修订；
8. 页面 blocked 先创建 Course Lead 恢复回合，将 PageQuality 作为封口通信证据并创建新版 Architect WorkOrder；只有 replan 预算耗尽才允许受控失败；
9. 固定 1920×1080 舞台是平台合同，静态质量规则不能把它误报为普通固定宽度或 `overflow:hidden` 风险。
10. 默认一次只执行一门课程，课程内部仍保留三个 Page Creator 并行；只有部署了独立 Provider 容量池时才显式提高课程级并发；
11. Provider 单回合 150 秒熔断并关闭 SDK 隐式重试，瞬态失败由持久化 WorkOrder 从 checkpoint 续跑；
12. Harness 从明确年龄/年级描述投影真实学龄，并验证承诺互动在真实 DOM 中存在；原始文档超过 1920×1080 八像素测量容差即阻断。
13. 固定画布几何只使用 authored `body/main` 尺寸；装饰越界由舞台裁切，真实文字/控件裁切保持独立阻断。
14. Architect 接受 Provider 冗余 null envelope；Page Creator 每轮只携带当前 HTML 和当前浏览器证据，不累计旧完整版本。
15. `requiresInteraction` 必须通过 Playwright 原生控件回放并产生控件之外的可观察反馈；单纯可拖、可勾选但教学状态不变化仍按伪互动阻断。
16. 同页存在多个原生互动类别时不能用一个成功控件替其他控件背书；code/pre 之外的裸露 HTML 标记属于阻断性内容错误。

## TODO

- [x] 增加父租约短于子租约时的 Engine 回归测试；
- [x] 增加恢复扫描跳过活跃 WorkOrder 的回归测试；
- [x] 领取 WorkOrder 前预续期父 CourseRun；
- [x] Engine 不再终态化租约冲突；
- [x] Task Service 对活跃子租约冲突回到 queued；
- [x] 增加租约诊断事件与耗时日志；
- [x] 对齐 Lead WorkOrder 与 Planner 的 300 秒总预算；
- [x] 唯一机械状态由 Harness 在下一次 Provider 调用前直接推进并写工具台账；
- [x] 单页 blocked 交给 Course Lead 基于 PageQuality 重新规划；
- [x] 去除 Provider 残留 reasoning 标签，并停止误报固定课程舞台；
- [x] 课程级默认串行、课程内页面三路并行，避免 Provider 并发倍增；
- [x] Provider 单回合改为 150 秒且关闭 SDK 原地重试；
- [x] 修正学龄投影、互动承诺和 16:9 原始文档证据；
- [x] 修正固定画布装饰越界误报，并用真实失败 HTML 完成三视口回归；
- [x] 容忍 Architect 冗余 null envelope，避免轻量 draft 被机械合同反复拒绝；
- [x] 压缩 Page Creator 修订上下文，并把精确浏览器问题与当前 HTML 注入下一轮；
- [x] 对原生 HTML/CSS 互动执行真实 Playwright 回放，拒绝无反馈 range 等伪互动；
- [x] 同页继续验证 details 之外的状态控件，并拒绝课程正文中的裸露 HTML 标记；
- [x] 通过相关单元测试、真实 Chromium 集成测试、lint 和生产构建；
- [x] 重启开发服务并用真实 Doubao 2.0 Pro 生成课程验收。

## 验证记录

- 真实 Doubao 2.0 Pro 盲测 `task-70ec23af-92a2-4f33-b1a1-d6f2a9c94ce6`：3 页课程总耗时 350407ms，三路 Page Creator 并行，全部发布成功；
- 三页均为 1920×1080，1280×720、960×540、640×360 三视口横纵溢出均为 0，页面质量分均为 90；
- details 原生互动在三个视口均产生可观察变化；盲测中暴露的同页伪 range 和裸露 HTML 标记已追加为阻断 Gate；
- 用新 Harness 直接重放该盲测真实产物：第 2 页命中 `BROWSER_RAW_MARKUP_VISIBLE`，第 3 页在三个视口都同时记录 `change-range=failed` 与 `toggle-details=passed`，证明一个有效 details 不再掩盖伪 range；
- `tests/unit/server/quality/playwright-screenshot.test.ts`：23/23 通过；本轮 Lease、Page Agent 与 Browser Harness 相关定向测试共 50/50 通过；
- 真实 Chromium 新增回归：同页有效 details 不得掩盖伪 range、code 示例不误报但正文裸露标记必须拒绝，2/2 通过；
- `pnpm lint`：0 error，保留参考资源中 2 个既有 unused warning；
- `pnpm build`：Next.js 编译、TypeScript、静态页面与全部路由生成通过；
- 失败数据 dry-run 为空；历史失败数据备份位于 `.data/backups/failed-courses-2026-08-07T08-49-42-226Z/`。
