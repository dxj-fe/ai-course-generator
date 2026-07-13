# Day 09：样式模板系统

## 今日完成内容

- 定义完整 `StyleTemplateSchema` 和六组 Design Token 子协议。
- 实现 `sci-fi`、`kids-playful`、`minimal`、`nature`、`blackboard`、`game-quest` 六套风格。
- 实现共享 Style Registry、按 ID 查询和候选搜索。
- 将 `professional` CourseIntent 兼容映射到 `minimal`。
- 实现 StyleTemplate 到 CSS Variables、CSS 文本和 Day 07 Theme 的转换。
- 将 Day 05 `searchStyleTemplateSkill` 迁移到共享 Registry。
- 把 Day 08 PagePlan mocks 的样式引用更新为真实存在的 `minimal`。
- 验证全部 8 × 6 = 48 种功能/样式组合。
- 扩展 `/templates`，使用同一份结构实时预览六套 Design Tokens。

## 关键设计决定

### 为什么 CSS Variables 由工具函数生成

模板保存结构化 Token，渲染层消费 CSS Variables。转换规则只有一份，因此变量命名、输出顺序和缺失字段处理不会散落在多个 Agent 或组件中。模板新增或修改时，HTML 结构不需要同步复制。

### 为什么 StyleTemplate 比 Theme 更完整

Day 07 Theme 是 Course 持久化和 Agent 交接需要的精简全局上下文。StyleTemplate 还需要服务 Gallery、图片 Agent、动效和 CSS 转换，因此包含更完整的 surface、decoration、motion 和 assetGuidance。`styleTemplateToTheme()` 负责集中收敛二者。

### 为什么 professional 映射到 minimal

`professional` 描述使用场景，`minimal` 描述视觉方向。当前六套核心模板中，极简风格最适合作为专业课程的默认视觉实现。使用别名比复制一套几乎相同的 Token 更容易维护。

## 面试题与详细答案

### 1. 如何保证 AI 生成的多页 HTML 第一眼看起来是统一的？

统一性的基础不是让每个页面 Prompt 重复一段视觉描述，而是让整门课程共享稳定的 Theme 和 Design Tokens。所有页面从同一个 `styleTemplateId` 获得背景、表面、文字、主色、字体、间距、圆角、阴影、装饰和动效变量。

工程上需要四层约束：

1. Course 层只选择一次 StyleTemplate，并把 Theme 传给所有页面。
2. HTML Agent 只能消费已有 CSS Variables，不能为单页重新发明全局色彩和字体。
3. FunctionalTemplate 只改变教学结构，不覆盖样式变量。
4. Quality Agent 或截图回归检查跨页字体、颜色、间距和组件状态是否漂移。

页面不必使用相同布局。封面、时间线和测验可以有完全不同的结构，只要它们使用同一语义 Token，用户仍能快速感知它们属于同一门课程。

### 2. Design Tokens 在 AI 生成页面中的作用是什么？

Design Tokens 把模糊的视觉语言变成机器可读取、可校验和可复用的协议。Prompt 中的“科幻感”无法直接保证六个页面使用同一种蓝色和圆角，而 `--course-color-primary`、`--course-radius-card` 和 `--course-font-heading` 可以。

它们主要解决：

- 一致性：所有页面读取同一语义变量。
- 可控性：模型只能在指定视觉边界内组合页面。
- 可替换性：更换 StyleTemplate 即可整体换肤，无需重写 HTML。
- 可验证性：Schema、CSS 变量快照和截图可以发现缺失或漂移。
- 多 Agent 协作：Planner、图片 Agent、HTML Agent 和 Quality Agent 使用相同视觉语义。

Token 不应该细化到每个组件的每个像素，否则会重新把 UI 锁死。核心协议优先使用语义 Token，组件级 Token 只在多个页面确实需要共享时再增加。

## 当天结束前复盘：面试题与详细答案

### 3. Theme 与 StyleTemplate 为什么需要适配器，而不是直接合并？

**参考答案：**

两者服务的生命周期和消费者不同。`Theme` 是 Course 聚合中的精简、可持久化协议，主要负责在 Planner、HTML Agent 和前端之间传递稳定的全局视觉上下文；`StyleTemplate` 是样式模板系统的完整源数据，还要服务模板搜索、Gallery、CSS 生成、图片 Agent 和动效策略，因此包含 decoration、motion、surface、assetGuidance、bestFor 等更丰富的信息。

如果直接合并，会产生三个问题：

1. Course 数据被迫保存大量仅在模板选择或生成阶段使用的信息，增加传输和版本迁移成本。
2. Theme 的消费者会依赖 StyleTemplate 的内部结构，任何模板字段调整都可能破坏 Course 协议。
3. 不同 Agent 可能各自挑选字段并重新解释映射规则，造成同一模板生成不同 Theme。

本项目使用 `styleTemplateToTheme()` 作为 Anti-Corruption Layer：它集中决定哪些颜色、字体、密度和圆角进入 Theme，并通过 `ThemeSchema.parse()` 再做一次边界校验。这样 StyleTemplate 可以继续丰富，而 Course 侧仍保持稳定。

**面试追问：什么时候可以不使用适配器？**

只有当两个模型的语义、字段集合、生命周期和版本策略完全一致，并且长期由同一模块拥有时，直接复用才更简单。只要它们面向不同消费者或存在信息裁剪，显式适配通常更安全。

### 4. 为什么六套样式模板必须输出完全相同的 CSS Variable key？

**参考答案：**

CSS Variable key 是渲染层依赖的“视觉接口契约”。HTML 和 React 组件应该只认识 `--course-color-primary`、`--course-radius-card` 等语义变量，而不需要判断当前是科幻、儿童还是黑板风格。六套模板改变的是 value，不是 contract。

保持 key 完全一致可以获得：

- 无条件换肤：切换模板只替换变量值，不修改 DOM 或组件分支。
- 防止缺省漂移：不会因为某套模板缺少变量而退回浏览器默认值或产生 `undefined`。
- 降低 Agent 复杂度：HTML Agent 不需要记住六套专属命名。
- 易于回归：测试可以固定第一套模板的 key 顺序，再逐一比较其余模板。
- 支持缓存和静态生成：相同 HTML 可以与任意合法样式模板组合。

本项目由唯一的 `styleTemplateToCssVariables()` 负责映射，并在测试中检查所有模板的 key 集合、顺序和非空值。若未来增加新 Token，应先扩展 Schema 和统一转换器，再同时补齐六套模板，而不是只给某个风格添加私有变量。

### 5. 如何判断一个 Token 应属于 semantic 层还是 component 层？

**参考答案：**

判断标准不是“这个值在哪里使用”，而是“这个值表达什么语义”。

- Semantic Token 描述跨页面、跨组件的视觉角色，例如 `color.primary`、`color.surface`、`spacing.sectionGap`。它回答“这个值在视觉系统中承担什么职责”。
- Component Token 描述稳定组件内部的具体角色，例如 `quiz.option.correct.background`、`timeline.node.size`。它回答“某个可复用组件的某个部位应该如何表现”。

可以依次问四个问题：

1. 这个值是否会被多个不同组件使用？如果是，优先 semantic。
2. 它是否只在一个稳定、重复出现的组件结构中有意义？如果是，可以是 component。
3. 组件 Token 能否引用 semantic Token？应优先引用，例如正确答案背景引用 `color.success`，而不是复制一个绿色值。
4. 新 Token 是否只是为了修复一个页面的局部像素差异？如果是，通常应先使用组件样式，不急于升级为全局协议。

在本项目中，颜色、字体、全局间距、表面和动效基线属于 semantic 层；当 quiz、timeline 等 FunctionalTemplate 出现稳定的跨课程组件实现后，再增加少量 component tokens。这样既避免样式自由失控，也不会让 DSL 细化成完整 UI 像素说明书。

### 6. `prefers-reduced-motion` 应如何影响 motion tokens？

**参考答案：**

它不只是把动画“变快”，而是要降低非必要运动带来的眩晕、注意力干扰和操作延迟。正确做法是让 StyleTemplate 同时提供正常动效 Token 和降级 Token，再由 CSS 媒体查询统一覆盖。

```css
@media (prefers-reduced-motion: reduce) {
  .course-root {
    --course-motion-duration-fast: var(--course-motion-reduced-duration);
    --course-motion-duration-normal: var(--course-motion-reduced-duration);
  }
}
```

实现时还需要区分动效目的：

- 装饰性循环、视差、闪烁和大幅缩放应直接关闭。
- 状态反馈可以保留瞬时的颜色、透明度变化，避免用户不知道操作是否生效。
- 不能通过隐藏内容来“减少动效”，否则会破坏信息和可操作性。
- Canvas 或 JavaScript 动画也要通过 `matchMedia("(prefers-reduced-motion: reduce)")` 读取同一偏好，而不能只处理 CSS。

本项目的 StyleTemplate 已包含 `durationFast`、`durationNormal`、`easing`、`intensity` 和 `reducedMotionDuration`。这些 Token 建立了降级协议；后续 HTML 渲染器还需要输出媒体查询，质量验收则应分别在 normal/reduce 两种模式下测试。

### 7. 为什么图片素材指导也属于 StyleTemplate？

**参考答案：**

课程的视觉一致性不只由 CSS 决定。即使颜色和字体完全一致，如果一页使用写实摄影、下一页使用低幼卡通、另一页又使用 3D 游戏渲染，用户仍会认为课程是拼接出来的。因此图片的媒介风格、构图、背景处理和负向约束属于同一套视觉语言。

本项目的 `assetGuidance` 包含：

- `visualStyle`：摄影、科学插画、粉笔板书等媒介方向。
- `composition`：主体位置、留白和裁切原则。
- `background`：背景复杂度以及与页面表面的关系。
- `avoid`：需要避免的水印、杂乱文字、错误风格等特征。

图片 Agent 可以把这些字段转成生成或检索条件，Quality Agent 也能据此判断素材是否偏离整门课程的视觉方向。不过 StyleTemplate 只能规定“怎么画”，不能保存“画什么”。课程主题、具体人物和知识内容仍应来自 Course/PagePlan，避免视觉协议被业务内容污染。

### 8. 8 × 6 的 48 种组合测试能证明什么，又不能证明什么？

**参考答案：**

它是一项协议兼容性测试，而不是完整的视觉质量证明。

它能够证明：

1. 八个功能模板的 PagePlan 都能引用六个合法 `styleTemplateId`。
2. 功能结构和视觉样式没有被错误地绑定成一对一关系。
3. 组合后的对象仍能通过 `PagePlanSchema`，不存在枚举、必填字段或引用格式冲突。
4. 新增功能或样式模板时，测试数量和失败位置可以暴露协议回归。

它不能证明：

- 48 个页面在真实浏览器中都没有溢出、遮挡或响应式问题。
- 每种风格在每种功能结构上都具有良好可读性和审美质量。
- 色彩对比、键盘操作、动效降级等无障碍要求全部达标。
- AI 生成的具体文案、图片和 HTML 一定正确。
- 多页课程在截图层面完全一致。

因此合理的测试金字塔应是：Schema 组合测试覆盖全部 48 种协议组合；组件测试覆盖 Token 是否正确消费；从每类高风险组合中选代表样本做浏览器和截图回归；最后用 QualityReport 检查可访问性、内容与跨页一致性。全量组合测试保证“可以组合”，视觉验收才判断“组合得好不好”。
