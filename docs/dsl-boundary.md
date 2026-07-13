# PageContentDSL 边界

## 目标

`PageContentDSL` 是 Page Writer、HTML Engineer、QA、Repair 和前端检查器共同理解的单页内容协议。它解决“页面讲什么、如何互动、需要什么素材、信息按什么顺序阅读”，但不决定“页面最终长什么样”。

完整链路：

```text
PagePlan + PageWorkerBrief + FunctionalTemplate
                       ↓
                PageWriterAgent
                       ↓
                PageContentDSL
                       ↓
       StyleTemplate + HTML Engineer
                       ↓
                 HTML/CSS 输出
```

## 强约束与自由实现

| PageContentDSL 强约束 | HTML Engineer 自由实现 |
| --- | --- |
| pageId、DSL version、functionalTemplateId | DOM 层级和标签选择 |
| 标题、讲解文本和有序语义 blocks | React 组件拆分方式 |
| blockId、block kind、正文和要点 | 卡片、网格、分页或滚动表现 |
| interaction 类型、数据、答案与反馈 | 控件外观、状态动画和微交互 |
| assetSlots 的类型、角色、用途和 alt 指导 | 图片尺寸、裁切和响应式布局 |
| 内容密度、视觉优先级、分组与阅读顺序 | CSS、Tailwind class、间距和断点 |

DSL 中明确禁止 HTML、CSS、JSX、className、组件树和像素坐标。`layoutHints` 是弱提示：`contentDensity`、`visualPriority`、`groupingStrategy` 和 `readingOrder` 可以被不同 HTML Engineer 用不同视觉方案实现。

## 为什么不是固定组件树

如果 DSL 包含 `component: Card`、`className`、`children` 或精确网格列数，协议会与当前 React 组件库绑定。设计系统重构将迫使课程数据整体迁移，模型输出也会趋向同质化。

本项目使用语义 block：`concept`、`fact`、`example`、`instruction`、`question` 和 `recap`。同一个 `concept` block 可以被实现为卡片、分屏、可展开面板或连续文章，只要内容、顺序和可访问性不变。

## 互动协议

互动使用可辨识联合类型：

- `none`：没有主动互动。
- `navigate`：表达前进、返回或结束课程。
- `reveal`：逐项揭示信息。
- `choice`：包含一道或多道题；每道题独立保存选项、正确答案、反馈和尝试次数。
- `sort`：包含可排序项和稳定正确顺序。
- `input`：包含输入提示、评价标准和反馈。
- `explore`：包含一组可自由浏览的语义对象。

协议描述行为数据，不规定按钮、拖拽库或动画实现。HTML Engineer 必须保留键盘操作、焦点状态、错误反馈和 reduced-motion 支持。

## 稳定 ID

- `pageId` 与 `functionalTemplateId` 来自 PagePlan。
- `blockId`、interaction item ID、option ID 和 assetSlot ID 由代码按稳定顺序生成。
- 模型只负责内容语义，不创造技术引用。
- `readingOrder` 必须无重复地覆盖全部 blockId。

这样 QA 可以报告“`block-02` 事实错误”，Repair 可以只修改目标 block，前端也能稳定展示差异，而不必解析整段 HTML。

## 素材槽位

`assetSlots` 来自 `PagePlan.assetNeeds`，Page Writer 只补充替代文本指导。它们仍是“素材需求”，不是已经存在的 Asset：

- 不包含 URI。
- 不编造 assetId。
- 保留 type、role、purpose 和 required。
- 非装饰素材必须说明 alt 文本应表达什么。
- 装饰素材明确要求最终使用空 alt 文本。

后续 Asset Agent 创建真实 Asset 后，再由编排层写入 PagePlan.assetIds。

## 校验分层

1. 模型输出 Schema：限制内容草稿形状和基础长度。
2. `PageContentDSLSchema`：检查联合类型、稳定 ID、引用完整性和 HTML 越界。
3. Page Writer 业务校验：检查 PagePlan、PageWorkerBrief、FunctionalTemplate 和 assetNeeds 是否对齐。
4. 八个模板 examples：防止某种模板没有可表达的 DSL。
5. 浏览器检查器：让人能分别审查 blocks、interaction、assetSlots 和 layoutHints。

Schema 通过只证明协议成立，不证明事实正确或教学质量合格；后续仍需要 QA Agent、bad cases 和人工抽样。
