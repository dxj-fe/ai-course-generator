# Day 11：Pedagogy + Story + Visual Planning

## 今日完成内容

- 新增 `PedagogyPlanSchema`，显式约束年龄适配、知识递进、互动节奏、常见误区、无障碍策略和逐页教学指导。
- 新增 `StoryArcSchema`，描述叙事强度、学习者角色、任务线、角色、逐页节拍、转场和连续性规则。
- 新增 `VisualBriefSchema`，引用真实 `StyleTemplate`，约束全局视觉概念、排版、素材、动效、无障碍规则和逐页构图。
- 实现一步 `PedagogyAgent`、`StoryAgent` 和 `VisualDirectorAgent`，每个 Agent 只有一个专业职责和独立失败边界。
- 实现串行工作流 `CoursePlan → Pedagogy → Story → Visual`；任一 Agent 失败时不会继续产生无效调用。
- 三个 brief 必须按相同 `pageId` 顺序覆盖 CoursePlan，并被投影为逐页 `PageWorkerBrief`。
- 新增 `POST /api/courses/design`，直接接收 Day 10 已生成的 CourseIntent 和 CoursePlan，不重复执行 Planner。
- 前端增加“教学设计 / 故事设计 / 视觉设计”三个可访问 Tab、专业 Agent Timeline 和 Page Worker 交接协议检查器。
- Agent Timeline 只记录开始、模型调用、完成和错误摘要，不返回 Prompt 正文或私有推理过程。

真实模型验收暴露了一个 OpenAI-compatible 输出兼容问题：模型会把 `misconceptions` 和 `characters` 的对象数组压缩为字符串数组。实现允许模型层暂时接收两种形状，随后由确定性代码补齐最小语义，再交给严格的 `PedagogyPlanSchema` / `StoryArcSchema` 复验；这种兼容只存在于模型适配层，不会放宽共享领域协议。

## 职责边界与数据流

| 节点 | 负责 | 不负责 | 输出 |
| --- | --- | --- | --- |
| Course Planner | 全局目标、页面顺序、页面类型、依赖和模板引用 | 具体教学脚手架、故事、视觉构图、HTML | `CoursePlan` |
| Pedagogy Agent | 年龄适配、认知递进、互动频率、误区和理解检查 | 角色剧情、颜色、布局、HTML | `PedagogyPlan` |
| Story Agent | 学习者角色、任务线、跨页节拍和转场 | 修改学习目标、选颜色、输出页面正文或 HTML | `StoryArc` |
| Visual Director | 引用 StyleTemplate，给出视觉、素材、构图、动效与无障碍原则 | 复制 Token 值、改教学目标、生成 HTML | `VisualBrief` |
| Page Worker | 消费某一页的 PagePlan 与三个逐页指导 | 重新规划整门课程 | `PageContentDSL`（Day 12） |

三个 Agent 采用串行而非并行：Story 需要遵守 Pedagogy 的教学节奏，Visual 需要同时理解教学重点和叙事焦点。`pageId` 与 `styleTemplateId` 不交给模型创造，而由确定性代码从 CoursePlan 补齐；这样可以把模型能力集中在专业语义上，同时保持系统引用稳定。

## 当天结束前复盘：面试题与详细答案

### 1. 为什么教育类生成项目需要 Pedagogy Agent？

**参考答案：**

通用大模型可以生成“看起来像课程”的内容，但课程质量不仅是事实正确和表达流畅，还包括学习目标是否适龄、知识是否递进、认知负荷是否合理、互动是否真正检查理解，以及错误认识如何被纠正。这些要求跨越整门课程，不能只靠每个页面 Worker 临时判断。

Pedagogy Agent 把这些隐含的教学判断变成一个可校验、可审查的 `PedagogyPlan`。在本项目中，它显式输出：

1. `ageAdaptation`：阅读水平、语气、解释深度和内容分块方式。
2. `learningProgression`：从已有知识到理解、应用的全局递进。
3. `interactionCadence`：互动间隔和允许的最大连续被动页面数。
4. `pageGuidance`：每页认知层级、脚手架、互动目的和理解检查。
5. `misconceptions`：常见误区与纠正策略。
6. `accessibilityStrategies`：不能等到 HTML 阶段才补救的无障碍原则。

如果没有这个节点，页面可能单独都正确，但组合后出现难度跳跃、重复解释、测验先于教学、连续多页被动阅读等系统性问题。独立 Pedagogy Agent 还让团队可以单独评估教学质量：当课程“不好学”时，能判断是教学规划问题，而不是把责任混在故事、视觉或 HTML 中。

**面试追问：所有产品都要单独做一个 Pedagogy Agent 吗？**

不一定。单页知识卡或简单文案可以在一个结构化调用内完成。只有当课程具有多页、明确受众、学习目标、难度递进和互动闭环时，独立教学规划的收益才明显。是否拆分应由职责、上下文和可独立评估性决定，而不是为了增加 Agent 数量。

### 2. Story Agent 和 Visual Director Agent 分别解决什么质量问题？

**参考答案：**

Story Agent 主要解决“跨页是否连贯、学习者为什么继续”的问题。它通过学习者角色、任务线、逐页节拍和章节转场，让页面不是一组互不相关的百科卡片。例如太阳系课程可以让学习者作为观察员逐步完成任务，但故事不能改变教学目标，也不能为了戏剧效果添加未经验证的知识。

Visual Director 主要解决“跨页是否像同一个产品、重要信息是否被正确突出”的问题。它把 CoursePlan、PedagogyPlan 和 StoryArc 转换为统一的视觉概念、布局原则、素材方向、动效和逐页焦点，并通过 `styleTemplateId` 引用 Day 9 的真实设计 Token。它不复制颜色值，也不直接生成 HTML，因此后续多个 HTML Engineer 仍能在共同视觉约束下自由实现。

两者的边界可以用一个问题区分：

- “这一页在整段学习旅程中发生什么、如何进入下一页？”属于 Story Agent。
- “这一页优先看哪里、用什么构图和素材表达？”属于 Visual Director。

如果混在一起，故事情节容易绑死布局，视觉修改也可能无意改变叙事或教学任务。拆分后可以分别检查故事连贯性和视觉一致性，并对单一质量维度进行重试。

### 3. 为什么“多 Agent 职责拆分”不等于简单多调用几次模型？

**参考答案：**

多调用只是执行次数增加；职责拆分要求每个节点拥有明确输入、独立输出协议、禁止事项、失败归因和下游消费者。否则把同一个宽泛 Prompt 连续调用三次，仍然只是一个模糊流程，结果之间容易覆盖和冲突。

本项目的三个专业 Agent 具备以下可验证边界：

- 各自使用独立 Zod Schema 和版本化 Prompt。
- Pedagogy 只产生教学语义；Story 只产生叙事语义；Visual 只产生视觉语义。
- 后一步接收前一步已经校验的结果，工作流能定位具体失败节点。
- 三份结果通过 `pageId` 和 `styleTemplateId` 与 CoursePlan 对齐。
- Page Worker 只接收自己页面的最小投影，而不是整份无边界上下文。

因此价值来自可组合协议和质量归因，而不是“Agent”这个名称或模型调用数量。实际系统中，一个确定性函数也可以是工作流节点；只有需要语义判断的部分才交给模型。

### 4. 为什么当前工作流选择串行，而不是三个 Agent 并行？

**参考答案：**

并行可以降低延迟，但前提是任务之间没有语义依赖。Day 11 中存在真实依赖：Story Agent 应遵守 Pedagogy 的知识递进和互动目的，避免剧情干扰理解；Visual Director 应同时知道每页的教学重点和故事节拍，才能决定视觉焦点。因此当前顺序是：

`CoursePlan → PedagogyPlan → StoryArc → VisualBrief`

串行的代价是总延迟约等于三次调用之和。可以优化但不能盲目并行：例如先让 Pedagogy 和一个只看 CoursePlan 的初版 Story 并行，再增加合并/冲突解决节点；但这会增加一次调用和合并复杂度。当前只有 3–12 页，优先保证输出一致性，串行是更简单、可解释的选择。

如果未来监控发现延迟不可接受，可以通过缩短 Prompt、缓存相同 CoursePlan 的 brief、使用更小的规划模型，或验证 Pedagogy 与 Story 是否能安全并行来优化。性能改造应由实际依赖和指标决定。

### 5. 如何防止 Story Agent 为了“有趣”而破坏教学质量？

**参考答案：**

不能只在 Prompt 中说“不要跑题”，需要协议和后置校验共同限制：

1. Story Agent 输入已经包含 CoursePlan 和 PedagogyPlan，叙事必须服务真实页面目标。
2. `narrativeMode` 支持 `none`、`light`、`full`，严肃主题不必强行游戏化。
3. 每个 `pageBeat` 绑定真实 pageId，数量和顺序必须与 CoursePlan 完全一致。
4. Story Schema 不包含学习目标、视觉 Token 或 HTML 字段，因此无法合法覆盖这些状态。
5. `continuityRules` 明确记录“不添加新核心知识”等跨页约束。
6. Page Worker 同时消费 Pedagogy 和 Story；发生冲突时，教学目标和事实正确性优先。

还应建立 bad cases，例如医疗安全、AI 伦理或历史事件等不适合夸张剧情的主题，比较叙事是否保持克制。Schema 能防止结构越权，但“故事是否喧宾夺主”仍需要语义评估和人工抽样。

### 6. VisualBrief 为什么引用 StyleTemplate，而不是复制完整颜色和字体 Token？

**参考答案：**

StyleTemplate 是设计系统的单一事实来源。如果 VisualBrief 复制颜色、字体、间距等具体值，就会形成第二份可漂移状态：设计 Token 更新后，旧 brief 仍保留过期值；模型还可能生成非法颜色或不一致的字号。

本项目只在 VisualBrief 保存 `styleTemplateId` 和“如何使用”的语义指导。HTML Engineer 在执行时从 Registry 读取最新 Token，并通过 CSS Variables 应用。这种引用方式带来：

- 一致性：所有页面解析同一套 Token。
- 可维护性：修改 StyleTemplate 即可统一更新视觉表现。
- 可验证性：Registry 能检查 ID 是否真实存在。
- 更小上下文：Page Worker 不必重复接收整套 Token。
- 职责清晰：Visual Director 决定视觉方向，设计系统决定具体值。

为防止模型绕过边界，`VisualBriefSchema` 会拒绝十六进制颜色值，工作流还校验 styleTemplateId 必须等于 CoursePlan 中唯一的真实模板 ID。

### 7. 三个独立 brief 如何保证始终与同一份 CoursePlan 对齐？

**参考答案：**

关键是稳定 ID 和确定性投影，而不是按标题或数组位置进行模糊匹配。当前实现采用四层约束：

1. 模型只按 CoursePlan 顺序返回逐页语义，不负责创造 pageId。
2. Agent 代码根据数组位置补入 CoursePlan 的真实 pageId，并检查数量一致。
3. 工作流再次验证三个逐页数组都以完全相同的顺序覆盖全部 pageId。
4. 最终按 pageId 组装 `PageWorkerBrief`，每一页同时包含自己的 pedagogy、story、visual 指导和共享 styleTemplateId。

如果 Planner 发生版本变化，旧 brief 不应静默复用。生产系统还应给 CoursePlan 加版本或内容哈希，将其写入缓存键；页面增加、删除、换序或目标变化后，重新生成受影响的专业 brief。

### 8. 一个专业 Agent 失败时，应该整体失败还是降级继续？

**参考答案：**

取决于输出是否为后续节点的必要前置条件。当前 Day 11 采用 fail-fast：Pedagogy 失败就不调用 Story；Story 失败不调用 Visual；任何失败都不产生 PageWorkerBrief。原因是三者存在串行语义依赖，继续调用会制造看似完整但上下文缺失的结果，还会浪费模型成本。

生产环境可以设计显式降级，但必须让降级成为协议的一部分。例如：

- 教学规划通常是必需项，失败应阻止内容生成。
- 对不需要叙事的课程，可以由策略明确选择 `narrativeMode: none`，而不是在 Story 失败后假装成功。
- Visual Director 暂时失败时，可以在产品允许的情况下使用 StyleTemplate 的默认 visual brief，但结果必须标记为 degraded，不能与完整成功混淆。

无论选择失败还是降级，都应记录公开错误码、失败 Agent、traceId 和可操作摘要，不记录私有推理链。重试也应按节点进行，避免重新执行已经成功且输入未变化的步骤。

## 验收结论

- Schema、Agent 和工作流测试覆盖合法结果、颜色 Token 泄漏、无叙事模式、串行顺序、失败短路和 pageId 漂移。
- 长结构化输出使用 60 秒单次调用预算；普通文本仍保持 30 秒预算，避免 Pedagogy 等正常生成过程在 30 秒边界被误判为超时。
- 超时修复后用真实模型回归 `/api/courses/design`：三个专业 Agent 全部完成，共返回 9 条事件；服务端日志确认三次结构化调用均使用 `timeoutMs: 60000`。
- 前后端共享 `CourseDesignBriefs` 与 `PageWorkerBrief` 类型。
- 三个 Agent 均只产生自己的结构化 brief，不生成 HTML。
- VisualBrief 只引用 Registry 中真实的 StyleTemplate。
- UI 能查看三个专业 Tab、九条公开事件和逐页 Page Worker 交接结果。
- 真实模型完成 5 页太阳系验收：三个 Agent 均为 completed，Timeline 共 9 条事件，三个 Tab 各显示 5 条逐页指导，Page Worker 交接为 5 页且统一引用 `sci-fi` StyleTemplate；浏览器控制台无错误。
