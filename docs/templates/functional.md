# 功能模板

功能模板定义页面承担的学习动作和可用槽位，不定义品牌样式。注册表位于 `src/shared/templates/functional`。

## 选择原则

- `cover`：课程承诺与开始动作。
- `story_intro`：建立情境或提出任务。
- `knowledge_card`：讲解一个或多个同层级知识点。
- `comparison`：比较对象、属性或判断标准。
- `timeline`：过程、阶段或时间顺序。
- `quiz`：选择、排序或输入练习。
- `summary`：回扣目标与收束课程。
- `achievement`：产出型任务与完成反馈。

Architect 必须通过模板搜索取得真实 ID，并校验页面类型、互动槽位、最大项数和约束。页面内容仍由 Page Writer 生成，不能把模板示例当成最终课程正文。

新增模板时必须：

1. 注册唯一 ID、页面类型、槽位和约束。
2. 提供与当前 `PageContentDSL` 一致的示例。
3. 补充注册表、搜索和 DSL 验证测试。
