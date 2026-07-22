# Agent Retrieval Registry

该目录由 `src/server/tools/retrieval-card-registry.ts` 的类型化定义生成。运行时定义是事实来源。

## Tools

### retrieveSkillDocsSkill (retrieve-skill-docs)

按 Agent 名称和当前任务查询可用能力及其边界。

- When to use: Supervisor 或 Specialist 需要确认当前可用能力时
- Input: agentName、task，以及不超过 3 的 limit。
- Output: 按相关度排序的 SkillCard 与匹配原因。
- Limitations: 只查询已注册能力；不能使非法工作流节点变为可执行

### retrieveTemplateCardsSkill (retrieve-template-cards)

按页面目标查询功能模板和样式模板的短摘要。

- When to use: Planner 需要为页面目标选择结构或视觉方向时
- Input: pageGoal，可选 audience、visualStyle 和 limit。
- Output: 最多 3 个功能模板和 3 个样式模板 Card。
- Limitations: 不返回完整模板定义；最终模板 ID 仍由业务校验确认

### retrieveReferenceSkill (retrieve-reference)

从当前任务的 Reference Packs 中查询可追踪资料片段。

- When to use: Planner 需要为课程页面选择事实来源时
- Input: query，以及不超过 3 的 limit。
- Output: 匹配资料摘要、关键事实及稳定 pack/chunk ID。
- Limitations: 不返回原始完整文件；只查询当前任务已经校验的资料

### generateImageAsset (generate-image-asset)

根据 ImagePromptAgent 的请求生成单张页面视觉素材。

- When to use: 页面存在经过校验的图片素材槽时
- Input: pageId、altText 和 AssetRequest。
- Output: 真实图片 Asset 或确定性的 CSS/SVG/占位 fallback。
- Limitations: 不生成整页 UI；失败不能阻塞页面文字与 HTML

## Skills

### 课程意图解析 (interpret-course-intent)

把用户课程需求转换成严格的 CourseIntent。

- When to use: 课程尚未生成类型化意图时
- Input: 用户提示和可选运行取消信号。
- Output: 经过 CourseIntentSchema 校验的课程意图。
- Limitations: 不规划页面；不生成课程正文

### 课程结构规划 (plan-course)

把 CourseIntent 转换为具备学习节奏的 CoursePlan。

- When to use: 课程意图已校验但尚无页面规划时
- Input: CourseIntent、模板 Card 和可选 Reference Hit。
- Output: 3–12 页 CoursePlan 和页面级资料引用。
- Limitations: 不生成页面正文；不能编造模板或资料 ID

### 课程专业设计 (design-course)

生成教学、故事、视觉 brief 和 Page Worker handoff。

- When to use: CoursePlan 已完成且页面执行尚未开始时
- Input: CourseIntent 和 CoursePlan。
- Output: CourseDesignBriefs 与逐页 PageWorkerBrief。
- Limitations: 不生成最终 DSL、图片或 HTML

### 页面工作流执行 (run-page-worker)

按 Writer、Assets、HTML、QA 和有限 Repair 顺序生成页面。

- When to use: 页面依赖满足且页面尚未完成时
- Input: 页面计划、专业 brief、课程状态和引用授权。
- Output: 页面 DSL、素材、HTML、QA 报告及修订记录。
- Limitations: 必须遵守页面级预算；页面状态只能通过运行层合并

### 页面内容写作 (write-page-content)

为单个 PagePlan 生成符合功能模板的 PageContentDSL。

- When to use: 页面计划和 PageWorkerBrief 已就绪时
- Input: CourseIntent、PagePlan、PageWorkerBrief 和授权资料片段。
- Output: 经过 PageContentDSLSchema 校验的单页内容。
- Limitations: 不生成 HTML；只能使用 Planner 授权的资料 chunks

### 页面素材解析 (resolve-page-assets)

为页面素材槽解析真实图片或安全 fallback。

- When to use: PageContentDSL 包含素材槽时
- Input: PageContentDSL、VisualBrief 和 StyleTemplate。
- Output: 按素材槽对应的 AssetGenerationResult。
- Limitations: 不把文字烘焙进图片；供应商失败必须可降级

### 页面 HTML 工程 (engineer-page-html)

把 DSL、模板、视觉 brief 和素材编译为安全 HTML。

- When to use: 页面 DSL 与素材阶段已经完成时
- Input: PageContentDSL、模板、视觉 brief、素材和校验反馈。
- Output: 通过合同与安全预检的完整静态 HTML。
- Limitations: 不能改变 DSL 教学语义；不得放宽 sandbox 边界

### 页面质量评估 (evaluate-page-quality)

结合确定性证据和语义评分生成六维 QualityReport。

- When to use: 页面 HTML 已生成，需要决定是否修订时
- Input: 页面计划、DSL、HTML、brief、素材和可选浏览器证据。
- Output: 六维评分、可定位问题和 shouldRepair 决策。
- Limitations: 只报告问题；不能直接修改页面产物

### 页面定向修订 (repair-page)

根据可定位 QA 问题对 DSL 或 HTML 进行有限修订。

- When to use: QualityReport 要求修订且仍有 Repair 预算时
- Input: RepairRequest、当前页面产物和可定位问题。
- Output: 限定范围的修订候选或结构化拒绝。
- Limitations: 最多两轮；必须重新校验并执行 re-QA
