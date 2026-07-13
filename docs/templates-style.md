# Style Template Registry

样式模板描述课程“看起来像什么”。它把视觉方向表达为可校验的 Design Tokens，再通过统一适配器转换为 Course Theme 和 CSS Variables。功能模板仍只描述教学任务，因此任意功能模板都可以与任意样式模板组合。

## 协议边界

`StyleTemplateSchema` 包含：

| 字段 | 作用 |
| --- | --- |
| `id` / `visualStyle` | 提供稳定引用，并与 CourseIntent 视觉意图关联。 |
| `goal` | 用自然语言总结整套风格的视觉方向。 |
| `colorTokens` | 定义背景、表面、文字、品牌色、边框和反馈状态的语义颜色。 |
| `typography` | 定义字体、字重、基础字号和正文行高。 |
| `spacing` | 定义间距基线、区块距离、卡片距离和内容最大宽度。 |
| `surface` | 定义卡片与控件的圆角、边框和阴影。 |
| `decoration` | 定义背景纹理、形状语言和装饰强度。 |
| `motion` | 定义标准时长、缓动、动效强度和 reduced-motion 降级。 |
| `layoutDensity` | 使用 `compact / comfortable / spacious` 控制整体信息密度。 |
| `assetGuidance` | 给图片 Agent 提供风格、构图、背景和负向约束。 |
| `bestFor` / `avoidFor` | 帮助 Agent 判断适用与不适用场景。 |
| `keywords` | 为确定性候选搜索提供视觉关键词。 |

样式模板不包含课程标题、知识内容、学习目标、pageType、HTML 或功能模板槽位。

## 六套核心风格

| ID | 视觉方向 | 典型场景 |
| --- | --- | --- |
| `sci-fi` | 深色空间、冷色发光、精密网格 | 太空、科技、工程探索 |
| `kids-playful` | 明亮色彩、圆润形状、友好反馈 | 儿童启蒙、轻量互动 |
| `minimal` | 克制配色、清晰层级、充足留白 | 企业、专业与高密度知识 |
| `nature` | 植物色系、标本组织、有机曲线 | 生物、生态和环境教育 |
| `blackboard` | 深色板面、粉笔高亮、手写注释 | 数学、公式与课堂推导 |
| `game-quest` | 任务面板、进度反馈、成就语言 | 闯关练习和任务型学习 |

`CourseIntent.visualStyle` 中已有的 `professional` 作为兼容值映射到 `minimal`，不创建重复的第七套模板。

## CSS Variables

`styleTemplateToCssVariables()` 将六套模板转换为相同的 `--course-*` 变量集合。部分变量如下：

```css
--course-color-background
--course-color-surface
--course-color-text
--course-color-primary
--course-color-accent
--course-font-heading
--course-font-body
--course-spacing-section
--course-radius-card
--course-shadow-card
--course-decoration-background
--course-motion-duration-normal
--course-motion-reduced-duration
--course-layout-density
```

变量映射只实现一次，所有样式模板共享同一个转换函数。这样新增风格时只需要提供 Token，不需要复制 HTML 或组件代码。

`styleTemplateToCssText()` 用稳定顺序生成 CSS 文本，适合 HTML 生成器、预览 iframe 或快照测试。`styleTemplateToTheme()` 把完整模板映射为 Day 07 `ThemeSchema`，避免 Agent 自行猜测两个协议如何对应。

## 搜索策略

`searchStyleTemplates()` 接收 `query`、`visualStyle`、`audience` 和 `limit`：

1. `visualStyle` 精确命中获得最高分。
2. `professional` 先归一化为 `minimal`。
3. 模板名称、核心视觉方向和关键词用于文本计分。
4. 返回最多三个候选和人类可读理由。
5. 没有命中时返回通用候选，由 Agent 结合课程上下文继续判断。

Day 05 的 `searchStyleTemplateSkill` 已迁移到共享 Registry，不再维护内联样式数组。

## 自由组合

Day 08 有 8 个功能模板，Day 09 有 6 个样式模板。测试会把每个 PagePlan mock 分别替换为六个 `styleTemplateId`，验证全部 48 种组合均通过 `PagePlanSchema`。

组合成功的关键是职责正交：

- FunctionalTemplate 决定教学目标、槽位和内容数量。
- StyleTemplate 决定视觉 Token、素材方向和动效基线。
- PagePlan 只用两个稳定 ID 关联它们。
- 渲染层消费两套协议，不允许一方覆盖另一方的字段。

## 如何保证多页视觉统一

多页统一不依赖 Prompt 中反复描述“保持一致”，而是让所有页面共享同一个 `styleTemplateId` 和 Theme。标题字体、正文节奏、背景、表面、圆角、阴影、装饰和动效都从相同 CSS Variables 读取。页面可以选择不同功能模板，但不会重新发明视觉规则。

一致不等于完全相同。页面布局和交互仍可以根据功能模板变化，只要它们继续消费同一组语义 Token。
