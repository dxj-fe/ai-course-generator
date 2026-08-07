# 多 Agent 设计

## 角色

| 层级 | 职责 | 数量 | 核心产物 |
| --- | --- | --- | --- |
| 主 Agent | Course Lead | 1 | CourseContext、Page WorkOrder、返工与发布决定 |
| 子 Agent | Page Creator | 每页 1 个，按并发池运行 | workspace、HTML、页面 Artifact、RenderEvidence |
| 子 Agent | Course Reviewer | 1 | 绑定当前 manifest 的 CourseReview |

这是一个主 Agent 职责和两个子 Agent 职责。生图、资料检索、读取 Skill、文件编辑和浏览器检查都是 Tool，不额外拆 Agent。

Web 不是 Agent 执行器，只负责持久任务入队、SSE 与产品界面。显式 Course Worker 是唯一的 Agent Loop 执行边界，内部持有共享 Browser Pool，并在领取 WorkOrder 前完成文本模型和 Chromium 预检。这样多 Agent 并行发生在具备完整浏览器权限的稳定后台进程中，而不是一次 Web 请求里。

新任务只使用一个 Course Lead Agent ID：持久化值沿用 `curriculum-architect`，同一身份先规划课程，在独立 Reviewer 提交 Review 后再做发布或返工决策。架构通过确定性 Gate 后直接派发页面，不运行第二次“架构审查”模型回合。`course-director` 仅恢复已经持久化的旧 WorkOrder，`page-builder` 已执行 Page Creator Loop。

## 协作方式

Agent 不自由群聊，也不复制整份 HTML。协作只通过三种持久协议：

- `WorkOrder`：范围、输入引用、依赖、工具权限、预算、租约和验收条件；
- `Artifact`：HTML、质量、摘要、截图证据等不可变 checkpoint；
- `Review`：问题、pageId、证据引用和修改目标。

所有依赖已满足的页面进入固定并发池，默认最多三个 Page Creator 同时执行；任一页面完成就立即补入下一张可运行 WorkOrder，不等待一整批结束。独立 workspace 保证页面间不会互相改文件；Repository 的 lease、CAS、幂等键和工具账本保证重试不会重复提交。

Course Worker 默认一次只领取一门课程。并行预算优先给同一课程的 Page Creator，而不是同时启动第二门课程把 Provider 压力从三路放大到六路；有独立 Provider 容量池时才通过运维配置显式提高课程级并发。

三页及以上课程至少保留两个无生成依赖的 Page WorkOrder。学习顺序、叙事承接或“上一页先展示”不能写成构建依赖；只有后页必须消费前页实际摘要、数据或结论时才进入下一波。该规则由 Architecture Gate 保障，避免模型把并行模式重新规划成串行链。

## Agent 自由与 Harness 约束

Page Creator 自主决定页面构图、信息层级、视觉语言、是否生图和如何修订。Skill 只提供风格与方法参考，不是模板。

Harness 只负责：

- Agent Loop 步数、工具预算、超时、取消和恢复；
- WorkOrder scope、依赖和并发；
- workspace 路径安全与 Artifact checkpoint；
- 引用权限、HTML 安全 envelope、可信运行时和 iframe sandbox；
- Playwright 三视口、DOM、Console、网络与受控互动证据；
- manifest 一致性和 Final Gate。

Harness 不规定卡片数量、组件树、页面布局、图片数量、互动形态或样式模板。模型不需要输出 pageType、模板 ID、素材槽等迁移字段，也不需要在写 HTML 时同步填写 blocks、interaction 或 layoutHints。HTML 是页面内容真相，workspace 元数据只记录实际使用的授权资料；Schema 只为旧下游自动补兼容默认值。页面 HTML Gate 也不要求 `data-*` DSL 标记。当前 PageContentDSL 与模板 ID 只是 Harness 自动生成的下游兼容读模型，不是新页面的创作入口。

Harness 负责把高价值决策所需证据提前装入 Prompt：Course Lead 得到 Skill 核心说明和有界资料事实，Page Creator 得到 CourseContext、PageTask、依赖摘要、事实边界、workspace，以及匹配出的一个主视觉参考和两个备选方向。`course-page-design` 作为常驻方法 Skill；`frontend-slides` 作为可渐进读取的资源 Skill，Harness 直接提供精确 recipePath 与紧凑 token，模型只有需要更深构图语法时才读取完整配方。配方只约束字体气质、色彩关系、形状语言和节奏，不是 DSL 或布局模板。

## Browser Harness 证据流

```text
Page Creator 修改 index.html
        ↓ render_page
Playwright Browser Pool
        ↓ 独立 BrowserContext
PNG + DOM + Console + 网络 + 互动结果
        ↓
回灌同一个 Page Creator / 提供给 Course Reviewer
```

Reviewer 默认获得最多 20 页的桌面截图概览和全课紧凑诊断，发现疑点后通过 `inspect_page_evidence` 加载该页全部视口，避免一次把整课所有 PNG 塞进上下文。

Page Creator 每轮只向模型提供唯一当前 HTML、精确 Browser issue 和最新三视口截图；旧 PNG、旧完整 HTML tool call 与旧工具结果不累积，完整证据继续保存在 Artifact、workspace 和工具账本。无变化 HTML 会被 workspace 拒绝。`edit_page_workspace` 自动完成 checkpoint 与 Playwright 渲染，Harness 在每次工具结束后继续推进唯一确定性的 read/render/inspect/submit/block 状态，不再为机械过渡请求 Pro 模型。当前 Agent Loop 最多允许三轮有证据的质量修订；模型只在创作、可选生图和多种修订方向之间做判断。

学习器与 Browser Harness 共用固定 16:9 舞台合同：作者页面以 1920×1080 创作，宿主同比缩放到三个 16:9 视口，任何根级或嵌套滚动都阻断。Page Creator 若无法在单屏保持正文可读和互动完整，应提交带 PageQuality 的 blocked；Engine 唤醒 Course Lead，在页数可增加时拆页，用户固定页数时重新分配各页职责。单页阻塞不会直接终止整课。装饰轨道、光晕等 overflow 几何只有在实际文字或交互盒被切掉时才算裁切。

contain-fit 只负责展示，不参与掩盖作者文档尺寸：原始宽高超过 1920×1080 的八像素测量容差仍阻断。`requiresInteraction` 只是一条最低教学承诺，不限定互动类型；Browser Harness 会真实操作原生控件并验证控件之外的状态或反馈变化，具体控件、反馈和构图仍由 Page Creator 自主设计。

## 恢复与迁移

任务暂停、恢复和取消仍依赖 CourseRun、WorkOrder、Artifact 与租约。新 Page WorkOrder 只获得 workspace、检索、生图、浏览器与提交工具；没有新工具权限的历史 WorkOrder 才能使用旧生成/修复工具恢复。迁移完成条件是新闭环在真实课程 A/B 盲测、事实正确、安全、互动有效和交付成功率上达标，之后删除旧一次性 Model Step 和 DSL/模板兼容路径。

Browser Harness 不可用时不终态化任务或工作单。Worker 释放租约并暂停领取，恢复后从原 checkpoint 继续；只有真实页面证据未达标才进入 Page Creator 的修改循环。

父 CourseRun 与子 WorkOrder 使用同一阶段到期边界：Engine 先续父租约再领取子任务，恢复扫描同时检查两层租约。另一个 Worker 遇到仍活跃的子租约时只退出并把 Task 恢复为 queued，不把调度竞争解释为 Agent 或课程失败。
