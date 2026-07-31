# 从提示词到课程 HTML

## 请求与任务

`/chat` 通过 `src/features/keya/api/course-task.ts` 调用课程任务 API。服务端校验 `CourseCreationBrief`，创建任务、课程占位和会话关联，然后由后台运行器领取任务。

浏览器通过 `/api/courses/tasks/[taskId]/events` 订阅 SSE。游标格式为编码后的 `traceId` 加递增 `sequence`；断线后只重放当前 trace 的公开事件。

## 课程架构

Curriculum Architect 读取用户 brief、最多三份引用资料和模板目录，提交：

- 事实、术语、示例与资料引用；
- 学习目标和全课统一规则；
- 每页唯一职责、依赖、互动、素材需求与验收条件。

架构 Gate 校验目标覆盖、模板存在性、依赖无环、引用有效性和页面数量约束。

## 页面生成

Course Director 根据 `buildDependsOnPageIds` 分波次派发页面工作单。每个 Page Builder 使用同一条产物链：

1. Page Writer 生成 `PageContentDSL`，其中 `runtime` 是必填合同。
2. 素材工具只生成页面明确要求的资产。
3. HTML Engineer 输出完整文档并注入受信任运行时。
4. 浏览器 QA 在桌面、平板和手机视口采集三份证据。
5. Page QA 合并规则检查与模型评分。
6. Page Gate 通过后原子提交内容、素材、HTML、质量与摘要。

返工只允许修改 Review 授权的目标产物。内容变化会使 HTML、质量和摘要失效；HTML 变化会使质量和摘要失效。

## 整课审查与发布

Course Reviewer 读取当前 manifest、全部页面摘要与质量证据，检查：

- 每个目标是否有讲解和可观察证据；
- 页面之间是否重复、断层或顺序突跳；
- 事实、术语、视觉规则和互动是否一致；
- 当前摘要和质量是否与页面任务匹配。

审查通过后发布精确 manifest。局部问题生成页面修订工作单；架构问题回到课程架构修订。

## 产品投影

`CourseGenerationState` 由当前 `CourseRun` 指针和不可变 Artifact 投影，不扫描历史产物猜测状态。`/chat` 展示公开进度和右侧学习工作区，`/course` 展示持久化历史，播放器只加载完成页面的 HTML。
