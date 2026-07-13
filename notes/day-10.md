# Day 10：Course Planner Agent

## 今日完成内容

- 扩展 `PagePlanSchema`，加入 `interactionType` 和规划阶段的 `assetNeeds`。
- 新增 `CoursePlanSchema`，约束 3–12 页和“引入—讲解—互动—总结”节奏。
- 实现版本化 Course Planner System/User Prompt。
- 实现一步 `CoursePlannerAgent`，输入 `CourseIntent`，输出结构化 `CoursePlan`。
- 使用 Functional/Style Registry 校验模板 ID、pageType 和全课程样式一致性。
- 新增 `POST /api/courses/plan`，既可接收一句话，也可直接接收 CourseIntent。
- 前端新增 CourseOutlinePanel、PagePlanList、公开 Agent Timeline 和五个主题入口。
- 为太阳系、火星探险、垃圾分类、AI 素养、古诗入门建立固定测试与观察点。

## 字段映射决定

手册中的 `pageGoal`、`keyMessage` 和 `dependsOn` 与 Day 07 已有字段语义重合。本项目不制造重复状态，而是采用以下映射：

| 手册概念 | 当前协议 |
| --- | --- |
| `pageGoal` | `learningObjective` |
| `keyMessage` | `contentSummary` |
| `dependsOn` | `dependsOnPageIds` |
| `interactionType` | Day 10 新增字段 |
| `assetNeeds` | Day 10 新增字段 |

`assetNeeds` 表达后续需要生成或检索的素材，`assetIds` 只引用已经存在的 Asset，因此两者不能合并。

## 真实模型 bad case 与修复

第一次浏览器验收中，模型把 `overview` 输出为对象、把 `pageType` 翻译成自创值，并遗漏 `title`、`assetIds` 等技术字段，导致 Zod 校验失败。第二次收紧 Prompt 后，问题只剩素材 `type/role` 被自然语言化。

最终方案不是继续堆叠 Prompt，而是重新划分责任：

- 模型只输出 overview、learningObjectives，以及每页的 pageType、title、learningObjective、contentSummary、interactionType、素材 purpose/required。
- 确定性代码生成页面 ID、order、依赖、功能模板 ID、统一样式 ID、素材 type/role、空 assetIds 和 planned 状态。
- 页面按引入、讲解、互动、总结四个阶段稳定排序。
- 最终结果再次通过 CoursePlanSchema 和 Registry 业务校验。

修复后的真实模型调用成功生成 5 页太阳系课程，Agent Timeline 为 `start → model_call → finish`，页面顺序为封面、故事导入、知识卡、测验、总结。

## 当天结束前复盘：面试题与详细答案

### 1. Course Planner Agent 为什么不能同时负责 HTML 生成？

**参考答案：**

课程规划和 HTML 生成的优化目标不同。Planner 关心课程目标、页面顺序、依赖关系、教学节奏和跨页一致性；HTML Engineer 关心单页内容如何变成安全、可访问、响应式的界面。如果把两者放进一次模型调用，会产生以下问题：

1. 上下文同时包含全局课程信息和大量实现细节，模型更容易顾此失彼。
2. 规划错误只有在昂贵的 HTML 已经生成后才暴露，重试成本高。
3. 很难判断失败来自教学结构还是页面实现，日志和评估无法准确归因。
4. 单页修复可能意外改变全局课程结构，缺少稳定中间协议。
5. 多页 HTML 输出很长，更容易截断并超过 token 或超时预算。

本项目让 CoursePlannerAgent 只输出 `CoursePlan`，并明确禁止 `htmlOutput`、非空 `assetIds` 和完整页面文案。规划通过后，后续 Agent 可以按 PagePlan 独立生成页面。Planner 失败时只重跑一次结构化规划，不会浪费素材或 HTML 生成成本。

**面试追问：这算 Agent 还是 Workflow？**

当前实现更接近受约束的 Agent Workflow 节点：模型负责在协议边界内做规划判断，执行流程只有一次结构化调用。它不需要为了“像 Agent”而引入无意义循环；当未来加入检索、质量评估和定向重规划时，再扩展循环或条件分支。

### 2. 如何判断生成的课程大纲是否具有教学连贯性？

**参考答案：**

连贯性不能只看页面标题是否顺眼，需要同时检查目标、先修关系、认知难度和练习闭环。

- 目标对齐：每个页面的 `learningObjective` 能映射到全局目标，不能出现无关页面。
- 顺序合理：先激活已有知识，再解释新概念，然后练习和总结。
- 依赖正确：页面只依赖已经出现的前置页面，不能前向引用或循环依赖。
- 难度递进：内容从识别、理解逐步走向应用或判断，避免难度突然跳跃。
- 互动有依据：测验必须检查前面教过的内容，而不是引入新核心知识。
- 总结闭环：最后一页回扣目标和关键消息，不继续扩展新的主知识点。

本项目把其中可形式化的部分放进 Schema：第一页必须是引入类型，最后一页必须是 summary，至少存在知识讲解和主动交互页面，order 连续且依赖只能向后指向前页。剩余语义质量应由固定 bad cases、人工观察点和后续 Pedagogy/Quality Agent 评估。

### 3. 为什么 `assetNeeds` 和 `assetIds` 应该分开？

**参考答案：**

它们属于素材生命周期的不同阶段：

- `assetNeeds` 是规划意图，描述素材类型、语义角色、用途以及是否必需，例如“需要一张建立火星环境的 hero illustration”。
- `assetIds` 是持久化引用，指向已经生成、上传或从素材库选择的 Asset 实体。

如果 Planner 直接填写 `assetIds`，它只能编造尚不存在的 ID；如果只保留 `assetNeeds`，HTML Agent 又无法稳定引用真实资源。因此合理流程是：Planner 产生 assetNeeds → Asset Agent 解析需求并创建 Asset → 编排层把真实 ID 写入 assetIds → HTML Agent 消费 Asset URI。

分开后还可以准确表达素材失败和降级：可选素材失败时保留空 assetIds 并使用 CSS fallback；必需素材失败时页面保持 planned/failed，不会误以为资源已经就绪。

### 4. 如何避免模型生成不存在的模板 ID？

**参考答案：**

只在 Prompt 中写“不要编造”不够，因为 Prompt 是软约束。需要多层防线：

1. 生成前只把 Registry 中允许的 `{id, pageType, goal}` 候选传给模型，缩小选择空间。
2. Structured Output 先校验字段类型、页面顺序和基本格式。
3. 生成后使用 `getFunctionalTemplate()` 检查 ID 是否真实存在。
4. 同时校验模板的 `pageType` 与 PagePlan.pageType 相同，防止合法 ID 被错误使用。
5. Style Registry 根据 CourseIntent 预先选择唯一 style ID，所有页面必须使用同一值。
6. 单元测试覆盖 unknown ID、pageType 不匹配和 style 漂移。

这体现了 AI 工程中的重要原则：模型负责提出候选，确定性代码负责验证系统不变量。即使模型偶尔偏离 Prompt，也不能让非法引用进入下游。

### 5. 页面依赖为什么应该形成有向无环图？

**参考答案：**

依赖边表示“生成或学习当前页面前，需要先完成哪些页面”。方向来自前置页面指向后续页面，因此它天然应该是 DAG。

如果存在环，例如 A 依赖 B、B 又依赖 A，两页都无法进入可执行状态；如果允许依赖后面的页面，学习者会在知识尚未建立时完成练习，页面并行调度也无法判断谁先运行。

当前项目采用比通用 DAG 检测更简单的课程序列规则：`dependsOnPageIds` 引用的页面索引必须小于当前页面索引。只要所有边都指向数组前方，就不可能出现环，同时也能保持课程阅读顺序清晰。未来允许分支课程时，可以保留 DAG 规则，再使用拓扑排序生成执行批次。

### 6. Planner 应该使用一次结构化调用，还是完整 Agent Loop？

**参考答案：**

应该根据任务是否需要多步观察和动作来决定，而不是默认所有 AI 功能都使用循环。

当前 Planner 的输入完整、工具候选有限、输出协议明确，一次结构化调用即可完成任务。项目仍复用 `createMinimalAgent()`，是为了统一 AgentState、step budget、取消信号和 Timeline，而不是让模型重复调用自己。

当出现以下需求时，完整循环才有价值：

- Planner 需要检索课程资料或模板后再继续规划。
- 质量评估返回具体问题，需要定向修改部分 PagePlan。
- 课程长度较大，需要分段规划并合并。
- 模型必须根据工具执行结果选择下一步动作。

即使引入循环，也要设置最大步骤、停止条件和重试预算。循环不是质量保证；没有新观察结果的重复调用只会增加成本和不确定性。

### 7. Schema 校验通过是否代表课程规划质量合格？

**参考答案：**

不代表。Schema 主要证明结构和局部不变量成立，例如字段齐全、枚举合法、页数正确、order 连续、依赖有效、模板 ID 存在。它无法证明：

- 知识是否事实正确。
- 学习目标是否适合目标年龄。
- 页面之间是否真的有认知递进。
- 互动是否检查了前面讲过的内容。
- 素材需求是否有助于理解，而不是装饰堆砌。
- 大纲是否遗漏用户的 mustInclude 或违反 avoid。

因此验收需要分层：Schema/Registry 负责机器可验证的协议正确性；五个固定主题和 bad cases 检查稳定行为；Pedagogy/Quality Agent 评价教学连贯性；浏览器 UI 验证结果是否能被人理解和审查。Schema 是质量门槛，不是最终质量结论。

### 8. 如何为 Course Planner 设计可重复的 bad case 回归集？

**参考答案：**

bad case 应保存“输入、预期不变量、失败现象和版本信息”，而不只是保存一份模型输出。推荐至少覆盖：

1. 未指定页数：应默认 5 页。
2. 页数越界：2 页或 30 页需求应被 Intent 收敛到 3–12。
3. 强制输出 HTML：Planner 仍只能返回结构化 CoursePlan。
4. 要求使用不存在模板：最终输出必须被 Registry 拒绝或改用合法模板。
5. 循环依赖诱导：任何 dependsOn 都只能引用前页。
6. 只有讲解没有互动：CoursePlanSchema 应拒绝。
7. 总结页引入新知识：结构可能通过，但教学质量观察应失败。
8. Prompt injection：不得泄露系统提示词或私有推理。

每条记录应包含 `caseId`、输入、Intent、预期页数、必须/禁止 pageType、关键断言、promptVersion、model、结果和失败原因。修改 Prompt 后要运行同一批用例，比较通过率、Schema 失败率、平均耗时和 token 成本。只有目标 bad case 改善且原有正常案例没有回归，才能认为修改有效。

## 五个固定主题的验收观察点

1. 太阳系：包含基础知识和 quiz，行星概念逐步展开。
2. 火星探险：使用任务/故事语义，包含 achievement 或明确行动挑战。
3. 垃圾分类：包含 comparison 和互动判断，最终形成可执行行为目标。
4. AI 素养：专业风格映射为 minimal，难度适合受众，覆盖负责任使用。
5. 古诗入门：包含情境或知识讲解、意境素材需求和总结，不生成完整讲稿。
