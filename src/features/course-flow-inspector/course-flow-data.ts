export type FlowStage =
  | "input"
  | "task"
  | "design"
  | "page"
  | "quality"
  | "delivery";

export type FlowRisk = "low" | "medium" | "high";

export type FlowNode = {
  id: string;
  index: number;
  title: string;
  subtitle: string;
  stage: FlowStage;
  risk: FlowRisk;
  x: number;
  y: number;
  width?: number;
  purpose: string;
  inputs: string[];
  actions: string[];
  outputs: string[];
  failures: string[];
  files: string[];
  model?: string;
  retry?: string;
  note?: string;
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  kind?: "main" | "conditional" | "error" | "loop";
};

export const FLOW_STAGE_META: Record<
  FlowStage,
  { label: string; shortLabel: string; color: string }
> = {
  input: { label: "输入整理", shortLabel: "输入", color: "#397A52" },
  task: { label: "任务与编排", shortLabel: "任务", color: "#476D8C" },
  design: { label: "整课设计", shortLabel: "设计", color: "#8A6445" },
  page: { label: "逐页生产", shortLabel: "页面", color: "#5F6C4D" },
  quality: { label: "质量闭环", shortLabel: "质量", color: "#B56B35" },
  delivery: { label: "持久化与交付", shortLabel: "交付", color: "#5E587C" },
};

export const FLOW_NODES: FlowNode[] = [
  {
    id: "prompt",
    index: 1,
    title: "一句话需求",
    subtitle: "/chat 用户输入",
    stage: "input",
    risk: "low",
    x: 80,
    y: 170,
    purpose: "接收用户对课程主题、对象、目标和形式的自然语言描述。",
    inputs: ["用户文本", "可选 txt / md / pdf 参考资料"],
    actions: ["trim 清理文本", "阻止空输入与未完成的资料解析"],
    outputs: ["原始课程请求", "待解析附件"],
    failures: ["空文本不会继续", "附件仍在解析或已失败时禁止提交"],
    files: ["src/features/keya/chat-app.tsx"],
    note: "这一步不会直接调用课程生成模型。",
  },
  {
    id: "brief",
    index: 2,
    title: "课程简报",
    subtitle: "CourseCreationBrief",
    stage: "input",
    risk: "medium",
    x: 380,
    y: 170,
    purpose: "把一句话确定性整理为用户可确认的课程创建简报。",
    inputs: ["原始请求"],
    actions: [
      "提取主题、受众、学习目标、语言和学习方式",
      "识别自然语言中的明确章节数，否则保持 auto",
      "学习目标缺失时生成一条阻塞式追问",
    ],
    outputs: ["CourseCreationBrief", "可选 clarification question"],
    failures: [
      "规则提取不是模型理解，隐含目标可能被判定为缺失",
      "简报过度依赖原始一句话质量，后续节点会继承歧义",
    ],
    files: [
      "src/features/keya/course-creation-model.ts",
      "src/features/keya/chat-app.tsx",
    ],
  },
  {
    id: "references",
    index: 3,
    title: "参考资料解析",
    subtitle: "可选 ReferencePack",
    stage: "input",
    risk: "medium",
    x: 380,
    y: 440,
    purpose: "把受支持的附件转为可追溯、可授权给页面使用的资料包。",
    inputs: ["最多 3 个 txt / md / pdf", "单文件最大 5 MB"],
    actions: [
      "校验扩展名、媒体类型、文件头与 UTF-8",
      "PDF 抽取文字，按最多 1,500 字符分块",
      "低成本模型生成摘要与最多 12 条带 chunk 引用的事实",
    ],
    outputs: ["ReferencePack[]：摘要、facts、chunks、稳定 ID"],
    failures: [
      "扫描 PDF 不做 OCR，可能抽不到有效文本",
      "摘要模型或 Schema 失败会阻止资料进入任务",
      "资料指令被视为不可信数据，不能覆盖系统任务",
    ],
    files: [
      "src/app/api/references/parse/route.ts",
      "src/server/skills/parse-uploaded-file.ts",
    ],
    model: "cheap；无 fallback",
  },
  {
    id: "compile",
    index: 4,
    title: "编译任务 Prompt",
    subtitle: "buildCourseTaskPrompt",
    stage: "input",
    risk: "medium",
    x: 700,
    y: 170,
    purpose: "把原始请求与已确认简报合成为后端实际收到的 userPrompt。",
    inputs: ["CourseCreationBrief"],
    actions: [
      "写入主题、受众、目标、节数策略、学习方式与语言",
      "追加每节独立互动 HTML 和完整性优先要求",
    ],
    outputs: ["taskPrompt（最长由任务 API 限制为 4,000 字符）"],
    failures: [
      "Prompt 同时保留原始请求与编译字段，冲突表达可能增加模型判断负担",
      "前端编译策略会系统性影响所有后续 Agent",
    ],
    files: ["src/features/keya/course-creation-model.ts"],
  },
  {
    id: "create-task",
    index: 5,
    title: "创建异步任务",
    subtitle: "POST /api/courses/tasks",
    stage: "task",
    risk: "high",
    x: 1020,
    y: 170,
    purpose: "创建持久化任务记录并尽快向浏览器返回 202。",
    inputs: ["userPrompt", "courseId / traceId", "ReferencePack[]", "可选 pageCount"],
    actions: [
      "Route 强制 source = langgraph",
      "Task Service 校验恢复参数不能改变既有事实",
      "保存 queued CourseTaskRecord",
      "Next.js after() 启动后台 run(taskId)",
    ],
    outputs: ["taskId、courseId、traceId、queued 状态"],
    failures: [
      "Prompt、ReferencePack 或 worker config 不合法时请求直接失败",
      "同一 courseId 的 queued/running/paused 任务会触发写入冲突保护",
      "部署环境若不能可靠承载 after() 长任务，会影响后台执行稳定性",
    ],
    files: [
      "src/app/api/courses/tasks/route.ts",
      "src/server/tasks/course-generation-task-service.ts",
      "src/server/storage/course-task-store.ts",
    ],
  },
  {
    id: "state",
    index: 6,
    title: "恢复与初始化",
    subtitle: "CourseGenerationState",
    stage: "task",
    risk: "medium",
    x: 1340,
    y: 170,
    purpose: "从 SQLite checkpoint 恢复已有课程，或创建新的可校验课程状态。",
    inputs: ["CourseTaskRecord", "已有 course checkpoint（如果存在）"],
    actions: [
      "任务 queued → running",
      "恢复时保留可信 intent / outline / page artifacts",
      "为显式恢复重新开放可恢复失败阶段",
      "每个被接受的状态边界执行 Zod 校验",
    ],
    outputs: ["running CourseGenerationState", "初始 checkpoint"],
    failures: [
      "旧 checkpoint 与当前 Schema 不兼容时无法恢复",
      "恢复时更换 prompt、资料、页数或并发配置会被拒绝",
    ],
    files: [
      "src/server/workflows/course-generation-runtime.ts",
      "src/server/storage/course-store.ts",
      "src/shared/course-schema/course-generation-state.ts",
    ],
  },
  {
    id: "supervisor",
    index: 7,
    title: "规则型 Supervisor",
    subtitle: "LangGraph 路由",
    stage: "task",
    risk: "medium",
    x: 1660,
    y: 170,
    purpose: "根据当前已校验状态选择唯一合法的下一节点并控制循环上限。",
    inputs: ["CourseGenerationState", "页面失败与尝试记录"],
    actions: [
      "依次选择 Intent、Planner、Course Design",
      "调度 Page Worker、Repair、Retry 或 Finalize",
      "检查取消、终态、重试预算和 decision limit",
    ],
    outputs: ["SupervisorDecision", "条件边 route"],
    failures: [
      "达到动态决策上限会以 decision_limit 终止",
      "没有合法节点会以 no_available_node 终止",
      "不可恢复页面错误会使整课进入 failed",
    ],
    files: [
      "src/server/langgraph/course-generation/course-graph.ts",
      "src/server/langgraph/course-generation/supervisor-routing.ts",
      "src/server/langgraph/course-generation/nodes/supervisor-node.ts",
    ],
    model: "不调用模型；完全由代码规则决定",
    retry: "决策上限随真实章节数和页面 Repair 预算线性增长。",
  },
  {
    id: "intent",
    index: 8,
    title: "Intent",
    subtitle: "理解课程意图",
    stage: "design",
    risk: "high",
    x: 1980,
    y: 80,
    purpose: "把编译后的 Prompt 解析成受 Schema 约束的课程意图。",
    inputs: ["userPrompt", "可选显式 pageCount"],
    actions: [
      "模型提取主题、受众、目标、难度、语言、约束",
      "未显式指定时根据内容复杂度决定正整数 courseLength",
      "normalize 后通过 CourseIntentSchema",
    ],
    outputs: ["CourseIntent"],
    failures: [
      "模型超时、鉴权、额度、限流或 Provider 故障",
      "输出 JSON 不满足 Schema",
      "意图偏差会污染 Planner 和后续全部页面",
    ],
    files: [
      "src/server/agents/intent-agent.ts",
      "src/server/prompts/intent.ts",
      "src/server/prompts/templates/intent.system.v1.md",
    ],
    model: "strong → balanced",
    retry: "结构化输出或瞬时 Provider 错误可切 fallback 一次。",
  },
  {
    id: "planner",
    index: 9,
    title: "Course Planner",
    subtitle: "整课结构规划",
    stage: "design",
    risk: "high",
    x: 2280,
    y: 80,
    purpose: "规划每页的学习职责、依赖、模板与资料使用范围。",
    inputs: ["CourseIntent", "模板卡片", "Reference summaries / hits"],
    actions: [
      "生成 CoursePlan 语义草稿",
      "确定性补齐页面 ID、顺序、模板和 dependsOnPageIds",
      "验证页数、模板、引用授权和结构完整性",
    ],
    outputs: ["CoursePlan / outline"],
    failures: [
      "长课程一次生成完整结构，输出长度、超时和 Schema 对齐风险最高",
      "计划的知识拆分与节奏直接决定最终课程质量上限",
      "错误的依赖会阻塞后继页面调度",
    ],
    files: [
      "src/server/agents/course-planner-agent.ts",
      "src/server/prompts/course-planner.ts",
      "src/server/tools/retrieval-skills.ts",
    ],
    model: "strong → balanced",
    retry: "主模型与 fallback 各有独立 Planner 超时，默认单次 180 秒。",
  },
  {
    id: "pedagogy",
    index: 10,
    title: "Pedagogy",
    subtitle: "教学设计",
    stage: "design",
    risk: "high",
    x: 1980,
    y: 350,
    purpose: "为整课和每页生成教学策略、认知目标和练习指导。",
    inputs: ["CourseIntent", "CoursePlan"],
    actions: ["串行调用教学 Agent", "要求 pageGuidance 按 outline 覆盖全部页面"],
    outputs: ["PedagogyPlan"],
    failures: [
      "任一页面缺失或顺序不一致会使整课 Design 失败",
      "抽象教学指导过弱会让 Page Writer 产出泛化内容",
    ],
    files: [
      "src/server/agents/pedagogy-agent.ts",
      "src/server/workflows/course-design-workflow.ts",
    ],
    model: "strong → balanced",
  },
  {
    id: "story",
    index: 11,
    title: "Story",
    subtitle: "叙事连续性",
    stage: "design",
    risk: "high",
    x: 2280,
    y: 350,
    purpose: "基于教学计划生成跨页面的叙事弧和逐页 story beat。",
    inputs: ["CourseIntent", "CoursePlan", "PedagogyPlan"],
    actions: ["串行生成 StoryArc", "校验 pageBeats 完整覆盖页面"],
    outputs: ["StoryArc"],
    failures: [
      "依赖 Pedagogy 成功；上游失败不会继续",
      "页面叙事重复或关联弱会造成整课割裂感",
    ],
    files: [
      "src/server/agents/story-agent.ts",
      "src/server/workflows/course-design-workflow.ts",
    ],
    model: "strong → balanced",
  },
  {
    id: "visual",
    index: 12,
    title: "Visual Director",
    subtitle: "统一视觉指导",
    stage: "design",
    risk: "high",
    x: 2580,
    y: 350,
    purpose: "选择整课样式模板并给每页提供视觉构图指导。",
    inputs: ["Intent、Plan、PedagogyPlan、StoryArc"],
    actions: [
      "生成 VisualBrief 与逐页 guidance",
      "校验只引用 CoursePlan 中唯一且真实存在的 StyleTemplate",
      "拒绝在 brief 阶段提前生成 HTML",
    ],
    outputs: ["VisualBrief"],
    failures: [
      "全课只能对齐一个 StyleTemplate，模板选择偏差会系统性影响全部页面",
      "视觉指导与页面内容错位会在 HTML/QA 阶段才暴露",
    ],
    files: [
      "src/server/agents/visual-director-agent.ts",
      "src/server/workflows/course-design-workflow.ts",
    ],
    model: "strong → balanced",
  },
  {
    id: "handoff",
    index: 13,
    title: "Worker Handoff",
    subtitle: "逐页最小 brief",
    stage: "design",
    risk: "medium",
    x: 2880,
    y: 350,
    purpose: "把三个整课设计产物按 pageId 投影成每页最小 Worker 输入。",
    inputs: ["CoursePlan", "PedagogyPlan", "StoryArc", "VisualBrief"],
    actions: [
      "按页面合并教学、叙事与视觉 guidance",
      "校验 pageId、顺序和 styleTemplateId 一致",
    ],
    outputs: ["PageWorkerBrief[]", "workerConfig"],
    failures: [
      "任一 Agent 漏页或乱序会触发 COURSE_DESIGN_VALIDATION_ERROR",
      "三个长数组依赖严格 pageId 对齐，模型偏差较敏感",
    ],
    files: ["src/server/workflows/course-design-workflow.ts"],
  },
  {
    id: "scheduler",
    index: 14,
    title: "页面调度器",
    subtitle: "serial / parallel",
    stage: "page",
    risk: "medium",
    x: 3200,
    y: 350,
    purpose: "选择满足依赖的页面，通过隔离 Worker 执行并串行合并更新。",
    inputs: ["CoursePlan.pages", "PageWorkerBrief[]", "workerConfig"],
    actions: [
      "serial 模式按 dependsOnPageIds 选择就绪页",
      "parallel 模式默认并发 2，允许 1–5",
      "单页更新进入串行 merge/checkpoint 队列",
    ],
    outputs: ["PageWorker 批次", "有序 page update"],
    failures: [
      "依赖页失败会阻塞后继页",
      "并发可缩短时间，但同时放大 Provider 限流和资源竞争",
      "单页失败不取消同批独立页面，但整课无法 Finalize",
    ],
    files: [
      "src/server/workflows/course-workers-workflow.ts",
      "src/server/workflows/promise-pool.ts",
    ],
    retry: "失败页由 Supervisor 判断是否重新开放当前阶段。",
  },
  {
    id: "writer",
    index: 15,
    title: "Page Writer",
    subtitle: "生成内容 DSL",
    stage: "page",
    risk: "high",
    x: 3520,
    y: 230,
    purpose: "为单页生成结构化教学内容，不直接写 HTML。",
    inputs: [
      "PagePlan",
      "PageWorkerBrief",
      "Intent",
      "当前页获授权的 Reference chunks",
      "上一次校验反馈",
    ],
    actions: [
      "生成 PageContentDSL v2",
      "物化稳定 block / question / option ID",
      "校验交互、素材槽、引用、场景和完成规则",
    ],
    outputs: ["PageContentDSL"],
    failures: [
      "内容稀薄、题目和反馈质量差会直接限制最终页面",
      "复杂嵌套 JSON 容易触发 Schema validation error",
      "每页独立调用可能产生跨页语气、深度和术语漂移",
    ],
    files: [
      "src/server/agents/page-writer-agent.ts",
      "src/server/prompts/page-writer.ts",
      "src/shared/course-schema/page-content-dsl.ts",
    ],
    model: "strong → balanced",
    retry: "普通阶段最多 3 次，重试会带确定性校验反馈。",
  },
  {
    id: "assets",
    index: 16,
    title: "Assets",
    subtitle: "素材请求与生图",
    stage: "page",
    risk: "high",
    x: 3820,
    y: 230,
    purpose: "把 DSL 中的素材槽解析为可用图片，失败时保留显式 fallback。",
    inputs: ["PageContentDSL.assetSlots", "VisualBrief"],
    actions: [
      "无槽位时确定性跳过",
      "先查 request-set cache，再查单素材 ready cache",
      "Image Prompt 生成受限请求，逐槽调用图片 Provider",
    ],
    outputs: ["AssetGenerationResult[]：ready 或 fallback"],
    failures: [
      "生图 Provider、格式或缓存失败会使用 CSS/SVG/placeholder",
      "fallback 不一定让页面失败，却会显著拉低观感",
      "Repair 明确不能伪造或修复上游素材 Provider 失败",
    ],
    files: [
      "src/server/workflows/image-asset-workflow.ts",
      "src/server/tools/generate-image-skill.ts",
      "src/server/assets/asset-cache.ts",
    ],
    model: "Image Prompt: balanced → cheap；图片使用独立 Provider",
    retry: "取消信号会在素材槽之间检查；取消不得转 fallback。",
  },
  {
    id: "html",
    index: 17,
    title: "HTML Engineer",
    subtitle: "完整页面实现",
    stage: "page",
    risk: "high",
    x: 4120,
    y: 230,
    purpose: "把已确认 DSL、视觉规则和获准素材实现为完整、无模型脚本的 HTML。",
    inputs: ["PageContentDSL", "VisualBrief", "Asset results", "校验反馈"],
    actions: [
      "生成完整 HTML 文档",
      "规范化输出并校验安全、DSL marker、asset URI 和 runtime marker",
      "模型 HTML 不合同时可从可信 DSL 确定性重建",
    ],
    outputs: ["HtmlOutput"],
    failures: [
      "长 HTML 容易超时、截断或违反严格合同",
      "确定性 fallback 提高可交付性，但视觉丰富度通常下降",
      "固定画布设计可能在真实播放器 contain-fit 后过小或失衡",
    ],
    files: [
      "src/server/agents/html-engineer-agent.ts",
      "src/server/html/deterministic-page-fallback.ts",
      "src/shared/html-preview/validation.ts",
    ],
    model: "strong → balanced",
    retry: "默认单次 HTML 超时 120 秒；普通阶段最多 3 次。",
  },
  {
    id: "qa",
    index: 18,
    title: "Page QA",
    subtitle: "三层质量检查",
    stage: "quality",
    risk: "high",
    x: 4420,
    y: 230,
    purpose: "对页面内容、布局、样式、素材、跨页一致性和运行时进行交付前评价。",
    inputs: ["PagePlan", "DSL", "HTML", "VisualBrief", "Assets", "Course context"],
    actions: [
      "运行静态启发式检查",
      "在 922×460、712×650、366×500 三视口执行 Playwright",
      "模型生成六维 QualityReport",
      "计算 shouldRepair 与 issue 定位信息",
    ],
    outputs: ["QualityReport", "browser evidence（可选）"],
    failures: [
      "Playwright 不可用时浏览器证据缺失但流程仍可继续",
      "模型评分存在波动，可能出现误报或漏报",
      "每次 Repair 后都要 re-QA，耗时与失败概率累积",
    ],
    files: [
      "src/server/agents/page-qa-agent.ts",
      "src/server/quality/page-quality.ts",
      "src/server/quality/playwright-screenshot.ts",
    ],
    model: "strong → balanced",
    retry: "QA 阶段最多 3 次；Repair 成功后重复完整 QA。",
  },
  {
    id: "repair",
    index: 19,
    title: "Repair / re-QA",
    subtitle: "受限质量循环",
    stage: "quality",
    risk: "high",
    x: 4120,
    y: 540,
    purpose: "依据 QA issue 由服务端限定最小修复范围，再验证新候选是否真实改善。",
    inputs: ["QualityReport", "当前 DSL / HTML", "授权 blockId / selector"],
    actions: [
      "代码先决定修 DSL 还是 HTML",
      "语义问题仅允许指定 block 或字段",
      "布局问题仅允许指定 selector 或确定性重建",
      "候选通过安全合同后 re-QA，并比较确定性质量向量",
    ],
    outputs: ["RepairAttemptRecord[]", "更新后的 DSL / HTML / QualityReport"],
    failures: [
      "无 blockId/selector 的问题不可盲修，会以 unlocatable_issue 停止",
      "上游素材失败不受支持",
      "连续 3 次无严格改善触发 QUALITY_STALLED",
      "最多 24 条 Repair 审计记录，达到后安全熔断",
    ],
    files: [
      "src/server/workflows/qa-repair-loop.ts",
      "src/server/agents/repair-agent.ts",
      "src/server/workflows/page-worker.ts",
    ],
    model: "需要模型修复时 strong → balanced",
    retry: "可恢复执行失败最多连续 3 次；每个 Graph turn 最多推进一轮成功 Repair。",
  },
  {
    id: "finalize",
    index: 20,
    title: "Finalize",
    subtitle: "整课完成判定",
    stage: "delivery",
    risk: "medium",
    x: 4740,
    y: 230,
    purpose: "确认所有规划页面完成后把课程收敛为 completed。",
    inputs: ["全部 PageGenerationState"],
    actions: [
      "检查每页 status = completed",
      "生成课程完成事件",
      "保存最终 CourseGenerationState checkpoint",
    ],
    outputs: ["completed course state"],
    failures: [
      "任一页面 failed、running 或 pending 都不能完成整课",
      "依赖页失败会使后继页未执行，最终由 Supervisor 标记失败",
    ],
    files: [
      "src/server/langgraph/course-generation/nodes/finalize-node.ts",
      "src/server/workflows/course-generation-runtime.ts",
    ],
  },
  {
    id: "checkpoint",
    index: 21,
    title: "Checkpoint + SSE",
    subtitle: "先持久化，再发布",
    stage: "delivery",
    risk: "medium",
    x: 5040,
    y: 230,
    purpose: "把已校验课程状态保存为事实来源，并向浏览器发送严格公开协议。",
    inputs: ["CourseGenerationState", "public events", "Task record"],
    actions: [
      "SQLite 原子保存 checkpoint",
      "Graph updates/custom 映射为 snapshot / event / terminal",
      "按 sequence 和 Last-Event-ID 支持去重与重连",
    ],
    outputs: ["持久化课程", "SSE 公开状态流"],
    failures: [
      "EventBus 仅进程内；实时连接依赖当前服务实例",
      "协议校验失败会被客户端视为致命连接错误",
      "状态必须先持久化，写库失败时不会发布虚假进度",
    ],
    files: [
      "src/server/langgraph/course-generation/graph-stream-map.ts",
      "src/server/tasks/course-task-sse.ts",
      "src/features/course-planner/hooks/use-sse-task.ts",
    ],
  },
  {
    id: "player",
    index: 22,
    title: "学习空间 / 播放器",
    subtitle: "最终 HTML 展示",
    stage: "delivery",
    risk: "medium",
    x: 5340,
    y: 230,
    purpose: "把持久化课程投影到聊天学习空间和独立课程播放器。",
    inputs: ["SSE task state", "Course checkpoint", "每页 HtmlOutput"],
    actions: [
      "Controller 将共享状态投影为 KeyaCourseRun",
      "诊断预览使用空权限 sandbox",
      "学习器校验后注入平台可信 runtime，并用严格 postMessage 协议交互",
    ],
    outputs: ["/chat 学习空间", "/course/[courseId] 课程播放器", "可导出 ZIP"],
    failures: [
      "runtime 错误会退化为静态导航",
      "最终观感取决于 DSL、素材、HTML 和 contain-fit 的共同结果",
      "产品 UI 隐藏原始错误与 QA 细节，诊断必须回到 task/checkpoint 日志",
    ],
    files: [
      "src/features/keya/chat-app.tsx",
      "src/features/keya/interactive-course-player.tsx",
      "src/features/keya/html-preview-frame.tsx",
    ],
  },
];

export const FLOW_EDGES: FlowEdge[] = [
  { id: "e1", from: "prompt", to: "brief" },
  { id: "e2", from: "prompt", to: "references", label: "可选附件", kind: "conditional" },
  { id: "e3", from: "brief", to: "compile", label: "目标明确" },
  { id: "e4", from: "references", to: "create-task", label: "ReferencePack", kind: "conditional" },
  { id: "e5", from: "compile", to: "create-task" },
  { id: "e6", from: "create-task", to: "state", label: "202 + after()" },
  { id: "e7", from: "state", to: "supervisor" },
  { id: "e8", from: "supervisor", to: "intent" },
  { id: "e9", from: "intent", to: "supervisor", kind: "loop" },
  { id: "e10", from: "supervisor", to: "planner" },
  { id: "e11", from: "planner", to: "supervisor", kind: "loop" },
  { id: "e12", from: "supervisor", to: "pedagogy" },
  { id: "e13", from: "pedagogy", to: "story" },
  { id: "e14", from: "story", to: "visual" },
  { id: "e15", from: "visual", to: "handoff" },
  { id: "e16", from: "handoff", to: "supervisor", kind: "loop" },
  { id: "e17", from: "supervisor", to: "scheduler", label: "page-worker" },
  { id: "e18", from: "scheduler", to: "writer" },
  { id: "e19", from: "writer", to: "assets" },
  { id: "e20", from: "assets", to: "html" },
  { id: "e21", from: "html", to: "qa" },
  { id: "e22", from: "qa", to: "repair", label: "shouldRepair", kind: "conditional" },
  { id: "e23", from: "repair", to: "qa", label: "re-QA", kind: "loop" },
  { id: "e24", from: "qa", to: "supervisor", label: "page completed", kind: "loop" },
  { id: "e25", from: "supervisor", to: "finalize", label: "全部完成" },
  { id: "e26", from: "finalize", to: "checkpoint" },
  { id: "e27", from: "checkpoint", to: "player" },
];

export const FLOW_RISK_SUMMARY = [
  {
    priority: "P0",
    title: "强模型调用链过长",
    detail:
      "整课至少经过 Intent、Planner、Pedagogy、Story、Visual；每页再调用 Writer、HTML、QA。任一处 Provider、超时或 Schema 错误都可能终止。",
    nodeIds: ["intent", "planner", "pedagogy", "story", "visual", "writer", "html", "qa"],
  },
  {
    priority: "P0",
    title: "严格 Schema 与长输出叠加",
    detail:
      "Planner 和三个整课 brief 必须覆盖全部页面并严格对齐 pageId；章节越多，输出越长，对齐和校验失败概率越高。",
    nodeIds: ["planner", "pedagogy", "story", "visual", "handoff"],
  },
  {
    priority: "P0",
    title: "质量循环放大成本与故障率",
    detail:
      "每次 Repair 都可能重新调用模型并执行三视口 QA；连续无改善才停止，因此低质量页面会显著延长任务时间。",
    nodeIds: ["qa", "repair"],
  },
  {
    priority: "P1",
    title: "可用 fallback 不等于效果好",
    detail:
      "图片 fallback 和确定性 HTML 重建能保证合同可交付，但可能正是“任务成功、整体效果仍差”的主要来源。",
    nodeIds: ["assets", "html"],
  },
];

export const FLOW_CANVAS = { width: 5720, height: 920 };

export function getFlowNode(nodeId: string) {
  return FLOW_NODES.find(({ id }) => id === nodeId);
}
