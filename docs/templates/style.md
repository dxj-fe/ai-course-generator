# 样式模板

样式模板定义整门课程的视觉方向，注册表位于 `src/shared/templates/style`。一门课程只选择一个样式模板，所有页面共享颜色、字体、间距、圆角和阴影变量。

当前视觉方向包括：

- `sci-fi`
- `kids-playful`
- `minimal`
- `nature`
- `blackboard`
- `game-quest`

样式模板不改变页面职责、互动类型或内容结构。HTML Engineer 将模板转换为 CSS 变量，页面仍需满足固定画布、可读性和三视口质量要求。

新增样式时必须使用现有 token 结构，并补充注册表、CSS 输出和页面渲染测试。
