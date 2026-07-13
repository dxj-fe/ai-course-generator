# Day 07：课程领域建模

## 今日核心目标

建立 `Course`、`CourseOutline`、`PagePlan`、`Asset`、`Theme`、`QualityReport` 的共享 Zod Schema，让后续多页课程 Agent 使用稳定、可校验、可序列化的协作协议。

## 建议时间安排

1. 45 分钟：从“意图解析 → 课程规划 → 单页生成 → 素材生成 → HTML 输出 → 质量评估”推导实体与引用关系。
2. 90 分钟：实现核心 Schema、类型导出和跨实体校验。
3. 45 分钟：为每个 Schema 编写 example JSON，并用测试保证示例持续有效。
4. 45 分钟：阅读 `docs/schema.md`，复盘字段存在的理由以及 DSL 设计边界。
5. 30 分钟：运行测试、lint、build，检查前后端共享类型是否成立。

## 必做任务与完成结果

- [x] 定义 `CourseSchema`、`CourseOutlineSchema`、`PagePlanSchema`、`AssetSchema`、`ThemeSchema`、`QualityReportSchema`。
- [x] 实现手册要求的八种 `pageType`。
- [x] 为六个核心 Schema 提供 example JSON。
- [x] 从 `src/shared/course-schema/index.ts` 统一导出 Schema 和推导类型。
- [x] 让服务端 Agent 与客户端 Timeline UI 都从共享模块导入类型。
- [x] 写 `docs/schema.md` 解释核心字段、实体关系、跨实体校验和 DSL 边界。
- [x] 增加 example 回归测试及无效引用测试。

## 扩展补充知识

- 聚合根：`Course` 负责维护课程内部 Page、Asset、Theme、QualityReport 的引用一致性。
- 中间态与持久态：`PagePlanDraft` 是 Agent 轻量中间输出，`PagePlan` 是多页流水线使用的完整领域对象。
- 引用优于嵌套复制：页面只保存 `assetIds`，避免素材信息在多个页面间漂移。
- 状态不变量：`ready` 页面必须有 HTML，`ready` 素材必须有 URI 和替代文本。
- Example 也是契约：示例必须由测试解析，不能只作为容易过期的说明文本。

## 结合 ai-course-generator 的实践建议

后续 Course Planner Agent 应只生成 `CourseOutline`，不要同时生成最终 HTML。SinglePageAgent 可以继续产生 `PagePlanDraft`，再由一个显式的映射步骤补齐功能模板、样式模板、素材引用和状态，形成完整 `PagePlan`。HTML Engineer Agent 只消费 `PagePlan + Theme + Assets`；Quality Agent 只返回 `QualityReport`。这样每个 Agent 的输入输出边界清晰，失败时能定位到具体协议阶段。

## 验收标准

- 前端和服务端可以从 `@/shared/course-schema` 导入同一套类型。
- 六个 example JSON 全部通过对应 Zod Schema。
- 八个 `pageType` 与手册一致。
- 缺少 HTML 的 ready 页面、前向页面依赖、不存在的素材引用会被拒绝。
- `pnpm test`、`pnpm lint`、`pnpm build` 全部通过。
- 能清楚解释为什么核心 DSL 只约束跨 Agent 语义，不约束具体 UI 组件树。

## 当天复盘问题（面试题与详细答案）

### 1. 在 AI 生成系统里，Schema 设计对稳定性有什么影响？

Schema 把自然语言协作变成可验证的数据协作。它至少在五个方面提高稳定性：

1. 输入输出可校验：模型漏字段、类型错误或枚举漂移会在边界处失败，而不是把错误传播到渲染阶段。
2. 多 Agent 可组合：Planner、Content、Asset、HTML 和 Quality Agent 对同一字段使用一致语义，减少隐式假设。
3. 失败可定位：校验错误能指向具体路径，例如 `outline.pages.2.assetIds`，便于重试或人工修复。
4. 状态可持久化：可序列化的稳定对象可以进入数据库、缓存、队列和 Timeline，也便于断点续跑。
5. 变更可治理：Schema 与 example、测试、版本号一起构成回归基线，协议升级时能判断哪些消费者受影响。

但 Schema 不能消除模型不确定性。它保证“形状合法”，不自动保证事实正确、教学合理或视觉优秀，因此仍需要 Prompt、工具、业务校验和 QualityReport 共同形成闭环。

### 2. 如何在 DSL 约束和 UI 丰富度之间取平衡？

原则是严格约束跨边界语义，放开单一实现内部的表现细节。课程目标、页面类型、顺序、依赖、功能模板、样式模板、素材引用和质量结果会被多个 Agent 或前后端共同理解，必须进入 DSL。具体 DOM、组件树、像素位置、动画曲线和每段 CSS 通常只由 HTML 生成或渲染层消费，不应全部塞入核心 Schema。

实践中可以使用三层结构：

1. 稳定领域层：`Course / PagePlan / Asset / Theme / QualityReport`，字段少而语义稳定。
2. 可演进模板层：功能模板定义教学槽位，样式模板定义 design tokens；模板可以独立版本化。
3. 自由渲染层：HTML Agent 在领域约束和模板边界内决定具体布局与表达。

判断一个字段是否应进入 DSL，可以问三个问题：是否有两个以上消费者需要它？缺失时下游是否无法正确工作？它是否能在不同 UI 实现中保持相同语义？三个问题多数为“是”时才应进入核心 Schema。

## 结束前自检

1. 我能否画出 Course、PagePlan、Asset、Theme、QualityReport 的引用关系？
2. 我能否区分 PagePlanDraft 与 PagePlan 的生命周期？
3. 我新增一个字段时，是否能说明它被哪些消费者使用？
4. 我能否举例说明“合法数据”不等于“高质量课程”？
5. 我能否解释跨实体校验为什么应放在 Course 聚合边界？
