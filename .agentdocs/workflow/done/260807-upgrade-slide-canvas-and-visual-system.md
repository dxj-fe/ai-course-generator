# 升级课件画布与视觉参考体系

## 背景

当前课程播放器把主画布限制在 1064px 宽，缩略图默认展开并占用纵向空间；学习 iframe 又允许根页面纵向滚动。生成端与展示端使用不同视口比例，Page Creator 只加载 `course-page-design`，虽然项目已内置 `frontend-slides`、34 个 bold 设计配方和 8 个生产风格，但新 Agent Loop 无权读取这些资源，因此视觉能力实际没有进入首轮创作。

本任务把单页课程重新定义为固定 16:9 的 HTML PPT 页面：页面在 1920×1080 设计舞台内创作，播放器按比例整体缩放，不允许横向或纵向滚动；内容放不下时由 Course Lead 增加页面，Page Creator 重新排版或使用渐进互动，而不是缩小正文或制造滚动区。

## 前端视觉基线

- 视觉命题：让课件成为播放器绝对主角，以更大的无滚动 16:9 舞台呈现，宿主 UI 退到安静、轻量的控制层。
- 内容计划：固定顶部课程定位；中央最大化课件舞台；紧凑播放控制；缩略图按需展开而非默认占据空间。
- 交互命题：页面切换保持快速淡入；全屏无尺寸跳变；缩略图展开时画布平滑收缩并始终保持 16:9。

## 架构方案

1. 播放器与 Browser Harness 共用 16:9 合同，学习 iframe 使用 contain-fit 且 `scrolling=no`。
2. QA 使用三个 16:9 视口验证同一个舞台缩放，纵向/横向溢出和嵌套滚动均为阻断错误。
3. Page Creator 同时获得 `course-page-design` 与轻量的课程版 `frontend-slides` 指引；Harness 在首轮 Prompt 中直接注入一个课程级主视觉配方及两个备选配方的路径、适用性和 token 摘要。
4. 模板只提供字体、色彩、构图语法、形状语言和动效参考，不输出 DSL，不强制复制 layout。
5. 扩充生产风格谱系，并继续复用现有 34 个 bold 配方；新增风格必须有确定性匹配、资源路径和测试。
6. 提供可审计的失败课程清理命令，在事务中删除课程及其 Task、Run、WorkOrder、Artifact、事件、工具账本和关联本地 workspace/证据文件。

## TODO

- [x] 统一播放器、iframe 与 QA 的 16:9 无滚动合同。
- [x] 放大播放器并默认收起缩略图。
- [x] 为 Page Creator 接入可渐进读取的视觉参考体系。
- [x] 扩充生产风格并补充视觉参考来源。
- [x] 删除现有失败课程及其关联脏数据。
- [x] 完成 lint、测试、构建与真实浏览器验收。

## 验收记录

- 播放器生产构建实测主画布为 1280×720，比例 16:9，iframe 为 `scrolling=no`，宿主页面横纵溢出均为 0。
- 生产参考从 8 个扩充到 12 个，Page Creator 可按精确路径读取 34 个 frontend-slides bold 配方。
- 清理 17 门 failed 课程、20 个任务、526 个 Artifact、825 条工具操作与 719 条事件；保留 2 门 completed 和 2 门 cancelled 课程。数据库、17 个 workspace、495 张截图与 45 个独占素材保存在 `.data/backups/failed-courses-2026-08-07T03-29-15-760Z`。
- Prompt lint、ESLint、Next.js production build、945 个单元/常规测试和 11 个真实 Chromium Browser Harness 集成测试通过；ESLint 仅有 frontend-slides 上游资源中原有的 2 个 warning。
