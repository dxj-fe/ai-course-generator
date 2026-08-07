# 样式参考体系

样式注册表位于 `src/shared/templates/style`。它负责为整门课程匹配视觉身份，不决定课程结构、页面职责、互动形态或组件树，也不是 DSL 插槽。

## 两层视觉资源

- 12 个生产参考：8 个核心方向加 `neo-grid-bold`、`soft-editorial`、`cartesian`、`studio-electric` 四个增强方向。它们拥有可测试的画像、颜色、字体、形状、动效和素材建议。
- `resources/agent/skills/frontend-slides` 中的 12 个安全预设和 34 个 bold 配方：作为更丰富的构图与风格参考库，不整体注入 Prompt，不复制多页 deck 运行时。

Harness 根据课程主题、受众、学习动作、视觉方向和风险画像选出一个主参考与两个备选方向，把紧凑 token 和精确 `recipePath` 直接交给所有并行 Page Creator。首次编辑无需机械读取；只有需要更深的构图语法时，Agent 才通过 `read_local_resource` 读取一个完整配方。

同一门课共享主视觉命题，但每页仍围绕自己的教学职责自主构图。允许切换明暗场、尺度和版式节奏；禁止把示例内容、固定卡片数或 deck wrapper 当作模板复制。

课程页统一使用 1920×1080 固定舞台，由宿主同比缩放到三个 16:9 视口。丰富度来自更强的信息排布、知识图形、渐进互动和更多页面，不来自滚动条、缩小正文或长页面。

新增生产参考时必须复用现有 Schema，提供有效的 `recipePath`，补充确定性匹配、CSS 输出和浏览器质量测试。
