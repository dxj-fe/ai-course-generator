# 生课链路与内容丰富度分析

## 目标

基于当前代码梳理从用户建课请求到课程发布的实际链路，定位导致课程内容、交互、素材与跨页叙事不够丰富的约束、缺陷和流程缺口，并形成可执行的优化优先级。

## 分析边界

- 只分析当前 Keya 产品入口与唯一课程生成链路。
- 覆盖请求解析、课程架构、页面生成、素材生成、HTML、页面 QA、整课审查和发布。
- 结论必须能追溯到具体代码或 Prompt，不将主观观感当作代码事实。
- 本任务先输出诊断与优化建议，不直接修改生产逻辑。

## TODO

- [x] 核对入口、运行器和编排状态机。
- [x] 核对 Architect、Page Builder、Reviewer 的输入与输出边界。
- [x] 核对内容、素材、交互、HTML 与 QA 的实际生成步骤。
- [x] 归纳影响丰富度的确定问题、结构性限制和待验证假设。
- [x] 生成竖向节点图和分优先级优化清单。
- [x] 完成证据复核并归档任务文档。

## 验证方法

- 以生产代码调用关系为主，架构文档为辅。
- 对关键结论记录文件、函数或 Prompt 位置。
- 使用现有测试与样例确认 Schema、默认值和 Gate 的实际约束。

## 当前实际链路

1. `/chat` 将用户消息派生为 `CourseCreationBrief`；只有目标缺失时继续追问。
2. `/api/courses/tasks` 创建任务，后台 `CourseRunEngine` 启动状态机。
3. Architect 读取 brief、最多 3 个用户 Reference Pack 与模板目录，生成 `CourseArchitecture`。
4. Architecture Gate 做 Schema、模板、引用、目标覆盖、互动与视觉设计检查；Director 审批架构。
5. Engine 按 `buildDependsOnPageIds` 解锁页面 WorkOrder，默认最多 3 页并行。
6. 每页执行：读取上下文 → Page Writer 生成 DSL → 有素材槽时生成素材 → HTML Engineer → 三视口截图与 Page QA → 最多一次定向修订 → Page Gate 原子提交。
7. 所有页面通过后，Reviewer 根据页面摘要和压缩质量报告做整课审查，Director 决定发布、局部返工或重新规划。
8. Final Gate 生成 Manifest，状态与产物经任务事件投影到 Keya UI。

## 已确认的主要问题

### P0：专用教学、叙事和视觉步骤存在，但生产链路没有接入

- `pedagogy-model-step.ts`、`story-model-step.ts`、`visual-brief-model-step.ts` 都提供可运行入口。
- 生产调用只使用 `projectCourseArchitecture()`；全库排除测试后没有上述三个运行入口的调用。
- 当前投影固定 `misconceptions: []`、`narrativeMode: "none"`、`characters: []`，教学深度、互动节奏和跨页过渡也是通用文案。
- 影响：Architect 虽然产出页面职责，但不会再经过独立的教学策略、误区、案例叙事和跨页视觉编排强化；Page Writer 实际收到的是被简化的通用 brief。

### P0：模板容量、领域 DSL 与 Page Writer 容量互相冲突

- 功能模板允许 timeline 3–8 个内容块、quiz 1–8 个题目/互动项。
- 领域 `ChoiceInteractionSchema` 允许 1–8 题。
- Page Writer 草稿与 Prompt 固定只生成 1 题；语义容量又把 choice 限为 1 个 block、4 个选项，把 reveal/explore 限为 1 个 block、4 个互动项。
- `validateTemplateSlots()` 已实现，但生产 `validatePageWriterOutput()` 没有调用；其注释宣称校验模板槽位，与实现不一致。
- 影响：模板对“丰富页面”的承载能力在写作阶段被主动压平，并且缺少统一合同保证计划、写作与渲染容量一致。

### P0：移动端滚动合同矛盾，合法页面可能被模型 QA 重新判死

- HTML Engineer 明确允许 366×500 自然纵向滚动。
- 确定性浏览器检查也把窄屏纵向溢出降为 warning。
- Page QA Prompt 仍把任何视口的纵向溢出和根页面滚动定义为 error。
- 模型 issue 过滤没有把通用 `LAYOUT_OVERFLOW` 与浏览器的窄屏 warning 对齐。
- 影响：相同证据可能同时得到“允许自然滚动”和“必须返工”的相反结论，导致修订震荡或整课失败。

### P0：页面级失败无法升级为架构拆页，直接终止整课

- 当前页面首次 QA 后只允许一次定向修订，仍未通过就阻塞 WorkOrder。
- Engine 发现当前分支任一 blocked/failed WorkOrder 后直接 `failCourse()`。
- Reviewer 的 `replan` 只有在全部页面均 ready 后才会运行，因此页面容量或版式无法通过 HTML 修复时，没有回到 Architect 拆页的正常路径。
- 影响：页面过载问题被误当成 HTML 局部问题；一旦局部修复失败，后续页面和整课审查都不会执行。

### P1：上游知识输入过薄，没有主动研究和覆盖扩展

- `CourseCreationBrief` 只有主题、受众、目标、页数、学习模式、语言；澄清只追问目标。
- 检索只覆盖用户上传的最多 3 个 Reference Pack，没有主动研究、案例检索或事实扩展步骤。
- Architect 在无资料时可直接使用通用知识，并被要求使用“满足目标所需的最少页面”。
- 影响：事实、误区、例子、反例、案例和练习证据没有明确覆盖预算，内容丰富度从输入端就被封顶。

### P1：素材策略默认关闭，素材能力多数课程不会触发

- Architect 要求 `assetNeeds` 默认空数组，并禁止已有主要互动的页面再加 inline 插图，除非插图对验收不可替代。
- Page Builder 只有在 DSL 存在素材槽时才调用素材生成，否则直接跳过。
- 影响：图片生成链路本身不是瓶颈，瓶颈是 Architect 的素材准入规则过窄；大量课程只能依赖 HTML/CSS/SVG 即兴表达。

### P1：整课 Reviewer 看不到真实页面视觉证据

- Reviewer 输入是压缩后的 PageTask、PageSummary、QualityReport 与确定性发现，没有 HTML、截图或跨页缩略图。
- 页面视觉好坏主要依赖单页 QA 模型主动输出四个阻塞 code；分数低或视觉面积指标本身不触发返工。
- 影响：单页 QA 漏判后，整课 Reviewer 无法发现相邻页构图重复、视觉母题断裂、空泛页面或互动形式单一。

### P2：通用 Architecture Gate 混入单一学科的硬编码规则

- `architecture.ts` 中包含大段蓝天、散射、太阳高度与光程相关正则和错误文案。
- 影响：通用 Gate 边界被特定课程污染，维护成本高，并可能让后续教学领域通过继续堆正则扩展，无法形成可复用的学科事实校验机制。

## 本地历史运行证据

本地最新一次“玉米的成长历程和特性”任务在 2026-08-05 失败。该运行生成 5 页，CoursePack 只有 2 条事实、2 个术语、1 个例子，所有页面素材需求为空；页面顺序为 cover → timeline → knowledge card → 单题 quiz → summary。两个页面在多轮 HTML/QA 修订后仍因溢出阻塞，后两页停留在依赖等待，整课直接失败。

该运行早于当前“每页必须提供 visualDesign”和“移动端溢出降为 warning”等改动，因此只能用于证明历史故障形态，不能替代当前代码结论。当前代码已经部分缓解视觉计划缺失和窄屏确定性误判，但模型 QA 合同与失败升级路径仍未统一。

## 建议的目标链路

1. Intake 增加先验、深度、时长、案例偏好、视觉/互动偏好；生成可计算的丰富度目标。
2. 在 Architect 前增加 Research/Coverage Pack：事实、术语、误区、例子、反例、案例、练习证据、视觉对象均有最低覆盖与来源。
3. Architect 先规划知识和页面职责，再依次接入 Pedagogy、Story、Visual 专用步骤；Director 用覆盖矩阵和跨页缩略图审批。
4. Page Writer 从功能模板和视口联合派生容量；统一模板槽位、DSL 和运行时，不再用一套固定低预算压所有页面。
5. QA 区分桌面单屏与移动端自然滚动；连续一次布局修订失败后返回 `PAGE_CAPACITY_REPLAN_REQUIRED`，由 Architect 拆页或调整职责。
6. Reviewer 增加跨页截图 storyboard、互动类型分布、例子/练习/误区覆盖和视觉母题连续性证据。

## 优先实施顺序

1. 统一移动端滚动合同，并给页面失败增加架构级拆页/重规划出口。
2. 接入现有 Pedagogy/Story/Visual 步骤，移除投影中的通用硬编码占位。
3. 统一模板、DSL、Page Writer 和运行时容量合同，恢复模板已经声明的多项承载能力。
4. 增加 Research/Coverage Pack 和更完整的创建简报。
5. 为整课 Reviewer 增加跨页视觉与丰富度证据，再收敛通用 Gate 中的学科特例。
