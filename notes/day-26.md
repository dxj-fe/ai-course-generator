# Day 26 · Page QA 深化：多维证据、浏览器测量与内容优先

## 当天结论

Day 26 没有创建第二套 QA 协议，也没有提前实现 Repair。现有 `QualityReport` 的六个持久化键继续作为 checkpoint、API 和前端的兼容合同，并明确映射到手册维度：

| 手册维度 | 持久化字段 |
| --- | --- |
| 内容正确性 | `contentAccuracy` |
| 教学有效性 | `courseCoherence` |
| 页面排版 | `layoutQuality` |
| 视觉风格 | `styleConsistency` |
| HTML 质量 | `htmlRuntime` |
| 素材可用性 | `assetUsability` |

每个维度现在派生 `issueCodes` 和去重后的 `repairHints`，但完整 `issues` 数组仍是问题详情的唯一事实来源。旧报告没有这些新字段时，Zod 会补齐空数组；旧 checkpoint 不需要迁移。

## 质量优先级

模型只生成六维语义评分和候选问题。服务端负责去重、排序、限分、加权总分和最终决策：

1. 内容 `error` 永远排在最前；
2. 其余问题按 `error > warning > info`；
3. 同级按内容、教学、HTML、排版、风格、素材；
4. 最后按 code 和位置稳定排序。

内容仍占最高权重，并且内容低分、HTML 安全错误或任何 error 都会触发确定性质量门槛。视觉分数不能抵消事实错误。

## 三层 QA 证据

Page QA 合并三类互补证据：

- 静态启发式：HTML 合同、安全、语义结构、文本密度、固定宽度、对比度与素材引用；
- 浏览器证据：固定 `1440×900` viewport 下的横向溢出、实际裁切和零尺寸交互元素；
- 模型评价：事实、教学路径、视觉 Brief 一致性以及静态规则难以判断的语义问题。

确定性证据不能被模型否认。模型没有浏览器证据时只能报告布局“风险”，不能伪造像素级结论。

## Playwright 截图边界

截图检查由 `PAGE_QA_SCREENSHOTS_ENABLED=true` 显式开启，并需要本机安装 Chromium：

```bash
pnpm exec playwright install chromium
```

浏览器上下文禁用 JavaScript、拦截所有外部网络，并且只渲染已经通过 HTML 合同和安全预检的文档。PNG 写入 `.data/quality-screenshots`；共享报告只携带状态、opaque artifact ID、viewport、指标和时间，不暴露服务器路径，也没有新增公开截图路由。

Playwright 未启用、Chromium 缺失、超时或写盘失败分别记录为 `skipped` 或 `failed`。这些状态会产生公开的 QA 摘要，但不会让 QA 或 Page Worker 失败。用户取消仍通过 `AbortSignal` 中断流程，不会被当成可忽略截图错误。

## 课程一致性和 Prompt

Page QA Prompt 升级为 `2.1.0/2.1.0`。输入包含课程概览、全局学习目标、当前页目标、前后页计划、`VisualBrief`、素材结果和静态/浏览器证据。Prompt 明确要求：

- 教学维度核对学习目标、理解检查和前后页承接；
- 风格维度逐项对照构图、排版、色彩、素材和无障碍规则；
- 每个问题必须有真实位置与可执行 `repairHint`；
- 只返回报告草稿，不修改 HTML，不调用 Repair，也不自行宣布通过。

## Seaca 展示

现有 `/chat` learning workspace 的 `PageQualityPanel` 继续承担 QA 展示，没有新增路由或视觉系统。面板按六个手册维度分组展示分数、摘要、服务端排序后的问题和去重修订建议，并显示截图状态与非敏感几何指标。前端不重新排序问题，也不读取截图服务器路径。

## 验收与验证

自动化覆盖：

- 旧质量报告兼容和维度证据补齐；
- 内容错误优先排序与维度问题归组；
- 截图成功、超时、Chromium 不可用和不安全 HTML 跳过；
- 截图失败不阻断 Page QA；
- QA Prompt 版本和浏览器证据合同；
- Seaca 六维分组、截图指标及服务器 artifact 隐藏。

最终结果：58 个测试文件、327 项测试全部通过；ESLint、Prompt lint 和联网生产构建通过。首次沙箱构建只因 Google Fonts 网络访问受限失败，联网复验后编译、TypeScript、静态页面生成和全部路由构建均成功。

验证命令：

```bash
npm test
npm run lint
npm run prompt:lint
npm run build
```

## 面试追问与参考答案

### 1. 如何工程化评估 AI 页面排版质量？

不能只让模型“看起来判断”。工程上应先对 HTML 合同、安全和语义结构做确定性检查，再在固定浏览器版本和 viewport 中测量 scrollWidth、裁切、控件尺寸等几何指标，必要时保存截图用于视觉回归，最后让模型判断信息层级、审美和课程语境等模糊问题。报告要保留 viewport、采集状态和指标，确保结论可复现；模型负责解释复杂语义，确定性测量负责验收事实。

### 2. 内容正确性和视觉美观冲突时如何处理？

内容正确性必须是硬门槛。事实错误不能通过提高排版或风格分数抵消，且修订视觉时不能改写 DSL 的事实语义。发生冲突时选择正确、清晰、可访问的页面。Day 26 只报告冲突并给出目标建议；真正修改 HTML、预算控制和 re-QA 属于 Day 27 的 Repair 范围。

### 3. 为什么截图失败不能让课程生成失败？

静态合同和语义 QA 已经能形成基础质量报告，Playwright 是附加证据；把本机浏览器安装、启动波动或截图写盘变成课程交付依赖，会把基础设施问题误报成内容失败。正确做法是记录 `skipped/failed` 和原因，同时让报告明确缺少哪层证据。只有用户取消需要立即中断，而不能被降级吞掉。

### 4. 为什么不把截图服务器路径直接发给前端？

本地绝对路径会泄露部署目录，并且浏览器也无法安全访问。共享合同只传 opaque artifact ID 和测量结果；如果以后确实需要查看截图，应新增经过授权、校验和生命周期管理的服务端读取边界，而不是把文件系统结构当作公开 API。
