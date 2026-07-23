# Demo 结果留存

正式运行 `pnpm demo:run -- --record` 后，每次结果进入独立的 `<runId>` 目录。

每个固定案例只留存：

- `check-report.json`：自动结构、HTML、素材、QA 和导出检查；
- `course-detail-desktop.png`：1440 × 900 产品详情证据；
- `course-detail-mobile.png`：390 × 844 产品详情证据；
- `manual-review.md`：六维人工评分与结论。

完整课程 JSON、模型输出、ZIP 和服务日志保存在被 Git 忽略的 `.data/demo-runs`，
避免把大体积运行数据或内部诊断信息纳入文档。
