# Prompt Changelog

> 旧条目沿用当时的 Specialist/Agent 命名，仅用于历史审计。当前生产清单统一使用 Model Step，见 [`prompt-library.md`](./prompt-library.md)。

## 2026-07-30 — 首轮生成优先与 Agent 全局上下文

- Architect 系统 Prompt 接入 `course-design` Agent Skill、整课模板检索和受控资料摘录；统一 Skill Harness 会先完整注入核心说明，Agent 再按需读取目标证据或课程结构 reference。页面类型服从目标与课程弧线，不固定首页/末页序列。
- Page Builder 接入标准 `course-page-design` Agent Skill：同一 Skill Harness 按 Agent 注册配置加载核心说明，Agent 再通过 `read_local_resource` 按页面职责渐进读取固定画布或学习互动 reference；已读内容会进入 Page Writer 和 HTML Engineer 的真实结构化输入。
- Page Writer system/user 升级到 `3.0.0/3.0.0`，一次接收结构化 Brief、完整课程事实与规则、当前页面职责、相邻页面职责和已验收依赖摘要。
- HTML Engineer system 升级到 `2.8.0`，移除强制三块内容使用 `details/summary`、素材面积比例和固定 CSS 数值等创作型微规则；保留安全、DOM、播放器画布和无滚动合同，把构图判断交给按需加载的页面设计 Skill。
- Page QA system 升级到 `2.4.0`：质量分是观测目标，不单独触发 Gate 或 Repair；只有可定位、影响交付的具体错误进入 `error`。
- Reviewer 不再假设固定首页承诺与结尾形式，只检查课程实际提出的承诺是否在合适位置兑现。
- 模型 Schema 或业务错误不会伪装成可恢复工具失败反复调用；只有瞬时 Provider 故障允许 fallback 或受控重试。

## 2026-07-29 — Prompt 角色按真实运行方式命名

- Prompt Library 只保留生产工作流实际调用的八个 Model Step。
- 删除已无生产入口的 Intent、Course Planner、Supervisor 和 Single Page Prompt。
- 八个 System Prompt 只把角色名从 Agent 改为 Model Step，不改变输入输出合同；对应补丁版本各提升一次。

## 2026-07-27 — 课程页面固定画布与无滚动合同

- Intent system `1.3.0`、Planner system `2.4.0`、Page Writer system `2.3.0`、HTML Engineer system `2.4.0` 与 Page QA system `2.3.0` 统一按 `366×500`、`712×650`、`922×460` 固定播放器画布规划和生成内容。
- 自动课程长度会把单页容量计入章节数；定义、示例、练习和反馈无法在同一画布清晰呈现时，必须在规划阶段拆到相邻页面。
- 新生成 HTML 的 `html`、`body`、`main` 采用 100% 流式根画布；平台会写入稳定画布标记并覆盖模型遗留的固定根尺寸，旧课程仍保留原尺寸做 contain-fit。
- 浏览器 QA 关闭学习端 contain-fit 后再测量模型原始布局，并以主 `main` 的播放器视口覆盖率阻止“运行时缩小后看似合格”的页面通过。
- 浏览器 QA 新增文档及嵌套纵向溢出检查；不再把普通长知识页滚动视为合法，也禁止用裁切或极小字号伪装适配。

回滚方式：恢复上述五个 system Prompt 版本及旧的长页滚动规则，并移除 `BROWSER_VERTICAL_OVERFLOW`、`BROWSER_NESTED_VERTICAL_OVERFLOW` 检查。

## 2026-07-27 — 课程章节数改为内容驱动

- Intent system `1.2.0` 和 Course Planner system `2.3.0` 不再把课程限制在 3–12 节；明确的正整数节数会被保留，未指定时按知识依赖、练习与总结需要动态规划。
- 单页、双页微课使用合并教学职责；长课程继续按每 4 页至少一次主动练习的节奏扩展。
- Planner 与专业 brief 输出预算随真实章节数增长，逐页交接数组不再以 12 项截断。

回滚方式：恢复 CoursePageCount、CoursePlan、逐页 brief Schema 和对应 Prompt 的 3–12 限制。

## 2026-07-27 — 生图素材禁止烘焙文字

- Image Prompt system 升级到 `2.1.0`：背景安全区必须由连续场景自然形成，禁止生成白板、卡片、纸张、标签或其他文字容器。
- 生产 Prompt 将课程用途和视觉说明明确标记为不可渲染的语义元数据，并同时禁止中文、字母、数字、伪文字和乱码字形。
- Prompt 版本变化会使素材请求缓存失效；新生成课程不会复用旧的含文字素材。

回滚方式：恢复 Image Prompt system 2.0.0 和旧生产 Prompt；已有课程与素材记录无需迁移。

## 2026-07-24 — Page QA reveal 运行时边界

- Page QA system 升级到 `2.2.1`：明确 reveal、explore、sort 的互动项是可见可操作目标，不能误套 choice 反馈的初始隐藏规则。
- 运行层忽略与可信互动合同冲突的可见性判断，以及没有可授权定位的内容冗余 warning；对应维度没有其他证据时恢复到最低通过门槛。

回滚方式：恢复 Page QA system 2.2.0，并移除对应模型 issue 过滤；既有页面产物无需迁移。

## 2026-07-24 — Repair CSS 呈现问题定向修复

- Repair system 升级到 `1.4.0`：当运行层只授权 `style` 时，明确使用唯一 style 边界插入最小作用域 CSS。
- 禁止把 QA issue code 当作 selector 或 search，避免触控尺寸、首屏主操作等问题反复生成不可应用候选。

回滚方式：恢复 Repair system 1.3.0；RepairResult Schema 与既有 checkpoint 无需迁移。

## 2026-07-24 — HTML v2 运行时标记显式自检

- HTML Engineer user 升级到 `2.2.0`：在模型输出前显式列出 visual primitive、block target、interaction、question、option、submit 与 feedback 的运行时标记清单。
- 运行层只对唯一、可由现有语义结构和可信 DSL 证明的标记做机械规范化；不会创建教学内容、猜测多按钮目标或把素材/装饰图冒充代码原生图示。
- 严格预检把 visual primitive 限制在 main 内且排除素材子树，并把 choice 的提交、题目和 option 控件限制在对应 interaction/question 根节点。

回滚方式：恢复 HTML Engineer user 2.1.0，移除运行时标记规范化；共享 DSL 与既有成功页面无需迁移。

## 2026-07-24 — Repair DSL 输出协议与互动目标修复

- Repair system 升级到 `1.3.0`：明确 `dsl_candidate` 只能是 `kind` 的值，完整 DSL 必须放在唯一根字段 `candidate`，并补充合法 DSL 结果示例。
- `allowedContentFields` 可定向授权 `interaction`；只允许修复本页目标检查，必须保留互动类型与技术 ID。
- DSL Repair 的模型输入不再携带无关 HTML、视觉 brief 和素材结果，减少长页面恢复时的输入体积。

回滚方式：恢复 Repair system 1.2.0，并移除 interaction 根字段授权；既有 checkpoint 与 RepairResult Schema 无需迁移。

## 2026-07-24 — Repair 质量优先迭代与旁白定向修订

- Repair system 升级到 `1.2.0`：移除“最多两轮”的成本式描述，尝试序号只作为运行层安全熔断信息。
- 候选仍必须遵守授权 issue/scope、原产物合同和 re-QA；模型不能修改安全熔断条件或自行宣布通过。
- 当无 blocks 的 cover/sparse 页面把目标覆盖问题定位到 narration 时，运行层可只授权 `allowedContentFields=["narration"]`；其他 DSL 根字段仍保持不可修改。

本文件记录 Specialist Prompt 的可审计合同变化。组合版本格式为 `system/user`。

## 2026-07-24 · Page Writer 页面目标覆盖合同

### Page Writer · 2.2.1/2.2.0 active

- 每页 PageContentDSL 必须直接满足 `PagePlan.learningObjective`；“之后会学习”“将认识”等课程预告不再视为目标覆盖。
- cover 和 sparse 页面即使因模板约束保持 `blocks=[]`，也必须在 narration 中同时提供目标要求的最小核心事实与学习路径，不能为了视觉简洁删除事实。
- 练习页的题目、答案或评价标准必须检验本页目标，成功与重试反馈必须解释对应的判断依据和改进方向。
- 输入不足以提供目标事实时必须失败并交回运行层，不能用未来时占位或自行发明事实。

回滚方式：恢复 Page Writer system 2.2.0；PageContentDSL Schema、数据库和既有 checkpoint 无需迁移。

## 2026-07-24 · 播放器视口与 HTML 结构质量门槛

### HTML Engineer · 2.2.0/2.1.0 active

- 以播放器实际内容视口 `366×500`、`712×650`、`1080×600` 作为主要响应式目标；封面、测验和稀疏页面必须让核心说明与主操作形成首屏焦点。
- 禁止在整页根容器裁切内容，明确主要触控目标、教学层级与非后台面板式的视觉要求。
- 稳定标记升级为结构合同：`data-page-id` 直接标记唯一 main，block/asset/interaction 标记唯一、位于 main 内且保持 DSL 归属与顺序。

回滚方式：恢复 HTML Engineer system 2.1.1，并移除对应稳定 DOM 结构预检；PageContentDSL 与既有成功页面无需迁移。

### Page QA · 2.2.1/2.1.0 active

- 六维通过门槛改为质量优先配置，视觉风格和素材可用性不再因 HTML 合同有效而被忽略。
- 任一低于门槛的维度必须同时输出同维度可定位 issue，避免低分报告进入无法定向修复的死路。
- 排版与风格评估增加播放器实际视口、首屏任务焦点和“通用面板式课程页”识别要求。

回滚方式：恢复 Page QA system 2.1.4 和旧的四维工作流门槛。

## 2026-07-22 · Page Writer choice 输出回归修复

### Page Writer · 2.1.1/2.1.0 active

- 明确 choice 的 `items` 必须为空数组，`choiceOptions` 必须是一维字符串数组。
- 运行层只对 choice 的无意义 `items` 占位值和纯字符串选项的多余一层数组做确定性收敛；混合类型继续严格失败。
- Supervisor 在持久化决策前分别把公开摘要和停止原因限制为 300/500 字符，避免底层错误过长导致错误处理再次失败。
- 用户恢复曾命中该 Supervisor 摘要缺陷的检查点时，重新开放当前 Page Writer 阶段预算。

回滚方式：恢复 Page Writer system 2.1.0，移除对应 normalizeOutput、Supervisor 边界收敛和旧检查点定向恢复；共享 DSL Schema 无需迁移。

## 2026-07-22 · HTML DSL 正文恢复回归修复

- HTML Engineer 会把模型原样输出的可信 DSL 数学比较符转成安全实体，并只在已有唯一 main/block marker 内可见地恢复遗漏的标题、旁白、block 正文和 reveal prompt。
- reveal 模型输出只有普通卡片且没有 details 时，运行层把互不嵌套的唯一 block 根节点包装成原生 details/summary；未知或冲突结构继续失败。
- 用户明确从断点恢复非 Repair 的 `PAGE_WORKER_RETRY_EXHAUSTED` 页面时，重新开放该阶段的三次页面预算，同时保留上次错误作为结构化校验反馈。

以上是 HTML Engineer 2.1.1 的运行层兼容修复，不改变 Prompt 正文或共享持久化 Schema。

## 2026-07-22 · 专业设计结构化输出回归修复

### Pedagogy · 2.0.1/2.0.0 active

- 明确 learningProgression 必须包含 2–12 条递进，不能把整课压成一句概述。
- 当 Provider 已返回唯一一条合法递进时，运行层只使用可信 CoursePlan 首尾页面补齐第二条；空数组和其他非法结构继续失败。

### Story · 2.0.1/2.0.0 active

- 明确任何 narrativeMode 都必须返回 mission。
- 仅当 premise 与 learnerRole 已合法而 mission 缺失时，运行层用可信 CoursePlan 首尾页面补齐最小任务线；显式空值和其他损坏输出继续失败。

回滚方式：恢复两个 system Prompt 版本并移除对应 normalizeOutput；PedagogyPlan、StoryArc 和既有 checkpoint Schema 无需迁移。

## 2026-07-22 · HTML 互动合同回归修复

### HTML Engineer · 2.1.1/2.1.0 active

- 明确页面必须包含唯一 `main` 主内容区域，choice 单选或复选控件必须可操作且不得带 `disabled`。
- 确定性 HTML 预检同步执行上述约束，使结构错误进入同页 HTML 重试，而不是消耗后置 Repair 预算。
- 对曾因 `INTERACTIVE_OPTIONS_DISABLED` 重复属性无法唯一替换而耗尽两轮的旧检查点，只恢复一次 HTML 阶段并废弃两次无效 Repair 记录；其他失败检查点保持原预算。

回滚方式：恢复 HTML Engineer system 版本与上述两项预检，并移除旧检查点的定向恢复；已成功生成的页面无需迁移。

## 2026-07-22 · Day 33

### Planner · 2.2.0/2.2.0 active

- 保留完整的功能模板 ID/pageType allowlist，但详细模板上下文改为最多三个相关 Template Cards。
- 完整 Reference Packs 改为检索后的 Reference Hits；Prompt 只接收摘要、关键事实和稳定 pack/chunk ID，不接收原始 chunks。
- Page Writer 仍由运行层按 Planner 授权 ID 解析原始片段，模板和引用业务校验保持不变。

回滚方式：恢复 `functionalTemplatesJson/styleTemplateJson/referencePacksJson` 变量和 Planner 2.1.0 合同；Reference Pack 与 CoursePlan Schema 无需迁移。

### Supervisor · 1.1.0/1.1.0 active

- 每个运行层允许节点增加按 Agent/任务检索的有限 SkillCard 摘要。
- SkillCard 只说明适用场景和限制，不得增加候选节点、放宽前置输入或重置执行预算。

回滚方式：从 `SupervisorAvailableNode` 移除 skills 字段并恢复 Supervisor 1.0.0 Prompt；已持久化 SupervisorDecision 不受影响。

## 2026-07-16 · Day 27 本地回归修复

### Page QA · 2.1.2/2.1.0 active

- 明确六维摘要不得超过 300 字符，severity 只能使用 `info | warning | error`，每个 location 必须包含 description。
- 对仅支持 JSON object mode 的 Provider，运行层只收敛超长展示文本、常见 severity 同义词和缺失的定位描述；未知严重度、非法维度与 issue 引用继续严格失败。
- 同一规范化同时覆盖初次 QA 与 Repair 后 re-QA，不改变程序计算的总分、限分、shouldRepair 和 decision。
- 硬合同拥有的静态行为不再被模型重新解释为 Repair issue：success 参考反馈允许常显、批准素材 alt 必须原样复用，readingOrder 只比较声明的 blockId 相对顺序。

回滚方式：恢复 Page QA system 版本为 `2.1.0`，移除模型输出规范化与硬合同 issue 过滤；确定性启发式和报告计算无需迁移。

### Repair · 1.0.1/1.0.0 active

- HTML patch 增加受 selector scope 约束的标签边界插入操作；缺失结构不再用 `search` 匹配尚不存在的标签。
- `HTML_MAIN_MISSING` 使用 body 开、闭标签的一对定向插入包裹主体，仍禁止返回整页 replacement，应用后继续执行完整 HTML 合同与 re-QA。
- 省略 operation 时仍按 `replace` 解析，已有候选与 checkpoint 合同继续兼容。

回滚方式：恢复 Repair system 版本为 `1.0.0`，移除边界插入操作，并保留现有 `replace` patch 解析。

## 2026-07-16 · Day 27

### Repair · 1.0.0/1.0.0 active

- 将 Day 24 的合同草案激活为运行时 `RepairAgent`，输入必须通过 `RepairRequestSchema`，输出必须通过 `RepairResultSchema`。
- DSL 修复只能修改 QA 定位并由运行层授权的 blocks；页面身份、模板、互动、素材槽、布局提示和其余 blocks 保持不变。
- HTML 修复只返回带真实 issue code 的唯一匹配 search/replacement patches，不允许把完整页面重写塞入 replacement。
- 无法安全定位、范围冲突或需要上游素材时返回结构化 `declined`；不得伪造候选。
- 修复候选仍要通过原 DSL/HTML/asset 安全合同，并由运行层 re-QA；Repair 不能宣布通过或增加两轮预算。

回滚方式：将 Repair 注册项恢复为 `draft 0.1.0/0.1.0` 并从 Page Worker 移除 qa-repair-loop；保留旧 checkpoint 的可选 repairHistory 兼容解析。

## 2026-07-16 · Day 26

### Page QA · 2.1.0/2.1.0

- 六维语义明确映射为内容正确性、教学有效性、页面排版、视觉风格、HTML 质量和素材可用性。
- 输入增加课程概览与可选 Playwright 截图状态、固定视口指标和浏览器问题；没有浏览器证据时仍禁止声称像素级结论。
- 内容事实错误必须保持最高质量优先级，不能被视觉或其他维度高分抵消。
- 教学维度必须核对学习目标和前后页承接；风格维度必须逐项对照 `VisualBrief`。
- 每个问题继续要求明确位置和 `repairHint`；最终分数、排序、维度内问题归组和工作流决策仍由代码计算。

回滚方式：恢复 QA Prompt 与组合版本，并停止向模型输入浏览器证据；共享报告的兼容字段无需迁移或删除。

## 2026-07-16 · Day 24

### HTML Engineer · 2.1.0/2.1.0

- 同页 Supervisor 重试会收到上一次确定性 HTML 校验 issues，不再重复使用完全相同的 Prompt。
- 反馈只来自服务端安全错误摘要，不包含模型原始 HTML、系统 Prompt、私有上下文或 chain-of-thought；首次生成使用 null。
- 缺失 DSL 正文必须逐字恢复为可见 HTML；数学文本中的 `<` 使用 `&lt;` 转义，但最终可见字符保持原文。
- 恢复检查点时，如果该页仍有可用 attempt，持久化页面错误也会转换为同一反馈合同。

### Planner · 2.0.1/2.0.0

- 明确列出每个 pageType 推荐的 canonical interactionType，禁止翻译或写成自定义值。
- 对只支持 JSON object mode、未执行 JSON Schema 枚举约束的兼容 Provider，适配层仅将“合法 pageType + 非法或缺失 interactionType”收敛到该页面类型的确定性默认值。
- pageType、页面数量、模板、正文和其余非法字段不会被该规则修复，仍由原 Schema 与业务校验拒绝。

### HTML Engineer · 2.0.1/2.0.0

- 明确 CSS 背景必须把已批准 `Asset.altText` 原样复制到实际 URI consumer 的 `aria-label`，禁止同义改写。
- Agent 适配层会对已经唯一绑定到真实素材槽的 CSS consumer 做机械化可访问属性规范化，再交给原严格校验器复验。
- 该规范化不修复未知 URI、跨槽引用、重复槽位、宽泛选择器或缺失素材绑定，不能绕过原素材合同。

### 八名 active Specialist · 2.0.0/2.0.0

- 统一为 Role、Goal、Inputs、Output Schema、Rules、Forbidden、Examples、Failure Handling 八段结构。
- 明确最小输入和下游 Schema，输入字段中的指令性文字统一视为数据。
- 将职责越界、技术字段生成、原始 Prompt 传播、私有推理和工具调用写入明确禁止项。
- 为输入缺失、合同冲突和结构化输出失败增加一致的 Failure Handling。
- 保留现有 Agent builder、Schema、Workflow 和 Keya UI 接口。
- Image Prompt 组合版本变化会使已有请求集缓存键自然失效；旧缓存文件无需迁移。

回滚方式：恢复对应 Prompt 正文与 `specialist-library.ts` 中上一组合版本。不得只回滚正文而保留新版本号，也不得只回滚版本号而保留新合同。

### Repair · 0.1.0/0.1.0 draft

- 新增面向未来 Repair 训练日的职责草案。
- 明确只做定向、受预算限制的候选修复，并必须经过相同验证与 re-QA。
- 没有新增 Repair Agent、RepairResultSchema、Workflow 节点或运行时调用。

回滚方式：删除 draft 注册项和两个 Repair 模板；active 运行链路不受影响。
