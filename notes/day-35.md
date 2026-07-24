# Day 35 · 稳定性与成本控制

## 当天结论

项目现在把超时、取消、缓存、模型档位和有限降级收敛到服务端运行时。Keya 前端仍只负责发出创建/取消意图，并通过现有 SSE、Task Controller 和公开事件展示状态；它不选择模型、不读取缓存，也不复制 Agent 业务规则。

Day 35 没有新增产品路由、模型选择面板、缓存控制台或成本仪表盘。完整运行策略见 [`docs/reliability-cost.md`](../docs/reliability-cost.md)。

## 当前稳定性链路

```text
/chat composer
  → typed task API
  → CourseGenerationTaskService / task-owned AbortController
  → Workflow / LangGraph / Agent / Tool
  → AI Client
      → ModelRouter (cheap / balanced / strong)
      → bounded structured-result cache
      → OpenAI-compatible provider
  → checkpoint + public events
  → SSE API client → Task Controller → existing Keya UI
```

事实来源保持不变：

- Task Service 决定任务是否运行、取消或进入终态。
- Workflow、Agent 和 Route Handler 保留业务规则。
- AI Client 负责超时、模型档位、一次瞬时降级、缓存和安全 telemetry。
- UI 只消费共享类型化状态，不直接消费 Provider 或框架原生流。

## Timeout 与取消

- 普通文本调用默认 30 秒，结构化调用默认 60 秒。
- HTML Engineer 返回完整自包含文档，使用独立的 120 秒有限预算；较慢的本地
  Provider 可以用 `AI_HTML_TIMEOUT_MS` 在 30–300 秒范围内覆盖，修改后需要
  重启开发服务。
- Repair 保留独立的有限 120 秒预算。
- 生图把任务 Signal 与 60 秒 provider timeout 合并。
- `DELETE /api/courses/tasks/[taskId]` 是唯一显式任务取消边界；关闭 EventSource 或离开页面不等于取消任务。
- Task Service 先持久化 cancelled 课程/任务终态，再触发活动 Runner 的 AbortController，避免刷新后看到缺失 checkpoint 的 terminal task。
- AbortSignal 继续传入 Workflow、Agent、Tool、语言模型和图片 Provider。

Day 35 修复了一个重要缺口：旧图片 Skill 会把 `AbortError` 转成普通视觉 fallback，素材循环随后可能继续生成下一个槽位。现在任务取消会向上抛出，图片工作流会在缓存、Image Prompt、每个 Provider 调用及素材槽位之间检查 Signal；取消后不会继续启动下一张图片、写入结果缓存、进入 HTML 或 QA。

普通图片供应商失败仍可使用 CSS gradient、inline SVG 或 placeholder。只有任务取消不能被伪装成 fallback。

## ModelRouter

模型路由由 `src/server/ai/model-router.ts` 的确定性 capability 表控制：

| 档位 | 当前职责 | 一次瞬时 fallback |
| --- | --- | --- |
| `cheap` | Intent、Supervisor、Reference 摘要、Template Selector | 无 |
| `balanced` | Pedagogy、Story、Visual、Page Writer、Image Prompt、Single Page、一般调用 | `cheap` |
| `strong` | Planner、HTML Engineer、Page QA、Repair | `balanced` |

路由不读取 Prompt 内容，也不让模型或浏览器自行选档。Planner、QA、Repair 和 HTML 的输出合同较复杂，因此优先质量；边界明确、输出较短的 Intent 和 Supervisor 优先低成本。

部署可以使用以下可选变量覆盖档位：

```env
ARK_MODEL_ID_CHEAP=
ARK_MODEL_ID_BALANCED=
ARK_MODEL_ID_STRONG=

MODEL_NAME_CHEAP=
MODEL_NAME_BALANCED=
MODEL_NAME_STRONG=
```

任一档位未配置时继续使用原有 `ARK_MODEL_ID` 或 `MODEL_NAME`。如果主档和 fallback 实际解析为同一 provider/model，AI Client 会去重，不做没有意义的第二次调用。

## 重试与降级

AI Client 最多执行一次模型 fallback，仅处理可能瞬时恢复的情况：

- HTTP 429；
- 500–504；
- 明确的 rate limit；
- 明确的 timeout。

以下情况不重试、不降级：

- 用户取消或 `AbortError`；
- Zod/Schema 输出校验失败；
- Agent 业务规则校验失败；
- 鉴权或配置错误。

Schema 归一化、Supervisor 尝试次数和 Page Worker Repair 预算仍由原有业务层负责。模型降级不能重置或扩大这些预算。

取消现在使用独立 `CANCELLED_ERROR` telemetry，不再误记为 `TIMEOUT_ERROR`。

## 结构化结果缓存

Day 35 新增一个简单的进程内结果缓存：最大 128 项、TTL 15 分钟，按最近使用顺序淘汰。当前覆盖：

- 通过 `CourseIntentSchema` 校验的 Intent；
- 通过 Planner 模型输出 Schema 校验的规划草稿；
- 当前 Planner 使用的 Functional/Style Template Card 检索结果。

缓存键包含：

```text
namespace
+ canonical semantic input hash
+ prompt/registry version
+ provider/model identity
+ schema version
```

修改输入、Prompt、模型或 Schema 任一项都会 miss。对象 key 会稳定排序，值在写入和读取时复制，调用方不能修改缓存中的共享状态。

缓存绝不保存：错误、取消、未校验输出、stream chunk、Repair 结果、Reference 原始 chunks 或图片字节。缓存键构造失败会 fail-open，模型流程仍可继续。

这是适合当前单进程训练项目的实现。多实例部署需要迁移到共享缓存，并补充租户隔离、single-flight、容量、加密和删除策略。

## 成本与可观测性

AI 完成日志现在可以记录：

- `traceId` 和 capability；
- 选中的 tier 与 provider/model identity；
- duration 和 provider usage；
- cache hit/stored/skipped/bypassed；
- 有限 fallback 的起止档位与公开错误分类。

日志不记录 system/user Prompt、Reference 原文、DSL/HTML、凭据、私有 Agent event data 或 chain-of-thought。Timeline 仍只展示结构化公开摘要，Day 35 不把成本 telemetry 注入浏览器状态。

## 验收结果

- `pnpm lint`：通过。
- `pnpm prompt:lint`：通过，9 个 Specialist Prompt 均满足 8 段合同。
- `pnpm test`：85 个测试文件、452 项测试全部通过。
- `pnpm build`：通过，TypeScript、Turbopack 和 23 个静态页面/路由产物成功生成。
- 专项覆盖包括模型档位、一次 fallback、缓存键失效、TTL/容量、取消不读缓存、图片 Abort 向上传播和取消后不启动下一素材。

自动化测试没有调用真实语言模型或图片 Provider，因此没有产生外部模型费用。真实验收应在用户授权成本后分别验证一次运行中取消和一次同进程缓存命中。

## 面试复盘

### 1. 为什么关闭浏览器或 EventSource 不能代表取消任务？

网络订阅和后台任务不是同一个生命周期。浏览器断线后，服务端 Agent、Tool 或图片 Provider 仍可能继续执行并产生费用。项目使用显式 DELETE API 表达取消意图，由 Task Service 持久化终态并触发任务拥有的 AbortController。多实例环境还需要共享队列或分布式取消标记。

### 2. 为什么 AbortError 不能转换成普通 fallback？

Fallback 表示“用户仍希望继续，但某个非关键供应商能力失败”。Abort 表示“用户要求停止整个任务”。把 Abort 当成图片失败会继续后续槽位、HTML 和 QA，既违反用户意图又浪费成本。因此取消必须穿透 Tool/Agent 边界并尽快向上收敛成 cancelled 终态。

### 3. ModelRouter 为什么采用确定性 capability 映射？

让模型自己选模型会多一次调用，并使成本、权限和降级行为不可预测。确定性映射可以测试、审计并通过环境变量部署；Agent 只声明自己的 capability，不复制 provider 配置。其代价是粒度较粗，未来可在服务端预算内加入输入规模或历史质量指标，但仍不能交给前端或 Prompt 自由决定。

### 4. 缓存键为什么必须包含 Prompt、模型和 Schema 版本？

相同用户输入在 Prompt、模型或输出 Schema 改变后不再是同一个计算合同。忽略任一版本可能静默复用不兼容结果。项目因此把三者与规范化业务输入共同哈希，只缓存经过当前 Schema 校验的完整结果。更严格的键会降低命中率，但换来正确失效和可解释性。

### 5. 哪些错误应该重试？

只重试具有瞬时恢复可能且操作安全的 provider 错误，例如 429、部分 5xx 和明确 timeout。取消、SchemaError、业务校验和鉴权错误不会因立即换模型而自动修复。重试必须有次数上限，并与 Agent/Repair 业务预算分开，否则会出现成本放大和不可预测延迟。

### 6. 当前缓存和取消机制最大的生产限制是什么？

AbortController Map 与结果缓存都位于单个 Node 进程。多实例或 serverless 环境中，请求可能落到另一实例，进程重启也会丢失缓存。生产方案需要共享任务执行器、租约或队列、分布式取消标记以及带租户/TTL/容量约束的共享缓存；现有 API、Controller 和 UI 合同可以保持不变。
