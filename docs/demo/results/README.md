# Demo 结果留存

正式运行 `pnpm demo:run -- --record` 后，每次结果进入独立的 `<runId>` 目录。

每个固定案例只留存：

- `check-report.json`：自动结构、HTML、素材、QA、模型首轮通过率、HTML/图片 Provider 成功率、Repair 次数和导出检查；
- `course-detail-desktop.png`：1440 × 900 产品详情证据；
- `course-detail-mobile.png`：390 × 844 产品详情证据；
- `manual-review.md`：六维人工评分与结论。

完整课程 JSON、模型输出、ZIP 和服务日志保存在被 Git 忽略的 `.data/demo-runs`，
避免把大体积运行数据或内部诊断信息纳入文档。

## 当前已提交记录

| Run ID | 结果 | 已提交证据 |
| --- | --- | --- |
| [`2026-07-23T06-36-41-307Z`](./2026-07-23T06-36-41-307Z/summary.json) | 失败；三个案例均未生成页面 | summary、check reports、manual review |
| [`2026-07-23T07-10-04-686Z`](./2026-07-23T07-10-04-686Z/summary.json) | 失败；火星案例规划出 5 页但课程未完成，其余案例未形成页面 | summary、check reports、manual review |

两次记录都没有产品桌面/移动截图，也没有 ZIP 导出。它们用于诊断 Demo
runner 和生成链路，不是通过验收的作品证据。

对外展示前必须在有效文本/图片 Provider 和 Chromium 环境中重新运行：

```bash
pnpm demo:run -- --record
```

只有新 `summary.json` 的 `passed` 为 `true`、三个案例均通过，且对应截图文件
实际存在时，才可以把该 run 链接到项目 README。
