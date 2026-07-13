# Day 12：单页内容 DSL

## 今日完成内容

- 新增严格的 `PageContentDSLSchema`，覆盖标题、讲解、语义 blocks、七类 interaction、assetSlots 和弱 layoutHints。
- 使用可辨识联合类型表达 none、navigate、reveal、choice、sort、input 和 explore 互动。
- blockId、optionId、itemId、assetSlotId、pageId 和 templateId 均由确定性代码补齐，模型不创造技术 ID。
- 实现一步 `PageWriterAgent`，输入单个 PagePlan、对应 PageWorkerBrief 和 CourseIntent，输出单页 DSL。
- Page Writer 从真实 FunctionalTemplate Registry 读取槽位边界，并校验 PagePlan、brief、互动类型、素材需求和模板约束。
- 新增版本化 Page Writer System/User Prompt，明确禁止 HTML、CSS、JSX、组件树和私有推理。
- 为八个 FunctionalTemplate 各提供一份通过 Schema 的 DSL example。
- 新增 `POST /api/pages/write` 和 PageDSLViewer，可选择任一 PagePlan 单独生成并检查 DSL。
- Viewer 分别显示 blocks、interaction、assetSlots、layoutHints，并明确 HTML 将由 Day 13 的 HTML Engineer 生成。
- DSL 边界设计见 `docs/dsl-boundary.md`。

## 当天结束前复盘：面试题与详细答案

### 1. 为什么不直接让模型生成完整 HTML？

**参考答案：**

完整 HTML 把内容、教学设计、互动数据和视觉实现混在一个长字符串中。它适合最终渲染，却不适合作为多 Agent 的稳定中间协议：QA 很难定位具体知识块，Repair 往往需要重写整页，素材和答案也只能靠解析 HTML 反推；模型输出越长，截断、非法标签和安全风险越高。

本项目先生成 PageContentDSL。它保存可校验的内容和互动语义，HTML Engineer 再结合 FunctionalTemplate 与 StyleTemplate 生成最终页面。内容错误只修 DSL 中目标 block，视觉改版只重跑 HTML 阶段，两者互不污染。HTML 仍然是必要产物，只是不应成为所有上游 Agent 的唯一协作格式。

### 2. DSL 过强约束和完全自由生成分别有什么风险？

**参考答案：**

过强 DSL 会枚举组件名、DOM 层级、className、像素位置和每个视觉细节。结果虽然稳定，却与当前组件库强耦合，页面同质化，设计系统一改就需要迁移全部课程数据。

完全自由生成则允许模型任意创造字段或直接输出长文本。下游无法稳定渲染、缓存、验证、定位错误或做版本兼容，同一个概念在不同页面可能出现完全不同结构。

合理边界是“强语义、弱表现”：强约束 pageId、block 类型、互动答案、素材用途和阅读顺序；弱约束内容密度、视觉优先级和分组意图；把 DOM、CSS、组件和动效留给 HTML Engineer。

### 3. 哪些字段应该进入强 Schema，哪些只适合作为 layoutHints？

**参考答案：**

如果字段需要被两个以上节点共同理解，或错误会破坏内容正确性、交互行为、引用完整性和无障碍，就应进入强 Schema。例如 pageId、blockId、interaction.type、correctOptionId、asset role 和 readingOrder。

如果字段只影响视觉选择，存在多个同样正确的实现，就应是 hint。例如内容是稀疏还是紧凑、哪个概念优先突出、哪些 blocks 应形成一组。具体列数、间距、断点和动画曲线不应进入 DSL，因为它们只属于渲染实现。

### 4. 为什么 PageContentDSL 不应该表达 React 组件树？

**参考答案：**

React 组件树是当前前端实现，不是课程内容本身。把 `Card`、`Tabs`、`children` 或 props 写入持久化 DSL，会让数据依赖组件命名、版本和框架。组件重命名、改用 Web Components 或导出静态 HTML 都会迫使内容协议迁移。

语义 block 则保持技术无关。例如 `kind: concept` 可以由不同 HTML Engineer 实现为卡片、分屏或可展开内容。只要保留正文、顺序和互动语义，它们都是同一份 DSL 的合法视觉表现。

### 5. PageWriterAgent 为什么一次只处理一个页面？

**参考答案：**

单页调用让输入和输出保持小而明确，减少 token 截断，并使失败、重试、缓存和人工验收以 pageId 为单位。修改第三页不需要重新生成整门课程，多个无依赖页面也可以在后续编排中并行执行。

全课程一致性已经由 Planner 和三个专业 brief 负责；Page Writer 的职责是落实当前页。如果 Page Writer 再接管整门课程，它会与 Planner 重叠，并放大一次错误的影响范围。

### 6. QA 和 Repair Agent 如何利用稳定 ID 定位问题？

**参考答案：**

模型不能可靠创造或保持技术 ID，因此本项目由代码生成 pageId、blockId、optionId、itemId 和 assetSlotId。QA 可以返回类似 `page-03 / block-02 / content_accuracy` 的问题，Repair 只替换目标 block，然后重新运行 Schema 和相关页面 HTML。

稳定 ID 还支持前后版本 diff、缓存失效、埋点和人工评论。若只保存长 HTML，任何内容调整都可能改变 DOM 路径，使问题引用失效。

### 7. 如何证明同一个 DSL 可以生成不同视觉表现？

**参考答案：**

先检查 DSL 是否没有组件名、className、CSS 或像素坐标；再把同一 DSL、相同 FunctionalTemplate 分别交给两个 HTML Engineer Prompt或两个 StyleTemplate。两个输出可以使用不同 DOM、排版、装饰和动效，但必须保留相同标题、blocks、阅读顺序、互动答案、反馈和素材语义。

验证重点不是 HTML 字符串相同，而是语义不变量相同。可以对渲染结果做内容映射、交互行为测试和可访问性检查，同时允许视觉截图明显不同。Day 12 先建立这个协议，Day 13 再加入安全 HTML 预览。

### 8. DSL 版本升级时如何避免已有课程失效？

**参考答案：**

DSL 顶层保存显式 version。新增可选字段可以保持同一主版本；删除字段、改变语义或联合类型形状时应增加版本并编写确定性迁移函数。读路径先识别版本，迁移到当前内存形态，再交给新 Schema 校验。

不要让模型承担历史数据迁移，因为迁移必须可重复、可测试。生产系统还应保存生成时的 Prompt version、Schema version 和模板 version，使缓存、回放和错误定位具备完整上下文。

## 验收结论

- 八种 pageType 均存在合法 FunctionalTemplate DSL example。
- `choice` 使用题目数组表达多题测验，每道题独立保存选项、正确答案、反馈和尝试次数。
- DSL 不包含 HTML、CSS、JSX、className 或组件树字段。
- Page Writer 只生成一个页面并返回 `start → model_call → finish` 公开事件。
- PagePlan、PageWorkerBrief、FunctionalTemplate、互动类型和素材需求全部进行业务对齐校验。
- PageDSLViewer 能清晰区分 DSL 已约束内容和 Day 13 尚未生成的 HTML 实现。

### 真实模型 bad case 与回归验收

首次用“三道太阳系选择题”进行浏览器验收时，模型把多题内容压进单个 `choice` 对象，产生了超出上限的扁平 `options`，并把 `correctOptionIndex` 与反馈输出为数组。旧协议只能表达一道题，因此结构化校验正确地拒绝了结果。

修复后，模型草稿使用简单并行数组传输多题内容，确定性代码再按每题选项数量切分为 `questions`，补齐稳定的 questionId、optionId，并逐题绑定答案和反馈。最终真实模型验收结果为：

- Page Writer 状态为 `completed`，公开事件为 `start → model_call → finish`。
- 生成 3 个 question blocks 和 3 个 choice questions，每题 3 个选项。
- 生成 1 个与 PagePlan 对齐的 assetSlot，readingOrder 完整覆盖 3 个 blocks。
- 输出不含 HTML 标签；浏览器 Console 无 error 或 warning。
