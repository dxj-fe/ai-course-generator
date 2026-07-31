# 收敛当前项目逻辑与资产

## 目标

项目只保留当前 Keya 产品界面、课程生成链路和运行所需资产。代码、协议、Prompt 与文档均使用唯一的当前定义，不按历史标识分流。

## 已确认边界

- 保留 `/`、`/chat`、`/course`、`/course/[courseId]`、`/templates` 和 `/preview/[previewId]`。
- 保留产品依赖的任务、会话、历史、预览、素材、推荐和引用解析 API。
- 删除训练、分析、分步调试页面与对应客户端。
- 删除历史运行源、历史数据导入、旧游标和旧 Schema 分支。
- Prompt、Schema ID 与文件名使用唯一名称。
- Artifact 与 HTML 使用 `revision` 表示不可变产物的递增修订。
- 保留 `public/keya` 中产品运行图片；删除根目录与文档中的开发截图。
- 文档只保留当前架构、协议、安全、质量、模板和 Demo 验收说明。
- `.data` 继续作为被 Git 忽略的本地运行目录，不视为源码资产。

## 验收标准

1. 生产代码不再包含历史运行源选择与历史数据导入。
2. 当前课程任务请求不需要也不返回运行源字段。
3. PageContentDSL 只接受必填的当前运行时合同。
4. 当前 Prompt、Schema ID 和文件名不带历史标识。
5. 开发截图和过期文档已删除，剩余文档引用有效。
6. TypeScript、Lint、Prompt lint、测试和生产构建通过。

## TODO

- [x] 盘点产品入口、旧分支、文档和图片。
- [x] 清理旧页面、旧 API 和前端目录。
- [x] 清理课程任务运行源与 SSE 历史协议。
- [x] 清理 PageContentDSL、数据库导入与架构投影命名。
- [x] 统一 Prompt、Schema ID 与模板文件名。
- [x] 精简文档、删除开发图片并修复索引。
- [x] 完成 TypeScript、Lint、Prompt lint、测试与构建验证。

## 验证

- `pnpm exec tsc --noEmit`
- `pnpm lint`
- `pnpm run prompt:lint`
- 非浏览器测试：118 个测试文件通过，1 个跳过；826 个测试通过，1 个跳过。
- Chromium 渲染测试：10 个测试通过，5 个按环境条件跳过。
- 在全新当前数据库上完成 `next build`。
