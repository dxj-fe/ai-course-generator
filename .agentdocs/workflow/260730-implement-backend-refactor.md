# 实施后端与 Agent 生成链重构

## 背景

目标架构已记录在 `docs/architecture/backend-target-architecture.md`。任务开始时，生产代码已经有 agent-v2 的 CourseRun、WorkOrder、Artifact 和四类 Agent，但目录仍分散在 `course-generation`、`model-steps`、`prompts`、`tools`、`storage`、`tasks` 与 `workflows`，统一 Agent Registry、项目内 Skill Registry 和组合根尚未落地。

本任务开始实施目标架构，同时把课程生成质量视为上游设计问题，而不是依赖末端不断增加 Gate、测试和 Repair：

- 优先让 Brief、课程架构、页面任务和上下文一次传对；
- Prompt、Tool、Skill、模型路由和 Harness 共同决定 Agent 的有效自由度；
- 确定性代码只负责权限、数据一致性、安全和最低交付合同；
- Gate 给出必要反馈，但不能替代 Agent 的规划和生成能力；
- Repair 是异常恢复路径，不是默认生成路径。

## 成功标准

1. Agent、Prompt、Tool、Context、Schema 和 Skill 都有统一 ID 与注册入口，业务不再硬编码或直接导入具体 Agent 实现。
2. 项目 Skill 位于 `resources/agent/skills`，产品 Agent 可以通过受限只读 Tool 渐进读取，开发代理目录不会进入产品 Runtime。
3. Course Engine 通过统一 Agent Executor 执行 WorkOrder，不按具体 Agent 实现分支。
4. 课程相关 Run、Gate、Policy、Store、Projection、Stream 最终收拢到 `server/course`，通用 AI、数据库、文件和浏览器能力收拢到 `server/infra`。
5. Route 和 Worker 通过 `server/setup` 获取装配后的服务。
6. Architect 能一次产出方向正确、职责区分明确、目标与学习证据对应的完整课程架构。
7. Page Builder 获得足够的课程全局规则、页面职责、已验收依赖摘要和可选择工具，默认路径不是先生成低质量结果再反复修复。
8. 模型路由按能力和任务复杂度选择合适模型，fallback 只处理可恢复的 Provider 故障。
9. 保留现有 API、SSE、SQLite durable facts、暂停/恢复/取消、租约、CAS 和幂等语义。
10. 每个阶段通过对应 lint、类型检查、单元测试、集成测试和架构边界测试。

## 迁移不变量

- 不一次性移动全部文件；每阶段都保持可运行并可回滚。
- 不删除用户当前工作树中的无关改动。
- 不用新增验证数量代替生成质量提升。
- 不把 Model Step 重新包装成没有独立 WorkOrder 的伪 Agent。
- 不让模型决定数据库事务、租约、权限、发布安全或公开事件清洗。
- 不给 `read_local_resource` 任意宿主文件读取权限。
- 不让 Repair 成为正常成功路径的必经步骤。

## 阶段

### 阶段 0：基线与边界

- [x] 记录当前 lint、类型检查和测试基线。
- [x] 盘点 Agent、Prompt、Tool、模型路由、Gate、Repair 的真实调用关系。
- [x] 确定第一批兼容迁移文件和 import 边界。

### 阶段 1：统一 Agent 与 Skill 基础设施

- [x] 建立 `server/agent/ids`、类型定义和 Registry。
- [x] 建立 `resources/agent/skills` 与项目 Skill Registry。
- [x] 实现受限 `read_local_resource` Tool 和安全路径读取。
- [x] 将现有四类 Agent 以兼容定义注册，不改变 CourseRun 行为。
- [x] 补充 Registry、Skill 和文件权限测试。

### 阶段 2：统一 Runtime 与代码插件

- [x] 将 AgentRunner、预算、权限和 Tool 执行迁到 `server/agent/runtime`。
- [x] 迁移 Agent、Prompt、Tool、Context 和 Schema 插件。
- [x] Course Engine 改为依赖 Agent Executor。
- [x] 移除业务中的 Agent/Tool/Prompt 硬编码 ID。

### 阶段 3：收拢 Course、Infra 与 Setup

- [x] 收拢 Course Run、Task、Gate、Policy、Store、Projection 和 Stream。
- [x] 收拢 AI、数据库、文件、浏览器和并发基础能力。
- [x] Route/Worker 统一经 `server/setup` 装配。
- [x] 建立并启用 import 边界测试。

### 阶段 4：一次生成质量优化

- [x] 优化 Brief 到 CourseArchitecture 的信息保真和目标表达。
- [x] 优化 Architect Prompt、课程设计 Skill、模板/资料 Tool 与模型路由。
- [x] 优化 Page Builder 的全局规则、页面职责、依赖摘要和 Tool 反馈。
- [x] 审核 Gate，只保留安全、合同和必要业务边界。
- [x] 将 Repair 从常规路径降为有证据的异常恢复路径。
- [ ] 用代表性课程样本比较首轮通过率、返修次数和最终质量。

### 阶段 5：清理与完成审计

- [x] 删除旧兼容导出和空目录。
- [x] 更新所有架构与运行链文档。
- [x] 完成全量 lint、类型检查、测试和构建。
- [x] 实际启动三个固定 Demo，并定位 Provider 配置阻塞。
- [x] 增加 Demo Provider 预检、单案例运行和稳定的 Next 构建目录。
- [x] 区分模型首轮产物与确定性 HTML/图片 fallback，避免降级产物冒充上游质量。
- [x] 投影架构尝试、重规划和整课返工计数，形成真正的整课首轮质量证据。
- [x] 按成功标准逐项收集证据并完成审计；真实 Provider 样本单独保留为外部配置阻塞项。

## 当前决策

- 第一批实现优先选择不改变业务行为的 Agent ID、Registry、Skill Registry 和安全读取基础设施。
- 第一批项目 Skill 只提供课程设计方法与资源读取，不引入脚本执行。
- 当前 `server/tools/skill-registry.ts` 实际是可执行 Tool Registry，迁移时必须更名，不能与 Agent Skills Registry 混用。
- 质量优化先从 Architect 和 Page Builder 的输入、Prompt、Tool、Skill、模型路由开始，再评估是否需要减少现有 Repair/Gate。

## 基线证据

- `npm run lint`：通过。
- `npx tsc --noEmit`：通过。
- `npm test`：111 个测试文件通过、1 个跳过；仅 `deterministic-page-fallback.test.ts` 的 4 个 Playwright 用例因当前沙箱禁止 Chromium MachPort 启动而失败，不是断言失败。
- 当前 Engine 在 `invokeAgent()` 中按 `WorkOrder.kind` 直接分派四个 Agent；这是统一 Agent Executor 的主要迁移点。
- 当前 Tool 名称散落在 Repository、Agent Context 和具体 Agent 文件中；第一批先以常量保持现有字符串兼容。
- 当前 Architect 有检索、模板、确定性预检和提交 Tool，但没有项目 Skill 读取能力。
- 当前 Page Builder 的 `resolvePageBuilderActiveTools()` 基本把正常生成收敛成固定阶段序列，模型只在有限分支内选择；后续质量阶段要扩大“如何完成页面”的合理自由度，而不是移除安全与持久化边界。

## 阶段 1 证据

- 新增 `server/agent/ids`，现有四类课程 Agent 已通过 `server/setup/agent.ts` 注册并冻结。
- `resources/agent/skills/course-design` 已按 Agent Skills 目录规范建立，`SKILL.md` 只保留课程设计核心方法，目标证据和课程结构说明由 Agent 按需渐进读取。
- Skill Registry 只扫描 `resources/agent/skills` 的直接子目录，校验目录名、frontmatter、`SkillIds`、资源 digest 和符号链接边界。
- `read_local_resource` 只接受 `agent/skills/...` 逻辑路径，同时受 Agent 定义中的 `skills`、单文件额度、Session 累计额度、读取次数、媒体类型和 digest 去重约束。
- Curriculum Architect 已从统一 Agent Registry 读取模型能力和 Skill 授权；统一 Skill Harness 先加载核心说明，再允许同一 ToolLoop 渐进读取 reference、校验及提交课程架构。
- `skill-creator/quick_validate.py resources/agent/skills/course-design`：通过。
- 阶段定向验证：TypeScript 通过；Agent/Skill/文件权限和 Curriculum Architect 共 15 个测试通过；全量 ESLint 通过。

## 阶段 2 当前证据

- 通用 `AgentRunner`、预算、错误、Tool Guard 和 ToolResult 已迁入 `server/agent/runtime`；课程 Tool Ledger 已移入 `server/course/run`，旧 `course-generation/runtime` 已删除。
- `AgentSystem` 现统一持有并冻结 Agent、Prompt、Tool、Context、Schema 和 Skill Registry；启动时校验所有 Agent 引用以及 Prompt 模板文件和变量。
- 四类 Agent 的系统 Prompt 已移到 `server/agent/plugins/prompts/course` 并由 Prompt Registry 加载，不再散落在 Agent 实现函数中。
- 新写入的 WorkOrder 已显式保存 `agentId`；Engine 从 Agent Definition 获取模型能力，再由通用 `AgentExecutor` 按 `agentId` 分派，不再在 `invokeAgent()` 中按 `WorkOrder.kind` 判断具体 Agent。
- 旧 durable WorkOrder 若没有 `agentId`，只在读取执行时使用兼容映射；新增 WorkOrder 不依赖该映射。
- Agent 公开名称和各 Agent Tool 集合已统一从 `server/agent/ids` 引用，课程业务中的重复 Agent 字符串已移除。

## 首轮质量优化当前证据

- Architect 由统一 Skill Harness 先获得 `course-design` 核心说明，再从 Prompt、按需 Skill reference、资料 Tool、模板 Tool 和强模型路由形成首轮 CourseArchitecture；Skill 明确目标—证据矩阵、页面唯一职责和真实生成依赖。
- Architect Prompt 已移除固定“首页/末页类型序列”，让页面类型服从课程弧线和学习职责。
- Page Writer 现在一次收到 CourseArchitecture Context：原始结构化 Brief、完整课程事实、受众、目标、全局规则、当前 PageTask、相邻页面职责和已验收依赖摘要。
- Page Writer Prompt 从大量字符级补丁规则改为“事实保真—学习证据—跨页分工—画布表达”的优先级，并明确首轮结果应值得交付，QA/Repair 只处理有证据的缺口。
- Page Builder Prompt 明确工具选择服务于当前缺失产物，Repair 不再被描述为默认创作路径。
- 当前定向验证：Agent Registry/Executor/Prompt/Skill、四类 Agent、Engine、Page Writer 与 Page Builder 相关 67+55 个用例分组通过；TypeScript 与 ESLint 通过。

## 最终实施证据

- `src/server` 的一级目录只保留 `agent`、`conversation`、`course`、`infra`、`preview`、`reference` 和 `setup`；旧 `agents`、`ai`、`storage`、`tasks`、`tools`、`prompts`、`quality`、`repair`、`workflows`、`langgraph` 等目录已移除。
- `agentPluginCatalog` 是 Agent、Context、Prompt、Schema 和 Tool 的统一静态插件目录；Agent 声明与执行 Handler 分离，避免组合根与插件产生循环依赖。
- `AgentSystem` 统一注册并冻结六类 Registry；Course Engine 只把 `agentId` 交给 `AgentExecutor`，没有按 WorkOrder kind 分派具体 Agent。
- `tools`、`runtime` 和 `skills` 现在真正以 Agent 定义为默认事实来源：Course 通过统一 Agent Catalog 创建 WorkOrder，不再在 Repository/Command 中复制 Agent Tool 集合和预算；Architect/Page Builder 也不再各自创建 Skill Session 或重复本地读取额度。
- 项目 Agent Skill 只从 `resources/agent/skills` 扫描。`course-design` 和 `course-page-design` 均符合 Skill 目录规范，详细方法位于 `references/`；Architect 与 Page Builder 只能在各自 Agent 定义的授权范围内，通过受路径、次数、字节、媒体类型和 digest 约束的 `read_local_resource` 渐进读取。
- 顶层 Agent Prompt 和 8 个 Model Step 的 system/user Prompt 共用 Prompt Registry；业务引用稳定 ID 常量，不硬编码注册字符串。
- Architect 获得结构化 Brief、整课模板需求、受限资料摘录和课程设计 Skill；Page Writer 获得完整 CourseArchitecture、当前页面职责、相邻页面职责和已验收依赖摘要。
- Page Builder 的 `course-page-design` Skill 已实际接入生成链：运行时加载 Skill 核心说明，Agent 按当前页面选择性读取构图或互动 reference，Session 中已读资源同时进入 Page Writer 与 HTML Engineer Context。HTML Prompt 不再强制三块内容套 `details/summary`、固定素材面积比例或特定 CSS 数值。
- 强能力任务优先走 strong 模型；只有 429、5xx、timeout 和 rate limit 等瞬时 Provider 故障允许降级。402/quota、Schema、业务合同和取消错误不再用弱模型重写，也不会伪装成可重试 Agent 回合。
- QA 分数保留为可观测质量信号；Page Gate 和 Repair 只响应具体 `error`、Schema、安全、HTML 合同和截图证据。warning 或低分本身不再触发 Repair；agent-v2 从 WorkOrder revision 和 durable Repair checkpoint 投影真实 `repairAttemptCount`，质量比较据此计算首轮通过率和平均返修次数。
- Route 通过 `server/setup` 或业务公开门面取能力；`app` 不能导入 Agent 插件、Course 内部实现和底层数据库/文件模块，`server` 不能反向导入 `features`，`shared` 不能导入 `server`。
- 服务端和共享 TypeScript 源文件均小于 1000 行；大文件已按截图 issue、确定性 fallback markup 和 Page Writer interaction 职责拆分。

## 最终验证

- `npm run lint`：通过，0 warning。
- `npx tsc --noEmit`：通过。
- `npm run prompt:lint`：通过，8 个 Model Step、8 组必需章节均完整。
- `skill-creator/quick_validate.py resources/agent/skills/course-design` 和 `course-page-design`：均通过。
- 单元与集成测试：非浏览器部分 118 个测试文件、843 个测试通过，1 个 Provider spike 跳过；浏览器布局测试在沙箱外启动 Chromium 后 10/10 通过。合计 119 个测试文件、853 个测试通过，1 个跳过。
- `npm run build`：通过，22 个页面成功完成静态或动态构建。
- Import 边界与共享课程视图定向测试：7/7 通过。

## 成功标准完成审计

| 标准 | 当前证据 | 结论 |
| --- | --- | --- |
| 1. 六类能力统一 ID 与注册入口 | `AgentSystem` 冻结六类 Registry；硬编码 ID 与重复 Agent Tool/预算搜索均为空 | 已证明 |
| 2. 项目 Skill 与受限渐进读取 | 两个标准 Skill、统一 Skill Harness、安全读取额度/路径测试、Skill 校验均通过 | 已证明 |
| 3. Engine 只按 `agentId` 执行 | `AgentExecutor` Handler Catalog、Engine 与架构边界测试通过 | 已证明 |
| 4. `course` / `infra` 收拢 | `src/server` 实际目录审计与构建通过 | 已证明 |
| 5. Route / Worker 经 `setup` | Import 边界测试通过 | 已证明 |
| 6. Architect 首轮课程设计质量 | Prompt、Skill、模板/资料 Tool、强模型路由和合同已接通；授权后真实运行在 planner 首次请求被 Provider 拒绝 | 实现已证明；有效凭据下的真实样本待完成 |
| 7. Page Builder 首轮页面质量 | 全局上下文、页面设计 Skill、Skill→Model Step 注入、非默认 Repair 路径测试通过；本次运行未越过 planner | 实现已证明；有效凭据下的真实样本待完成 |
| 8. 模型路由与 Provider fallback | 强任务路由和只对瞬时 Provider 故障 fallback 的单元/集成测试通过 | 已证明 |
| 9. API/SSE/SQLite/控制语义 | 全量任务、恢复、租约、CAS、幂等、暂停/恢复/取消测试通过 | 已证明 |
| 10. 全阶段本地验证 | lint、类型、853 项测试、Skill 校验、浏览器测试、生产构建通过 | 已证明 |

## 待完成的真实样本对比

20 项代表性课程清单位于 `docs/demo/quality-benchmark-prompts.json`；三个固定 Demo 的 `check-report.json` 和成对比较器都已记录首轮通过页面数/比例、返修次数、平均返修次数、平均 QA/视觉分和综合分。

2026-07-30 获得外部调用授权后已实际运行三个固定案例，Run ID 为
`2026-07-30T10-49-52-904Z`。三个任务均在 planner 的第一次文本模型请求处返回
`AUTH_ERROR`，未生成任何页面、图片、ZIP 或产品截图，因此该 Run 只能证明请求
确实到达 Provider，不能作为课程质量结论。安全检查确认 Next.js 正常加载了
`.env`；阻塞原因是当前 `ARK_API_KEY`、`ARK_MODEL_ID` 仍为示例占位值，且未注释
的 `IMAGE_*` 示例会覆盖默认 Ark 生图配置。

Runner 现会在启动服务前按实际模型路由预检 cheap、balanced、strong 和图片
Provider，拒绝缺失项及占位值且不输出 Key；同时支持
`pnpm demo:run -- --case <id>` 聚焦验证，正式 `--record` 仍强制完整三案例。
Next dev 的构建目录固定为 `.data/demo-next`，不会再把每次 Run ID 写入
`tsconfig.json`。质量报告另行记录模型首轮通过率、模型 HTML 比例和图片
ready 比例；确定性 HTML renderer 或图片 fallback 保留生产降级能力，但会让
固定 Demo 失败，不能冒充 Prompt、Skill 或模型带来的质量。公开状态还投影
聚合的架构尝试、replan 和整课返工次数，不暴露 WorkOrder 或私有推理；只有
一次架构成功、无整课返工且全部页面均为模型首轮成功时，才计为整课首轮通过。
下一步是在有效
Provider 凭据写入 `.env.local` 或 `.env` 后先
运行一个聚焦案例，再运行完整三案例并完成人工复核；在此之前不扩展到 20 项。
