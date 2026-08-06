# 网页演示模板按需匹配方案

## 结论

不要把调研到的五套上游 Skill 同时注册为产品 Skill，也不要为课程页面再造一套视觉系统。项目已经有与上游当前版本一致的 `frontend-slides`，并且课程 Page Builder 已经把它作为视觉设计方法使用。正确方向是：

1. 保留 `frontend-slides` 作为唯一演示视觉 Skill。
2. 把其他来源隔离为研究快照，只提炼互补的方法、分类和质量门。
3. 把“主题直接对应模板”的关键词匹配，升级为“学习意图画像 → 硬约束过滤 → 多维评分 → 三候选预览 → 选择与验收”的可解释匹配体系。
4. 保持“课程叙事、页面功能、视觉风格、运行时实现”四层分离。一个视觉模板不能决定课程结构，一个学科也不应永远绑定一种颜色或风格。

方案已经完成第一期产品落地：8 个生产风格拥有统一画像，确定性匹配器同时驱动 Architect 检索和 `/templates` 匹配实验室；课程生成保留功能模板与视觉模板分层，并增加代码原生图形兜底、跨语言内容门禁和多视口验证。12 个安全预设、34 个 bold 配方和 5 个学术主题仍作为下一阶段的候选目录，不会因为研究文件存在就自动进入生产合同。

## 一、调研结果

GitHub Star 快照日期为 2026-08-05。Star 用于判断社区信号，但许可证、能力互补性和与本项目的适配度拥有更高优先级。完整版本和路径记录见 `resources/research/web-presentation-skills/manifest.json`。

| 来源 | Star | 许可 | 采用内容 | 处理方式 |
| --- | ---: | --- | --- | --- |
| `zarazhangrui/frontend-slides` | 26,962 | MIT | HTML 演示、固定舞台、三预览选风格、12 个安全预设、34 个 bold 模板 | 已存在且与上游一致，继续作为唯一活动 Skill |
| `nexu-io/codex-slides` | 759 | MIT | 结构化需求、场景路由、灵感排序、品牌系统、持久状态、双信号验收 | 研究快照，不接入其产品运行时 |
| `ryanbbrown/revealjs-skill` | 380 | MIT | Reveal.js 页面组织、纵向深入、图表布局、溢出检测、逐页截图检查 | 研究快照，只提炼方法 |
| `zouchenzhen/thesis-defense-pptx-skill` | 212 | Apache-2.0 | 来源素材清单、模板继承、占位符扫描、可编辑性和视觉质量门 | 研究快照，只提炼方法 |
| `Noi1r/powerpoint-skill` | 106 | MIT | 学术演示教学法、5 套主题、21 种布局、公式/图表能力、量化 QA | 研究快照，只提炼方法 |

未纳入的高 Star 项目也很重要：Reveal.js、Slidev、Marp、Presenton 是演示引擎而非 Agent Skill；Anthropic `pptx` 的许可证不允许在本项目中留存或派生；K-Dense 的科研 Skill 集合体量很大且与已选学术来源重叠；`academic-pptx-skill` 的仓库许可证与 SKILL.md 声明冲突，暂不保存。

## 二、项目当前状态与真实缺口

### 已有能力

- `resources/agent/skills/frontend-slides` 已包含 12 个安全预设。
- bold template pack 已包含 34 个设计配方，并有 `mood`、`tone`、`best_for`、`avoid_for`、`formality`、`density`、`scheme` 元数据。
- 生产 Style Registry 已有 8 个课程风格：`sci-fi`、`editorial-night`、`broadside`、`kids-playful`、`minimal`、`nature`、`blackboard`、`game-quest`。
- 功能模板与样式模板已经分离，这是正确的基础。
- 一门课程统一一个 `styleTemplateId`，每页再选择不同功能模板和构图，也符合视觉一致性要求。

### 缺口

当前样式搜索主要依赖：

- `visualStyle` 精确匹配；
- 模板名称和关键词是否出现在自由文本中；
- 把 `audience` 拼进同一段字符串。

它尚未真正理解学习者年龄、先验知识、学习目标、内容载体、演示场景、证据强度、情绪、正式度和风险。因此“植物”容易固定匹配绿色自然风，“编程”容易固定匹配赛博风，但这两种结论在儿童启蒙、大学课程、董事会培训和学术报告中可能完全不同。

## 三、先把四种“模板”分开

| 层 | 决定什么 | 示例 | 不能决定什么 |
| --- | --- | --- | --- |
| 课程叙事模板 | 整门课如何推进认知 | 概念→例子→练习；问题→机制→证据→应用 | 颜色、字体、卡片样式 |
| 页面功能模板 | 单页让学习者做什么 | reveal、compare、sort、quiz、explore | 整课视觉身份 |
| 视觉风格模板 | 页面看起来和动起来的方式 | Signal、Vellum、Nature、Broadside | 教学目标和互动是否必要 |
| 输出运行时 | 最终如何承载和导出 | Keya 课程页、独立 HTML deck、Reveal.js、PPTX | 内容为何这样组织 |

本项目的课程生成只借用网页演示的视觉语言和验收方法，不复制固定 1920×1080 deck 运行时。课程页仍遵守 Keya 播放器、多视口、HTML 安全合同和现有 DSL。

## 四、模板总目录如何整理

### 1. 生产级课程风格：8 个

| 主要学习场景 | 首选生产风格 | 典型主题 |
| --- | --- | --- |
| 未来、系统、工程探索 | `sci-fi` | 太空、AI、网络、数据系统 |
| 夜间叙事、文化、成人深度学习 | `editorial-night` | 天文、艺术、叙事型科学 |
| 强观点、文化宣言、中文编辑叙事 | `broadside` | 社会议题、设计史、观点型课程 |
| 低龄启蒙、轻互动 | `kids-playful` | 生活习惯、基础认知、儿童语言 |
| 专业、企业、密集参考 | `minimal` | 管理、合规、职业技能、财务 |
| 生命、生态、健康、观察 | `nature` | 生物、环境、健康生活 |
| 推导、步骤、课堂讲解 | `blackboard` | 数学、物理、公式、解题 |
| 任务、挑战、技能训练 | `game-quest` | 闯关练习、技能训练、成就反馈 |

这 8 个是当前可直接进入产品生成合同的风格；其他预设和 bold 配方先作为候选设计语言，不能因为文件存在就当作已完成的生产模板。

### 2. 安全预设：12 个

| 家族 | 模板 |
| --- | --- |
| 稳健、清晰、专业 | Electric Studio、Swiss Modern、Paper & Ink、Notebook Tabs |
| 高冲击、创意表达 | Bold Signal、Creative Voltage、Vintage Editorial |
| 高级、安静、艺术 | Dark Botanical |
| 亲和、轻松、现代 | Pastel Geometry、Split Pastel |
| 技术、代码、未来 | Neon Cyber、Terminal Green |

### 3. Bold 设计包：34 个

下面是主分类。每个模板只放一个主家族，实际匹配时仍可拥有多个二级标签。

| 主家族 | 模板 | 适合方向 |
| --- | --- | --- |
| 权威 / 研究 / 报告 | Blue Professional、Cartesian、Cobalt Grid、Monochrome、Signal、Vellum | 研究、白皮书、政策、咨询、投资、严肃成人学习 |
| 文化 / 编辑 / 长文 | Biennale Yellow、Broadside、Editorial Forest、Editorial Tri-Tone、Emerald Editorial、Grove、Soft Editorial、Stencil & Tablet、Pin & Paper | 文学、历史、艺术、博物馆、文化叙事、质性研究 |
| 科技 / 创新 / 发布 | 8-Bit Orbit、BlockFrame、Neo-Grid Bold、Raw Grid、Studio | 编程、产品发布、黑客松、技术演讲、创新工作坊 |
| 品牌 / 创意 / 生活方式 | Bold Poster、Coral、Creative Mode、Long Table、Mat、Pink Script、Capsule | 设计、品牌、时尚、餐饮、创意职业、生活方式 |
| 亲和 / 教育 / 共创 | Daisy Days、Playful、People's Platform、Scatterbrain | 儿童、社区、工作坊、头脑风暴、公民议题 |
| 复古 / 青年文化 | Retro Windows、Retro Zine、Sakura Chroma | 技术史、游戏、音乐、青年文化、模拟媒介 |

信息密度还要作为独立维度：

- 高密度：BlockFrame、Monochrome、Neo-Grid Bold、Raw Grid、Scatterbrain、Signal。
- 低密度：Bold Poster、Cartesian、Pink Script、Soft Editorial、Vellum。
- 中高密度：Creative Mode、People's Platform。
- 其他为中密度。

配色环境同样独立：暗色只有 8-Bit Orbit、Broadside、Pink Script、Studio、Vellum；Coral、Editorial Forest、Editorial Tri-Tone、Emerald Editorial、Grove、Mat、Signal 为混合明暗；其余为浅色。

### 4. 学术主题：5 个

从 PowerPoint Skill 中只吸收主题语义，不复制它的 PPTX 运行时：

| 主题 | 适合 |
| --- | --- |
| Academic Light | 论文讲解、一般学术课程、公式和图表密集内容 |
| Midnight | 技术研究、计算机、需要暗色专注氛围的演讲 |
| Ocean | 稳健、专业、通用科研与企业技术内容 |
| Forest | 生物、生态、环境、健康与自然科学 |
| Sandwich | 标题/结论需要舞台感、正文需要高可读性的混合场景 |

### 5. 页面构图模式：21 个

这些是内容承载能力，不是视觉皮肤：

| 功能组 | 构图模式 |
| --- | --- |
| 框架页 | title、section-divider、references、thank-you、backup |
| 讲解页 | text-left-image-right、two-column、figure-with-text、full-image |
| 推理页 | formula-centered、formula-with-annotation、text-left-diagram-right、full-diagram、timeline |
| 证据页 | stat-callout、table、table-with-insight、table-continuation、chart、chart-centered |
| 扫描页 | icon-grid |

在课程场景里，这些名称要映射到现有功能模板和播放器构图能力，不应直接引入 PPTX 坐标或 Reveal.js DOM。

## 五、按需匹配的数据架构

### 1. 学习意图画像

从用户请求、上传资料和课程架构中提取一个结构化画像：

| 维度 | 例子 |
| --- | --- |
| `domain` | STEM、人文、艺术、商业、健康、语言、生活技能 |
| `topicSignals` | 公式、代码、时间线、人物、自然对象、制度规则 |
| `audienceStage` | 幼儿、小学、中学、大学、专业人员、公众 |
| `priorKnowledge` | 入门、熟悉、专家 |
| `learningMode` | 解释机制、推导、比较、记忆、练习、探索、评估 |
| `narrativeMode` | 教程、案例、故事、论证、实验、任务、复习 |
| `contentSignals` | 文本、图片、图表、表格、公式、代码、引文、素材数量 |
| `deliveryMode` | 讲者主导、异步自学、快速浏览、正式汇报 |
| `density` | low、medium、high |
| `tone` | calm、authoritative、playful、dramatic、experimental |
| `risk` | 普通、高风险健康/法律/合规、品牌强约束 |
| `localeAndAccess` | 中文字体、双语、色盲、弱视、reduced motion |
| `explicitDirection` | 用户明确点名的模板、颜色、品牌或禁用项 |

主题只占其中一部分。例如“量子力学”对中学生、物理专业学生和企业高管的最佳模板不会相同。

### 2. 统一模板画像

每个视觉模板需要从自由文本 `bestFor/avoidFor` 升级为结构化 Profile：

| 类别 | 字段 |
| --- | --- |
| 身份与来源 | `id`、`packId`、`source`、`license`、`recipePath`、`version` |
| 视觉语义 | `mood`、`tone`、`formality`、`scheme`、`density`、`shapeLanguage`、`motion` |
| 教学亲和 | `domains`、`audienceStages`、`learningModes`、`narrativeModes` |
| 内容能力 | `supportsFormula`、`supportsCode`、`supportsChart`、`supportsLongText`、`supportsPhotography`、`supportsBilingual` |
| 构图能力 | 可用 layout pattern、每页信息上限、图文比例、低高度适配 |
| 硬约束 | `avoidFor`、正式度下限、可访问性、字体可用性、运行时兼容性 |
| 质量证据 | 已验证视口、溢出结果、截图、最近验证时间 |

不要维护“学科 → 唯一模板”的大字典。维护“模板能力 + 学习画像”，学科词只作为信号。

### 3. 匹配结果

匹配器返回的不应只是一个 ID，而应包含：

- `selectedTemplateId`
- `candidateTemplateIds`：默认三个候选
- `scoreBreakdown`：用户偏好、受众、学习动作、内容能力、语气、密度等公开维度
- `matchedSignals`
- `conflictsAndWarnings`
- `recipePath`
- `confidence`
- `fallbackReason`

这些是公开的选择摘要，不包含模型私有推理。

## 六、匹配流程与评分

```mermaid
flowchart LR
  A["用户需求与课程资料"] --> B["结构化学习意图画像"]
  B --> C["硬约束过滤"]
  D["统一模板索引"] --> C
  C --> E["多维确定性评分"]
  E --> F["多样性重排：稳健 / 最佳匹配 / 探索"]
  F --> G{"置信度足够？"}
  G -->|是| H["选定课程级视觉系统"]
  G -->|否| I["生成三张真实主题预览"]
  I --> H
  H --> J["按页面学习动作选择构图"]
  J --> K["多视口、溢出、可访问性验收"]
  K --> L["记录结果与用户反馈"]
```

### 硬约束先过滤

- 课程页运行时不兼容的 deck 脚手架直接过滤。
- 明确模板、品牌或禁用项优先于自动推断。
- 儿童、高风险健康/法律/合规、打印需求、双语字体、可访问性作为硬约束或强惩罚。
- 高密度内容不能进入低密度模板，除非先拆页。
- 需要公式、代码、复杂表格的页面必须选择具备相应承载能力的构图。

### 建议权重

| 因素 | 权重 |
| --- | ---: |
| 用户明确视觉方向与品牌 | 25 |
| 学习动作与内容承载能力 | 25 |
| 受众阶段、先验与使用场景 | 15 |
| 课程叙事模式 | 15 |
| 语气与正式度 | 10 |
| 密度与明暗环境 | 5 |
| 已有素材适配度 | 5 |

命中 `avoidFor`、高风险场景不匹配、字体不可用、低对比或运行时冲突时追加惩罚；运行时冲突应直接淘汰。最终评分保持确定性，模型只负责把自然语言规范化为结构化画像，便于测试和解释。

### 三候选策略

默认返回三个方向，而不是三个几乎相同的高分模板：

1. **稳健项**：正式度和可读性最高，风险最低。
2. **最佳匹配项**：综合得分最高。
3. **探索项**：在满足硬约束的前提下，视觉差异最大。

如果最佳匹配与稳健项相同，则从次高分中选一个不同视觉家族。低置信度时必须展示真实课程标题和内容片段的预览，不能只显示模板名。

## 七、主题到模板的示例映射

| 学习请求 | 首选方向 | 备选 | 关键原因 |
| --- | --- | --- | --- |
| 小学生理解太阳系 | `kids-playful` 或 Daisy Days | `game-quest` | 年龄和探索任务比“太空=赛博”更重要 |
| 大学生学习轨道力学 | `blackboard` + Cobalt Grid | Academic Light | 公式、推导、图示和证据密度优先 |
| 管理层理解生成式 AI 风险 | `minimal` / Signal | Blue Professional | 高正式度、比较、风险与治理信息密集 |
| 前端开发入门 | Terminal Green / Cobalt Grid | `sci-fi` | 代码可读性优先；赛博只在用户偏好时使用 |
| 儿童认识植物生长 | `nature` / Daisy Days | Playful | 自然素材、顺序观察和低龄亲和 |
| 成人生态系统课程 | `nature` / Grove | Forest | 更克制、成熟，避免儿童贴纸感 |
| 中国古典文学赏析 | Vellum / Soft Editorial | Paper & Ink | 长文、引文、留白和文学气质 |
| 近现代社会运动史 | Broadside | Stencil & Tablet | 强观点、时间线、档案与中文编辑叙事 |
| 财务报表阅读 | Signal / Monochrome | `minimal` | 高密度表格、权威和低装饰 |
| 品牌设计基础 | Biennale Yellow / Creative Mode | Studio | 设计史、案例、作品展示和强视觉表达 |
| 医疗合规培训 | `minimal` / Signal | Academic Light | 高风险、清晰、低动效、避免娱乐化 |
| 语言词汇闯关 | `game-quest` | Notebook Tabs | 练习与反馈模式优先于学科本身 |

## 八、建议的最终 Skill 结构

继续扩展现有 `frontend-slides`，不创建竞争 Skill：

```text
resources/agent/skills/frontend-slides/
├── SKILL.md
├── template-index.json              # 所有可选风格的紧凑统一索引
├── references/
│   ├── intent-taxonomy.md           # 学习意图画像定义
│   ├── matching-policy.md           # 硬约束、评分、回退和解释规则
│   ├── narrative-patterns.md        # 课程/演示叙事模式
│   ├── layout-affordances.md        # 公式、图表、代码、图像等承载能力
│   └── quality-gates.md             # 多视口、溢出、可访问性、来源检查
├── bold-template-pack/              # 保留现有配方与渐进加载
└── scripts/                         # 只放确定性校验与索引生成脚本
```

研究快照继续留在 `resources/research/web-presentation-skills`，不进入 Agent 运行时上下文，也不允许 Agent 隐式执行其中脚本。真正采用的规则要重新归一化、注明来源，并写入现有 Skill 的一层引用文件。

## 九、实施状态与后续验收

### 阶段 1：生产目录与画像（已完成第一期）

- 8 个生产风格已经补齐家族、受众、学习动作、叙事模式、内容承载、正式度、风险场景和 recipe path。
- 上游来源、Star 快照、许可证和 commit 已记录在研究清单；研究脚本不会进入项目 lint 或运行时。
- 12 个安全预设、34 个 bold 配方和 5 个学术主题的完整生产 Profile 仍是后续扩展项。

### 阶段 2：确定性匹配器（已完成）

- `src/shared/templates/style/matching.ts` 把自然语言规范化为领域、受众、学习动作、叙事、内容能力、正式度、明暗与风险信号。
- 已实现高风险硬过滤、加权评分、冲突惩罚、最佳/稳健/探索三候选重排和公开的 score breakdown。
- 功能模板搜索与视觉模板搜索保持独立；相同输入在 `/templates` 和 Architect 中使用同一逻辑。

### 阶段 3：课程工作流接入（已完成第一期）

- Architect 的模板检索已经接收完整 `CourseCreationBrief`，并把分数、候选角色、置信度和公开评分维度返回给架构决策。
- `/templates` 已提供自然语言匹配、典型课题切换、三方向解释和 8 套真实主题预览。
- `/chat` 的解析已覆盖数字年龄、受众阶段和“4 节的互动课程”等常见表达；最终课程继续只保存受控架构与页面产物，不保存私有推理。
- `docs/product/ui-integration.md` 已更新，明确 UI 与 Agent 必须复用同一匹配器。

### 阶段 4：验证与反馈（基础完成，基准集待扩展）

- 单元测试已覆盖典型受众、公式推导、合规硬约束、三候选解释、课程语言一致性和页面 Gate。
- 真实 Chromium 已验证 `/chat` 创建课程、`/course` 翻页、`/templates` 多类查询，以及桌面和 390px 手机视口无横向溢出。
- 确定性 HTML 兜底已在桌面、平板、手机视口运行完整布局回归，缺少生成素材时仍会显示代码原生图形。
- 后续仍应建立至少 60 个“可接受模板集合”基准，跟踪 Top-3 可接受率、硬约束违规和模板分布。

## 十、当前边界

- 不把五个上游来源直接注册成五个产品 Skill。
- 不运行研究快照中的脚本。
- 不复制 Reveal.js、PPTX 或 Codex Slides 的产品运行时。
- 不为课程页面引入第二套 UI；所有能力继续落在 Keya 的 `/chat`、`/course` 和 `/templates`。
- 不把“学科 → 模板”做成不可解释的单值硬编码表。
