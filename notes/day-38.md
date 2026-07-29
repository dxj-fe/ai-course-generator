# Day 38 · 简历项目包装

## 今日产出

- 新增可直接投递的一句话定位、技术栈和七条简历亮点。
- 为每条亮点建立问题、技术动作、源码、测试和能力边界映射。
- 为七条亮点分别准备约 2–3 分钟的面试深挖回答。
- 审计八张产品图片，区分当前主图和历史截图。
- 明确保留两次真实模型 Demo 失败、无截图、无 ZIP 的事实。
- 在 README 增加 GitHub、简历亮点、面试深挖和截图证据入口。

## 七条技术贡献

1. 严格 SSE 与可恢复长任务。
2. Zod 结构化输出与共享状态合同。
3. 多 Agent、隔离 Page Worker 与规则型 LangGraph Supervisor。
4. 功能模板与样式模板 Registry。
5. 图片素材生成、缓存、内部 URI 和类型化降级。
6. 确定性合同、Playwright、六维 QA 与定向 Repair/re-QA。
7. 持久课程历史、安全播放器与 ZIP 导出。

## 事实边界

- 不使用没有真实实验数据支撑的百分比和业务指标。
- 不把本地单进程任务系统描述为分布式高并发平台。
- 不把使用第三方 Provider 描述为训练或自研基础模型。
- 不把自动化测试通过等同于真实模型 Demo 通过。
- 不把设计展示图或历史截图描述为当前真实运行验收。
- 不声称 QA 可以替代学科专家、审美评审或发布审批。

## 文件入口

- [`docs/resume/project-bullets.md`](../docs/resume/project-bullets.md)
- [`docs/resume/interview-deep-dive.md`](../docs/resume/interview-deep-dive.md)
- [`docs/resume/screenshots.md`](../docs/resume/screenshots.md)
- [`README.md`](../README.md)

## 验证结果

已执行：

```bash
pnpm lint
git diff --check
```

- ESLint 通过。
- Markdown 相对链接和图片路径检查通过。
- 简历投递版恰好包含 7 条亮点。
- 面试深挖恰好包含 7 个对应章节。
- 所有源码、测试和截图证据路径存在。
- GitHub 链接与 `origin` remote 一致。
- 八张产品图片已逐张视觉检查，并区分当前主图和历史截图。
- 手册 Day 38 页面已重新渲染并视觉检查。
- `git diff --check` 通过。

Day 38 只修改文档，没有改动产品源码、UI、路由或启动说明，因此没有重复运行与本次范围无关的完整测试和生产构建。
