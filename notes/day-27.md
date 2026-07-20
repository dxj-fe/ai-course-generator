# Day 27 · Repair Agent：定向修复、两轮预算与失败分类

## 当天结论

Day 27 把 Day 24 的 Repair Prompt 草案升级为真实运行角色，并把 Day 26 的 report-only QA 接成页面内部的有界闭环：

```text
Page QA
  ├─ shouldRepair=false → page_done
  └─ shouldRepair=true
       → deterministic issue routing
       → Repair Agent
       → original contract validation
       → re-QA
       → pass / next round / structured failure
```

Repair 不读取原始用户 Prompt，不选择其他页面，不增加预算，也不能宣布质量通过。页面运行层最多允许两轮，之后必须保留最新报告并停止。

## Repair 合同

`RepairRequestSchema` 将以下输入绑定为一个严格页面请求：

- 当前 `pageId`、DSL、HTML、VisualBrief 和素材；
- 来源 `QualityReport`；
- 来源报告中真实存在的 issue codes；
- 运行层决定的 `dsl | html` 目标；
- 允许修改的 block IDs 或 selectors；
- 当前 round 和固定 `maxRounds=2`。

`RepairResultSchema` 有三个分支：

- `dsl_candidate`：完整候选 DSL；
- `html_patch_candidate`：最多 8 个精确替换或 selector 标签边界插入 patches；
- `declined`：无法安全修复时的失败分类和公开原因。

结果只能引用请求允许的 issue。`addressedIssueCodes` 和 `unresolvedIssueCodes` 不能重叠；HTML patch 必须和 addressed issue 一一对应。

## 确定性问题路由

模型不决定修复什么。`planRepairRound` 根据最新 QA 报告执行：

1. `contentAccuracy`、`courseCoherence` 优先进入 DSL，但必须有真实 `blockId`；
2. `layoutQuality`、`styleConsistency`、`htmlRuntime` 进入 HTML；
3. 有 selector 的素材绑定、alt 或 fallback markup 问题可进入 HTML；
4. 素材缺失、Provider fallback 或透明通道不可用返回 `unsupported_asset_issue`，不能由 Repair 伪造图片；
5. 没有定位、没有受支持 issue 或预算耗尽时结构化停止。

因此混合问题会先修内容和教学，再由 re-QA 判断是否需要第二轮 HTML 修复。

## 定向候选校验

DSL 候选重新通过 `PageContentDSLSchema`，并且：

- `version`、`pageId`、`functionalTemplateId` 不变；
- 标题、旁白、互动、素材槽和布局提示不变；
- block 数量、ID 和顺序不变；
- 只有 Request 中允许的 blocks 可以变化；
- no-op 候选被拒绝。

HTML 不接受整页候选，只接受定向 patch。修改现有内容时，每个 `replace.search` 必须在当前 HTML 中唯一出现；新增缺失结构时，可在授权且唯一的标签开、闭边界插入内容。`HTML_MAIN_MISSING` 因而可以在 `body` 边界安全插入一对 `main` 标签，而不再搜索尚不存在的 `<main>`。应用后重新执行现有 HTML Engineer 校验：完整文档、安全边界、DSL 可见文本、稳定 data 标记、互动和批准素材引用全部必须保留。no-op、未授权 issue、不唯一替换和越界插入都会失败。

本地回归还统一了 HTML Engineer 与 QA 对素材消费的判断：带 `data-asset-slot-id`、`role="img"` 和内联 `background-image: url(...)` 的已批准素材现在会被启发式 QA 识别，不再误报 `ASSET_REQUIRED_SLOT_EMPTY`。

Repair 后 re-QA 的本地回归暴露了兼容 Provider 的 JSON object mode 边界：模型可能返回超过 300 字符的维度摘要、省略 `location.description`，或使用 `high`、`minor` 等 severity 同义词。Page QA 现在会确定性截断纯展示文本、从已有 blockId/selector/viewport 补出定位描述，并把有限的常见 severity 同义词映射到正式枚举；未知严重度和其他语义错误仍严格失败。该适配同时作用于初次 QA 与 re-QA，不改变报告分数和工作流决策的代码所有权。

后续本地回归确认 Repair 的完整页面请求会精确撞上通用结构化调用的 60 秒上限。AI 客户端现在允许 Specialist 声明独立有限超时，Repair 使用 120 秒上限；超时对外收敛为 `REPAIR_TIMEOUT` 和可恢复提示，不再暴露 Provider 英文异常。Page QA 同时以已通过的 HTML 硬合同为准，不再把允许常显的 success 参考反馈、必须原样复用的批准素材 alt，或素材节点相对 block 的位置误报成不可执行的 Repair 任务。新生成的非装饰素材 alt 也直接使用用途描述，不再生成“描述素材如何实现……”式指令文本。

内容 DSL 被修正后，旧 HTML 立即失效；Page Worker 使用同一 VisualBrief 和素材重新生成并验证 HTML，再进入 re-QA。

## 两轮预算、checkpoint 与恢复

Repair 预算独立于 Writer/Assets/HTML/QA 的阶段执行预算。每轮开始前保存 `RepairAttemptRecord`，包含来源报告、目标、issue 和开始时间；候选应用后只保存公开变更摘要，不重复保存 DSL/HTML 候选正文。

re-QA 报告成为页面最新 `qualityReport`，同时把 report ID 写回本轮记录。两轮后仍 `shouldRepair=true` 时，页面以 `REPAIR_BUDGET_EXHAUSTED` 失败，最新报告不会被删除。

恢复 checkpoint 不会重置预算。若进程在一轮开始后中断，该轮会标记 `agent_failed` 并占用预算，避免恢复后无限重复。用户取消保留 `WORKFLOW_ABORTED`，不会被降级成普通 Repair 失败。

## Seaca 集成

没有新增产品路由或第二套 UI。Page Worker 发布严格公开事件：

- `repair_attempt`：轮次、页面、目标层和 issue codes；
- `repair_success`：候选通过校验后的公开变更摘要；
- `error`：失败码和可展示原因。

现有 `/chat` Timeline 增加 `Repair / re-QA` 页面阶段；右侧 learning workspace 的 `RepairLogPanel` 显示最多两轮的目标、issue、状态和摘要。候选正文、HTML diff、Prompt 和私有推理不进入前端状态。

## 失败分类

- `unlocatable_issue`：QA 要求修订但没有可授权位置；
- `unsupported_asset_issue`：必须返回 Assets 阶段处理；
- `scope_violation`：候选越过页面、字段或 issue scope；
- `candidate_invalid`：候选没有通过原产物合同；
- `budget_exhausted`：两轮仍未通过；
- `agent_failed`：模型、取消或执行异常。

分类用于停止、恢复和公开说明，不会让 Repair 自行选择新的执行路径。

## 验收与验证

自动化覆盖：

- Request/Result 严格引用和 DSL scope；
- 内容/教学与 HTML 问题确定性路由；
- 素材上游失败和预算耗尽；
- HTML 唯一 patch、原合同复验和未授权 DSL 变化拒绝；
- 一轮 Repair 后 re-QA 通过；
- 两轮耗尽保留最终报告；
- Repair Timeline 投影与 workspace 公开日志；
- 旧 checkpoint 不包含 repairHistory 时继续解析。

最终结果：63 个测试文件、348 项测试全部通过；ESLint、Prompt lint、diff check 和联网生产构建通过。构建阶段的 TypeScript 检查、21 个静态页面生成和全部动态路由收集均成功。

验证命令：

```bash
npm test
npm run lint
npm run prompt:lint
npm run build
```

## 面试追问与参考答案

### 1. 为什么 Repair Agent 不应该直接重新生成整门课程？

QA issue 通常只定位到一个页面、block 或 selector。重生成整课会改变已经正确的内容、页面依赖、图片和风格，放大 token、Provider 调用与回归范围，也无法解释到底修了什么。定向 Repair 让输入、授权范围、变更摘要、验证和 re-QA 都可审计。

### 2. 如何设计 AI 生成系统的重试和失败降级策略？

先按失败来源分类：短暂 Provider 故障可做有限重试；可定位质量问题进入目标 Repair；上游素材问题返回原阶段；合同越界立即拒绝；预算耗尽保存最后有效产物并停止。每轮在模型调用前后 checkpoint，候选必须通过确定性合同，最终状态只由运行层和 re-QA 决定。这样既控制成本，也避免无限循环和“模型自称成功”。

### 3. 为什么 HTML Repair 使用 patch，而不是让模型返回完整 HTML？

完整 HTML 很难证明“只改了问题区域”，容易丢失正文、素材引用、无障碍属性或正确样式。唯一匹配 patch 把改动限制为少量可审计替换，随后仍由完整 HTML 合同兜底。它不能证明视觉一定更好，所以还必须 re-QA。

### 4. Repair budget 为什么必须持久化？

如果预算只在内存中，进程重启或断点恢复会把轮次清零，同一坏候选可以无限消耗模型和时间。把来源报告和 round 写入页面 checkpoint，恢复时才能沿用已消费预算并给出稳定停止结果。
