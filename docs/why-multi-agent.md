# 为什么课芽采用多 Agent

课芽采用多 Agent 不是为了堆叠术语，而是因为“生成一门可学习的多章节 HTML 课程”同时包含全局规划、专业内容、页面实现、工具调用和独立质量判断。每类工作需要不同输入、输出和失败边界。

## 1. 单一超级 Agent 的实际问题

| 问题 | 一个超级 Prompt 的表现 | 当前设计 |
| --- | --- | --- |
| 职责冲突 | 同时规划课程、写内容、做视觉、写 HTML、评价自己 | 每个 Specialist 只产出一种 Schema |
| 上下文膨胀 | 全课需求、全部模板、全部页面和素材同时进入上下文 | 只传当前职责需要的最小验证产物 |
| 输出截断 | 多页 HTML 和解释混在一个长响应中 | 整课规划一次完成，页面独立生成 |
| 错误归因 | 只能知道“课程生成失败” | 错误定位到 Agent、node、page、stage 和 causeCode |
| 失败恢复 | 任一页面失败就可能重跑整门课 | checkpoint 保留全局和已完成页面 |
| 自我评价偏差 | 同一个模型既生成又宣布质量合格 | QA 只读报告，Repair 不能自我判定通过 |
| 前端消费 | 输出格式漂移，UI 需要猜字段 | 共享 Zod Schema 是唯一数据合同 |

## 2. 当前职责分解

### 全局课程层

- **Intent**：把课程简报转换为目标、受众、难度、语言和完整章节数。
- **Course Planner**：决定学习顺序、页面职责、依赖、互动和模板。
- **Pedagogy**：确定教学策略、认知递进、练习和反馈方式。
- **Story**：提供统一叙事、学习者角色和任务线索。
- **Visual Director**：把 StyleTemplate 转换为整课视觉指导和逐页 brief。

### 页面交付层

- **Page Writer**：根据当前 PagePlan 和授权资料生成 `PageContentDSL`。
- **Image Prompt**：把 DSL 的素材槽转换为无文字、有限用途的素材请求。
- **HTML Engineer**：实现 DSL、模板、视觉指导和批准素材，不重新规划内容。
- **Page QA**：从内容、教学、排版、风格、HTML 和素材六个维度出报告。
- **Repair**：只处理服务器指定的 issue 和目标范围，候选必须 re-QA。

### 控制和工具层

- **Supervisor**：根据已校验状态和预算选择下一合法节点。
- **Page Worker**：隔离一页的 Writer、Assets、HTML、QA 和 Repair 生命周期。
- **Skill**：执行图片生成、资料解析、模板检索等有限能力。
- **Validator**：用 Schema、HTML 合同和确定性规则守住边界。

Supervisor 和 Page Worker 不算 Specialist；图片 Provider 也不是 Agent。

## 3. 为什么 Supervisor 是规则型的

当前 Graph 中通常只有一个合法的下一步。再调用一次模型决定显而易见的路由会增加成本和随机性，所以规则优先：

1. 后端根据 `CourseGenerationState` 计算合法动作。
2. Supervisor 生成或记录结构化决策。
3. 条件边只读取通过 `SupervisorDecisionSchema` 的最后决策。
4. 节点运行前仍检查前置输入、目标页面、attempt 和终止条件。

模型不能编造节点、提高预算、绕过依赖、改变页面数量或扩大 Repair scope。

## 4. 为什么模板系统仍然必要

多 Agent 解决职责和失败边界，模板解决结构与视觉稳定性。两者不能互相替代。

### 功能模板

功能模板描述页面的教学目的和结构槽位，例如：

- 封面如何建立目标；
- 知识卡如何组织概念与例子；
- 对比页如何呈现维度；
- 选择题如何提供题目、选项、反馈和完成条件。

Planner 选择模板，Page Writer 填充内容，HTML Engineer 不得删除 DSL 要求的结构。

### 样式模板

样式模板提供颜色、排版、间距、表面、装饰、动效、密度和素材指导。Visual Director 引用真实 Template Registry，而不是复制一套临时颜色。

因此，同一个“选择题”功能模板可以与科幻、极简、自然等样式组合，而不把教学结构和视觉主题耦合。

## 5. 为什么图片作为素材，而不是页面

生成图片适合承担：

- 背景和氛围；
- 角色或贴纸；
- 图标和装饰；
- 无文字纹理。

标题、正文、按钮、题目、选项和反馈必须保留为 HTML，因为它们需要：

- 响应式布局；
- 键盘、焦点和屏幕阅读器语义；
- 文本选择、翻译和朗读；
- 真实互动状态；
- 在图片失败时继续交付。

Image Prompt 只生成素材请求，GenerateImage Skill 负责 Provider、缓存、存储和 fallback。HTML Engineer 只能使用当前页面批准的内部 URI。

## 6. 为什么使用混合 DSL

完全自由 HTML 难以约束语义和互动；完全 React 组件树又限制视觉表达。`PageContentDSL` 保留稳定内容、互动、素材槽、布局提示和完成规则，而 HTML Engineer 可以在安全合同内自由实现 CSS 和视觉层级。

这个边界让：

- Planner 和 Page Writer 不关心具体 DOM；
- QA 能把内容错误与 HTML/布局错误分开；
- Repair 能只改 DSL block 或唯一 HTML 位置；
- 前端只预览最终 HTML，不复制课程业务规则。

## 7. 多 Agent 的代价

当前架构也有明确成本：

- 模型调用更多，延迟和费用更高；
- handoff、Schema 和版本需要维护；
- checkpoint、取消、重试和并发更复杂；
- 长模型调用期间只能显示真实阶段状态，不能伪造细粒度进度；
- 单进程任务执行不等于生产级队列。

项目通过最小上下文、分级模型路由、结构化缓存、有限重试、页面隔离和确定性规则控制这些代价。

## 8. 什么场景不该使用 Agent

以下能力直接用确定性代码更合适：

- Zod 校验和类型转换；
- CSS Token 转换；
- 缓存键和文件查找；
- HTML 安全检查；
- 课程历史查询和 ZIP 组装；
- 只有一个合法动作的路由；
- 固定输入输出的页面运行时。

判断标准不是“是否用了 AI”，而是任务是否需要模型在开放语义空间中生成专业产物。

## 9. 结论

课芽的核心取舍是：让模型负责开放的内容与设计问题，让 Schema、Workflow、Skill、Validator 和存储负责可验证的工程边界。多 Agent 的价值不在 Agent 数量，而在每个失败都能定位、每个产物都能验证、每个页面都能恢复。

继续阅读：

- [架构入口](architecture/README.md)
- [多 Agent 深度设计](multi-agent-design.md)
- [从提示词到最终 HTML](architecture/prompt-to-html-current-flow.md)
- [项目讲解](interview-story.md)
