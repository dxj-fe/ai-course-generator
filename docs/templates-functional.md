# Functional Template Registry

功能模板描述“页面要承担什么教学任务”，并把任务拆成稳定内容槽位。它位于 `PagePlan` 与内容生成之间：Planner 先给出页面目标，搜索 Skill 返回候选模板，Agent 选择模板后，内容 Agent 再填充槽位。

功能模板不包含颜色、字体、阴影、组件树或 HTML。视觉风格由 Theme 和后续样式模板负责，具体界面由渲染层实现。

## 数据协议

`FunctionalTemplateSchema` 的核心字段：

| 字段 | 作用 |
| --- | --- |
| `id` | 跨 PagePlan、Skill、Gallery 和缓存使用的稳定标识。 |
| `name` | 面向产品和开发者的可读名称。 |
| `pageType` | 与 Day 07 `PageTypeSchema` 对齐的教学页面类型。 |
| `goal` | 说明模板要完成的教学任务。 |
| `slots` | 定义内容 Agent 可以填充的结构位置和数量范围。 |
| `constraints` | 防止模板偏离其核心教学任务。 |
| `bestFor` | 帮助 Agent 判断适用场景。 |
| `avoidFor` | 明确不应使用模板的场景。 |
| `keywords` | 为确定性候选搜索提供匹配词。 |

每个 Slot 包含 `name`、`goal`、`required`、`minItems` 和 `maxItems`。当前支持 `title`、`narration`、`blocks`、`interaction`、`assetSlots` 五种语义槽位。

## 八个功能模板

| ID | pageType | 教学任务 |
| --- | --- | --- |
| `course-cover` | `cover` | 建立课程主题、学习期待和开始入口。 |
| `story-intro` | `story_intro` | 用角色、冲突或真实情境引出学习问题。 |
| `knowledge-card-grid` | `knowledge_card` | 把同层级知识点拆成可独立浏览的卡片。 |
| `comparison-board` | `comparison` | 用统一维度比较对象并解释异同。 |
| `learning-timeline` | `timeline` | 按时间或阶段说明事件与变化。 |
| `interactive-quiz` | `quiz` | 通过作答和即时反馈检查理解。 |
| `achievement-task` | `achievement` | 把学习目标转化为可完成的任务或成果。 |
| `recap-summary` | `summary` | 回扣目标、提炼知识并提示下一步。 |

手册 Day 08 使用“任务卡”名称，而 Day 07 的稳定枚举是 `achievement`。Registry 将任务/成就模板映射到 `achievement`，避免为相同语义创建第二个 pageType。

## Registry 不变量

Registry 在模块加载时执行以下校验：

- 模板数量固定为 8。
- 模板 ID 唯一。
- Day 07 的每种 pageType 都有一个模板。
- 每个模板通过 `FunctionalTemplateSchema`。
- 每个模板至少包含 `title` 槽位，且槽位名称不重复。

每个模板还有一个通过 `PagePlanSchema` 的 mock。Gallery 和测试读取同一份 mock，避免文档示例与真实协议漂移。

## 候选搜索

`searchFunctionalTemplates` 合并页面目标和受众文本，再按模板名称、pageType 和教学关键词计算确定性分数。返回值包含模板、分数和人类可读的匹配理由。

搜索遵循以下规则：

1. 最多返回三个候选。
2. 有关键词命中时只返回正分候选。
3. 没有关键词命中时返回通用候选，供 Agent 继续判断。
4. 搜索只缩小范围，不代替 Agent 基于上下文做最终选择。

Day 05 的 `searchFunctionalTemplateSkill` 已改为调用共享 Registry，不再维护第二份功能模板数组。样式模板仍保留原实现，Day 09 再迁移。

## 功能模板与组件模板

功能模板描述教学语义，例如“比较两个对象”或“通过选择题检查理解”。组件模板描述实现方式，例如 React 组件属性、DOM 结构和交互状态。同一个 `comparison` 功能模板可以由表格、卡片、拖拽或移动端分页组件实现；功能协议不应因组件替换而变化。

## 为什么先选模板再生成内容

一句话需求通常只包含主题和模糊目标。如果模型直接生成页面，它需要同时决定教学任务、内容结构、互动方式和视觉表现，输出空间过大且难以验证。先选择功能模板可以把问题拆成两步：先确定页面承担的教学职责，再在明确槽位中生成内容。这样更容易校验、重试、比较候选，也能让页面之间形成稳定学习节奏。
