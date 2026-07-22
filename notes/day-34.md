# Day 34 · 前端产品化打磨

## 当天结论

项目现在可以沿同一套 Seaca 产品壳完成“输入 Prompt 和资料 → 配置任务 → 查看公开进度 → 预览多页课程 → 从历史重新打开 → 导出交付包”的五分钟演示。当天没有新增 Agent、Prompt、模型能力或第二套 UI。

## 状态边界

- Task state：一次创建、恢复或取消运行，由 task record 与 SSE 表达。
- Course state：跨运行持久存在的课程检查点，是历史、详情和导出的事实来源。
- Page state：页面 DSL、素材、HTML、QA、Repair 和局部错误。
- UI state：筛选条件、当前预览页、参数 disclosure 和导出进度，刷新后可以重建。

列表 API 只返回标题、状态、页数、运行次数和时间等摘要。完整 HTML、Reference chunks 和事件不会进入历史列表；课程详情按 courseId 单独加载。

## 产品数据流

```text
/chat composer options + references
  → typed task API → task/SSE → CourseGenerationState checkpoint
  → /course compact history → /course/[courseId] durable detail
  → one selected sandbox iframe / validated ZIP export
```

Store 列表读取会逐条校验本地 JSON。单个损坏记录不会击穿全部历史，界面只公开不可用数量，不暴露服务端路径或文件正文。

## 导出合同

只有 `completed` 课程可以导出正式 ZIP：

```text
course.json
pages/01-<pageId>.html
pages/02-<pageId>.html
...
assets/manifest.json
```

页面文件名只使用经过 Schema 验证的 course/page ID 和顺序。素材 manifest 记录页面、slot、内部 URI、可访问文本与 fallback；Day 34 不把服务端图片文件复制成离线站点，也不改写已校验 HTML。

## 五分钟演示路径

1. 在 `/chat` 输入学习目标，选择页数、串并行和并发数，可附加 txt/md/pdf。
2. 提交后展示 SSE 连接、Supervisor/Agent 公共摘要、页面阶段、错误和取消。
3. 在右侧学习空间切换页面，查看单 iframe HTML、素材、QA 和 Repair。
4. 打开 `/course`，搜索或筛选刚才的课程，查看关联运行记录。
5. 从 `/course/[courseId]` 重新打开持久化预览；未完成课程返回原检查点，完成课程导出 ZIP。

## 面试复盘

### 为什么 Task 和 Course 要分开？

一次课程可能经历初始创建和多次恢复，因此 Task 是一次执行，Course 是多次执行共同更新的持久产物。分开后取消、运行来源、失败记录不会覆盖课程已完成页面。

### 为什么历史列表不用完整 CourseGenerationState？

列表是读模型，只需摘要。返回完整事件、HTML 和资料 chunks 会增加传输、浏览器内存和泄露面。详情页再按稳定 courseId 加载完整检查点。

### 为什么预览仍使用 sandbox iframe？

持久化只改变产物来源，不改变 HTML 信任边界。模型生成 HTML 不能进入主 React DOM；当前页面独占一个无权限 iframe，既隔离又控制内存。

### 导出为什么放在 Route Handler？

服务端能够重新校验课程、控制 ZIP 文件名、避免浏览器拼接不可信结构，并以流式响应交付多个文件。展示组件只触发 Controller 下载动作。

### 主要权衡是什么？

本地目录扫描适合当前面试项目和有限记录；更大规模应迁移到带索引和分页的数据库。Day 34 保持明确接口，使存储替换不要求重做 UI。
