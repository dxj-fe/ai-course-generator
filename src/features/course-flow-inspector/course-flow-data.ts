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
  input: { label: "输入与简报", shortLabel: "输入", color: "#397A52" },
  task: { label: "任务与耐久编排", shortLabel: "任务", color: "#476D8C" },
  design: { label: "整课架构与派工", shortLabel: "架构", color: "#8A6445" },
  page: { label: "逐页并行生产", shortLabel: "页面", color: "#5F6C4D" },
  quality: { label: "整课审查与返工", shortLabel: "质量", color: "#B56B35" },
  delivery: { label: "发布与产品投影", shortLabel: "交付", color: "#5E587C" },
};

export const FLOW_NODES: FlowNode[] = [
  {
    id: "brief",
    index: 1,
    title: "课程简报",
    subtitle: "CourseCreationBrief",
    stage: "input",
    risk: "medium",
    x: 80,
    y: 200,
    purpose: "把用户的一句话和可选资料整理成后端可长期保存、可重复执行的课程需求。",
    inputs: ["用户原始描述", "受众、目标、语言、学习方式", "可选 ReferencePack[]"],
    actions: [
      "在 /chat 补齐学习目标等必要信息",
      "保留原始请求，生成结构化 CourseCreationBrief",
      "把参考资料作为独立、可追溯的数据一起提交",
    ],
    outputs: ["CourseCreationBrief", "ReferencePack[]"],
    failures: [
      "目标含糊会让后面的架构和页面一起跑偏",
      "附件解析失败时不能假装资料已经进入课程",
    ],
    files: [
      "src/features/keya/course-creation-model.ts",
      "src/features/keya/chat-app.tsx",
      "src/shared/course-schema/course-creation-brief.ts",
    ],
    note: "Brief 是业务输入事实；不要再只把一段拼好的 Prompt 当成唯一输入。",
  },
  {
    id: "task",
    index: 2,
    title: "创建 agent-v2 任务",
    subtitle: "POST /api/courses/tasks",
    stage: "task",
    risk: "medium",
    x: 430,
    y: 200,
    purpose: "先持久化任务，再把耗时生成交给可恢复的课程运行引擎。",
    inputs: ["courseId / traceId", "CourseCreationBrief", "ReferencePack[]", "并发度"],
    actions: [
      "在同一事务获取 courseId 唯一 claim，并写入 source=agent-v2 的 CourseTaskRecord",
      "立即返回 taskId，后台唤醒 Task Service",
      "Task Service 把引擎 checkpoint 投影回现有课程状态和 SSE",
    ],
    outputs: ["queued task", "taskId", "agent-v2 运行入口"],
    failures: [
      "同一 courseId 已有 queued/running/paused 任务时必须拒绝第二个任务",
      "后台唤醒不是耐久队列，进程重启后仍需要扫描未完成任务",
      "历史 workflow/langgraph 记录只读兼容，不能混进新执行路径",
    ],
    files: [
      "src/app/api/courses/tasks/route.ts",
      "src/server/course/task/service.ts",
      "src/server/course/store/task.ts",
    ],
  },
  {
    id: "bootstrap",
    index: 3,
    title: "建立 CourseRun",
    subtitle: "耐久状态、租约、首张工作单",
    stage: "task",
    risk: "high",
    x: 750,
    y: 200,
    purpose: "为这次课程生成建立唯一执行权，并创建第一张 Architect WorkOrder。",
    inputs: ["taskId / courseId / traceId", "已有 CourseRun（恢复时）"],
    actions: [
      "新任务原子创建 CourseRun 与 architect_course WorkOrder",
      "领取或续期课程 lease，防止两个 worker 同时写同一课程",
      "恢复过期 running WorkOrder，不重跑已提交或已接受的产物",
    ],
    outputs: ["CourseRun", "architect_course WorkOrder", "首个公共 checkpoint"],
    failures: [
      "lease、trace 或 lockVersion 不一致时必须停止写入",
      "进程中断后只允许从持久化状态恢复，不能靠内存猜进度",
    ],
    files: [
      "src/server/course/run/engine.ts",
      "src/server/course/store/repository.ts",
      "src/shared/course-schema/course-run.ts",
      "src/shared/course-schema/work-order.ts",
    ],
    retry: "仅重新领取过期 lease；已经成功落库的 Artifact 和 WorkOrder 不重复生成。",
  },
  {
    id: "architect",
    index: 4,
    title: "课程架构 Agent",
    subtitle: "Curriculum Architect",
    stage: "design",
    risk: "high",
    x: 1020,
    y: 200,
    purpose: "先从全局把课程想清楚，一次产出事实底稿、整课规则和每页具体任务。",
    inputs: ["CourseCreationBrief", "ReferencePack 摘要/检索结果", "模板目录"],
    actions: [
      "按需搜索资料和模板，不把全部上下文塞进模型",
      "生成 CoursePack、CourseBlueprint、PageTask[]",
      "明确每页职责、目标、互动、验收条件和真实 build 依赖",
      "用 submit_architecture 作为唯一交活动作",
    ],
    outputs: ["候选 CourseArchitecture Artifact", "ArchitectureSubmission"],
    failures: [
      "页面堆得多但职责重复，会被语义验收退回",
      "把展示顺序误写成 build 依赖，会白白串行化整个课程",
      "只输出文字、不调用提交工具，不算完成",
    ],
    files: [
      "src/server/agent/plugins/agents/course/architect-handler.ts",
      "src/server/course/gate/architecture.ts",
      "src/shared/course-schema/course-architecture.ts",
    ],
    model: "planner 路由；仅暂时性 Provider 错误允许切 fallback",
  },
  {
    id: "architecture-submission",
    index: 5,
    title: "架构提交与硬校验",
    subtitle: "一个原子 CourseArchitecture",
    stage: "design",
    risk: "high",
    x: 1320,
    y: 200,
    purpose: "确保蓝图和所有 PageTask 是同一个版本，不能半份成功、半份缺失。",
    inputs: ["CoursePack", "CourseBlueprint", "PageTask[]"],
    actions: [
      "校验 ID、目标覆盖、模板、页序和依赖 DAG",
      "持久化不可变 course_architecture Artifact",
      "把 Architect WorkOrder 置为 submitted",
    ],
    outputs: ["course_architecture ArtifactRef", "submitted Architect WorkOrder"],
    failures: [
      "循环依赖、目标未覆盖或页面验收条件缺失会拒绝整次提交",
      "同一 WorkOrder 重交相同内容会复用本回合结果；新的修订 WorkOrder 会产生新版本",
    ],
    files: [
      "src/server/course/gate/architecture.ts",
      "src/server/course/store/repository.ts",
      "src/shared/course-schema/course-artifact.ts",
    ],
    note: "这里还没有派发 Page Agent；先等 Director 做一次真正的全局语义验收。",
  },
  {
    id: "director-architecture",
    index: 6,
    title: "Director 验收架构",
    subtitle: "第一次语义决策",
    stage: "design",
    risk: "high",
    x: 1620,
    y: 200,
    purpose: "从目标和整体学习体验判断这套架构值不值得执行，而不是只看 Schema 合法。",
    inputs: ["RunSummary", "CourseArchitecture", "用户目标"],
    actions: [
      "检查目标是否落实为讲解和可观察练习",
      "检查页面是否重复、难度是否合适、依赖是否必要",
      "只选 accept_architecture_and_dispatch_pages 或 request_architecture_revision",
    ],
    outputs: ["接受并派工，或具体的架构修改意见"],
    failures: [
      "Director 不生成页面，也不能绕过 Architecture Gate",
      "语义验收写得含糊，会导致 Architect 无法定向改正",
    ],
    files: [
      "src/server/agent/plugins/agents/course/director-handler.ts",
      "src/server/agent/plugins/tools/course/director.ts",
      "src/server/course/run/director-round-commit.ts",
    ],
    model: "planner 路由；只在两个真正需要判断的时点运行",
  },
  {
    id: "fanout",
    index: 7,
    title: "原子派发 Page WorkOrder",
    subtitle: "一次创建 N 张页面工作单",
    stage: "design",
    risk: "high",
    x: 1940,
    y: 200,
    purpose: "Director 接受架构时，把每个 PageTask 变成一张独立、可领取、可恢复的页面工作单。",
    inputs: ["已接受的 CourseArchitecture", "PageTask[]"],
    actions: [
      "同一事务更新 activeArchitecture",
      "为每页创建 build_page WorkOrder",
      "无生成依赖的页面直接 queued，有依赖的页面 waiting_dependencies",
      "任一页面工作单创建失败就整批回滚",
    ],
    outputs: ["恰好 N 张 build_page WorkOrder", "CourseRun.phase=building"],
    failures: [
      "不允许先创建几页再补剩余页面",
      "同一架构重复接受必须命中幂等结果，不能重复派工",
    ],
    files: [
      "src/server/course/run/director-round-commit.ts",
      "src/server/course/run/commands.ts",
      "src/server/course/store/repository.ts",
    ],
  },
  {
    id: "wave-scheduler",
    index: 8,
    title: "依赖波次调度",
    subtitle: "ready 页面并行，后继页面等待",
    stage: "page",
    risk: "medium",
    x: 2230,
    y: 200,
    purpose: "只做机械调度：找出当前依赖已满足的页面，并按并发上限领取执行。",
    inputs: ["CourseRun", "全部当前 WorkOrder", "concurrency 1–5"],
    actions: [
      "筛选 queued/running 的当前架构页面工作单",
      "用 Promise Pool 并行运行同一 wave",
      "每轮续期 CourseRun lease，逐张领取 WorkOrder lease",
    ],
    outputs: ["本波次 Page Builder 执行集合"],
    failures: [
      "调度器没有语义决策权，不能擅自改依赖或页面任务",
      "没有可运行工作单但课程未终态，说明状态或依赖图损坏",
    ],
    files: [
      "src/server/course/run/engine.ts",
      "src/server/infra/concurrency/pool.ts",
      "src/server/course/policy/run.ts",
    ],
    note: "“并行”是按 buildDependsOnPageIds 分波次，不是无脑同时启动全部页面。",
  },
  {
    id: "page-builder",
    index: 9,
    title: "Page Builder Agent",
    subtitle: "每页一名真正的工具调用 Agent",
    stage: "page",
    risk: "high",
    x: 2540,
    y: 200,
    purpose: "围绕一张 PageTask 自主调用有限工具，完成内容、素材、HTML 和质量证据。",
    inputs: ["当前 PageTask", "CoursePack/Blueprint", "已封口的前置 PageSummary", "修复时的旧页面产物"],
    actions: [
      "按需读取页面任务、依赖摘要和参考资料",
      "生成/修订 PageContentDSL",
      "生成素材并实现完整 HTML",
      "运行页面 QA，根据反馈在预算内定向修复",
      "调用 submit_page 交付候选产物",
    ],
    outputs: ["page_content", "page_assets", "page_html", "page_quality"],
    failures: [
      "只能调用 WorkOrder.allowedTools，不能修改其他页面或整课架构",
      "依赖输入在 queued 时封口；执行中不能偷读后来变化的页面",
      "模型文字声明完成无效，Repository 中的 terminal 状态才算完成",
    ],
    files: [
      "src/server/agent/plugins/agents/course/page-builder-handler.ts",
      "src/server/agent/plugins/tools/course/page-builder.ts",
      "src/server/agent/plugins/contexts/course/page-builder.ts",
      "src/server/agent/plugins/tools/course/page-builder-model-steps.ts",
    ],
    model: "page-writer 路由；工具内复用内容、图片、HTML、QA 的确定性能力",
    retry: "Provider 暂时性错误可切模型；业务质量问题走同一 Page Builder 的有界修订，不整课重跑。",
  },
  {
    id: "page-gate",
    index: 10,
    title: "Page Gate",
    subtitle: "单页硬验收",
    stage: "page",
    risk: "high",
    x: 2860,
    y: 200,
    purpose: "用代码检查页面是否真的可交付，避免 Agent 自己宣布自己合格。",
    inputs: ["PageTask", "DSL", "Assets", "HTML", "QualityReport", "截图证据"],
    actions: [
      "验证内容覆盖、素材槽、HTML 安全和运行时标记",
      "检查质量阈值、三视口截图和互动结果",
      "生成受控 PageSummary",
      "通过时原子接受 WorkOrder 并更新 currentPages",
    ],
    outputs: ["accepted Page WorkOrder", "PageSummary Artifact", "当前页 Artifact 指针"],
    failures: [
      "缺任一必需 Artifact 或证据时拒绝接受",
      "Gate 只认提交对应的当前版本，不能拿旧截图验收新 HTML",
    ],
    files: [
      "src/server/course/gate/page.ts",
      "src/server/course/run/page-operations.ts",
      "src/shared/course-schema/page-summary.ts",
    ],
  },
  {
    id: "summary-unlock",
    index: 11,
    title: "摘要解锁后继页",
    subtitle: "PageSummary 作为最小协作上下文",
    stage: "page",
    risk: "medium",
    x: 3180,
    y: 200,
    purpose: "页面通过后，只把后继页真正需要的摘要加入输入，并解锁下一波页面。",
    inputs: ["刚接受的 PageSummary", "waiting_dependencies WorkOrder"],
    actions: [
      "找出 buildDependencyPageIds 已全部完成的工作单",
      "把依赖页 PageSummary ArtifactRef 合并进输入",
      "封口 inputArtifactRefs，状态 waiting_dependencies → queued",
    ],
    outputs: ["下一波 queued Page WorkOrder"],
    failures: [
      "不能把整页 HTML 塞给后继 Agent，会造成上下文膨胀和串页修改",
      "只解锁依赖当前版本；旧架构或旧页面摘要不能混入",
    ],
    files: [
      "src/server/course/store/repository-support.ts",
      "src/server/course/run/page-operations.ts",
      "src/shared/course-schema/page-summary.ts",
    ],
  },
  {
    id: "manifest",
    index: 12,
    title: "冻结整课 Manifest",
    subtitle: "精确锁定本轮页面版本",
    stage: "quality",
    risk: "high",
    x: 3480,
    y: 200,
    purpose: "所有当前页面通过后，固定本轮 Review 到底审的是哪套架构、哪版页面。",
    inputs: ["activeArchitecture", "所有 currentPages ArtifactRef"],
    actions: [
      "按页面顺序构造 CourseManifest",
      "计算 manifestHash",
      "创建 review_course WorkOrder，并把输入封口",
    ],
    outputs: ["course_manifest Artifact", "manifestHash", "review_course WorkOrder"],
    failures: [
      "缺页、stale 页面或 Artifact 指针不全时禁止开始整课审查",
      "Review 期间页面版本变化会让旧 Review 失效",
    ],
    files: [
      "src/server/course/gate/review.ts",
      "src/server/course/run/commands.ts",
      "src/shared/course-schema/course-manifest.ts",
    ],
  },
  {
    id: "reviewer",
    index: 13,
    title: "Course Reviewer Agent",
    subtitle: "整课跨页审查",
    stage: "quality",
    risk: "high",
    x: 3780,
    y: 200,
    purpose: "检查每页单独合格之后，整门课是否仍有漏目标、重复、断层和互动缺失。",
    inputs: ["冻结 CourseManifest", "CourseArchitecture", "全部 PageSummary/Quality 受控证据"],
    actions: [
      "读完目标矩阵及全部摘要/质量分页，不能抽样",
      "必要时检查指定页面证据，但不读取或修改 HTML",
      "提交 pass、revise_pages 或 replan 的 CourseReview",
    ],
    outputs: ["course_review Artifact", "带证据和建议动作的 issues[]"],
    failures: [
      "Reviewer 只报告，不能自己修页、派工或发布",
      "证据没有读到末尾时，validate、submit 和 block 都会被拒绝",
      "manifestHash、页面覆盖或证据引用不一致时提交会被 Gate 拒绝",
    ],
    files: [
      "src/server/agent/plugins/agents/course/reviewer-handler.ts",
      "src/server/agent/plugins/tools/course/reviewer.ts",
      "src/server/course/gate/review.ts",
    ],
    model: "page-qa 路由；只看冻结的受控证据",
  },
  {
    id: "director-review",
    index: 14,
    title: "Director 决定下一步",
    subtitle: "发布 / 局部返工 / 重做架构",
    stage: "quality",
    risk: "high",
    x: 4090,
    y: 200,
    purpose: "根据 Reviewer 的整课证据做第二次语义决策，并且只选择一个后续动作。",
    inputs: ["RunSummary", "CourseReview", "剩余返工和重规划预算"],
    actions: [
      "pass 时调用 publish_course",
      "revise_pages 时按 issue 指派 fix_page WorkOrder",
      "replan 时创建新版 architect_course WorkOrder",
      "证据损坏或预算耗尽时明确 fail_course",
    ],
    outputs: ["发布、局部返工、重规划或失败中的唯一结果"],
    failures: [
      "不能把 revise_pages 偷换成整课重做，也不能无视 Reviewer 直接发布",
      "每个语义回合只有一次写动作，避免边发布边返工",
    ],
    files: [
      "src/server/agent/plugins/agents/course/director-handler.ts",
      "src/server/course/run/revision-commands.ts",
      "src/server/course/run/commands.ts",
    ],
    model: "planner 路由；读取 Review 后作有界选择",
  },
  {
    id: "fix-pages",
    index: 15,
    title: "局部页面返工",
    subtitle: "fix_page + 依赖闭包",
    stage: "quality",
    risk: "medium",
    x: 4420,
    y: 80,
    purpose: "只重做 Reviewer 点名的页面，以及确实依赖这些页面结果的后继页面。",
    inputs: ["page-scoped Review issues", "当前页面 Artifact", "依赖图"],
    actions: [
      "计算受影响页面的传递依赖闭包",
      "创建带旧产物和 issue 的 fix_page WorkOrder",
      "标记受影响 currentPages 为 stale，重新按 wave 执行",
    ],
    outputs: ["新一轮 fix_page WorkOrder", "新的页面版本和 manifest"],
    failures: [
      "不能把展示顺序后的所有页面都当成受影响，只看真实 build 依赖",
      "旧 Review 不能验收新页面；返工后必须重新冻结 manifest 并整课审查",
    ],
    files: [
      "src/server/course/run/revision-commands.ts",
      "src/server/agent/plugins/agents/course/page-builder-handler.ts",
      "src/server/course/run/engine.ts",
    ],
    retry: "返工重新进入 Page Builder → Page Gate → Manifest → Reviewer 闭环。",
  },
  {
    id: "replan",
    index: 16,
    title: "整课重新规划",
    subtitle: "新 architecture revision",
    stage: "quality",
    risk: "high",
    x: 4420,
    y: 340,
    purpose: "只有页面职责、目标矩阵或整体顺序本身错误时，才重新执行 Architect。",
    inputs: ["course-scoped Review issues", "上一版架构", "剩余 replan 预算"],
    actions: [
      "旧架构和旧分支保留为审计记录",
      "创建更高 revision 的 architect_course WorkOrder",
      "新架构仍要经过 Director 语义验收和原子派工",
    ],
    outputs: ["新版 Architect WorkOrder", "新的完整课程分支"],
    failures: [
      "不能用 replan 掩盖单页小问题，否则成本和漂移都会放大",
      "达到重规划预算后必须失败并给出明确原因",
    ],
    files: [
      "src/server/course/run/revision-commands.ts",
      "src/server/course/run/engine.ts",
      "src/shared/course-schema/course-run.ts",
    ],
    retry: "重新回到课程架构 Agent，不直接复用旧 Page WorkOrder。",
  },
  {
    id: "final-gate",
    index: 17,
    title: "最终发布 Gate",
    subtitle: "只发布当前、完整、已审查的版本",
    stage: "delivery",
    risk: "high",
    x: 4740,
    y: 200,
    purpose: "发布前用代码再次确认当前指针、manifest、Review 和工作单状态完全一致。",
    inputs: ["CourseRun 当前指针", "pass CourseReview", "全部 WorkOrder/Artifact"],
    actions: [
      "重建当前 manifest 并核对 hash",
      "检查 Review 是当前版本且 decision=pass",
      "检查没有 stale 页面、未完成当前工作单或缺失 Artifact",
    ],
    outputs: ["CourseRun.phase=completed"],
    failures: [
      "任何旧 Review、旧页面、缺页或未完成当前工作单都会拒绝发布",
      "Director 的 publish 意图不能绕过 Final Gate",
    ],
    files: [
      "src/server/course/gate/review.ts",
      "src/server/course/run/commands.ts",
      "src/server/agent/plugins/tools/course/director.ts",
    ],
  },
  {
    id: "projection",
    index: 18,
    title: "投影 checkpoint 与事件",
    subtitle: "复用现有 SSE / Keya UI",
    stage: "delivery",
    risk: "medium",
    x: 5040,
    y: 200,
    purpose: "把耐久 CourseRun、WorkOrder 和 Artifact 投影成现有前端能理解的课程状态。",
    inputs: ["Repository 当前事实", "公共 CourseRunEvent"],
    actions: [
      "只读取 active/current ArtifactRef 构造 CourseGenerationState",
      "把内部事件映射为白名单公开摘要",
      "用 CourseStore CAS + Task trace/status fence 保存 checkpoint",
      "EventBus 快推，同时每 500ms 追读持久化状态补齐跨进程事件",
    ],
    outputs: ["CourseGenerationState checkpoint", "SSE 公开事件"],
    failures: [
      "pause/cancel 后旧 runner 的 checkpoint 必须被数据库围栏拒绝",
      "SSE 游标必须包含 traceId，resume 后不能漏掉新 trace 事件",
      "UI 不能从文案猜流程，也不能读取私有模型推理",
      "投影失败不能反向修改业务事实；应修 Projector 或坏数据",
    ],
    files: [
      "src/server/course/projection/state.ts",
      "src/server/course/projection/public-events.ts",
      "src/server/course/task/sse.ts",
    ],
  },
  {
    id: "player",
    index: 19,
    title: "学习空间与播放器",
    subtitle: "多页 HTML 课程交付",
    stage: "delivery",
    risk: "medium",
    x: 5360,
    y: 200,
    purpose: "在现有 /chat、/course 和安全 iframe 中展示已持久化的多页课程。",
    inputs: ["SSE task state", "完成的 Course checkpoint", "当前 page_html"],
    actions: [
      "聊天线程显示公开进度和可行动错误",
      "右侧学习空间展示当前生成结果",
      "课程详情页使用受限 sandbox 和平台运行时播放互动 HTML",
    ],
    outputs: ["/chat 学习空间", "/course/[courseId] 播放器", "课程导出"],
    failures: [
      "产品层不展示私有思维链和内部工具参数",
      "播放器问题与生成质量问题要分开排查，不能让 Agent 猜 UI 故障",
    ],
    files: [
      "src/features/keya/chat-app.tsx",
      "src/features/keya/course-workspace-panel.tsx",
      "src/features/keya/interactive-course-player.tsx",
    ],
  },
];

export const FLOW_EDGES: FlowEdge[] = [
  { id: "e1", from: "brief", to: "task" },
  { id: "e2", from: "task", to: "bootstrap" },
  { id: "e3", from: "bootstrap", to: "architect" },
  { id: "e4", from: "architect", to: "architecture-submission" },
  { id: "e5", from: "architecture-submission", to: "director-architecture" },
  {
    id: "e6",
    from: "director-architecture",
    to: "architect",
    label: "退回架构",
    kind: "loop",
  },
  {
    id: "e7",
    from: "director-architecture",
    to: "fanout",
    label: "语义接受",
  },
  { id: "e8", from: "fanout", to: "wave-scheduler" },
  { id: "e9", from: "wave-scheduler", to: "page-builder", label: "当前 wave" },
  { id: "e10", from: "page-builder", to: "page-gate" },
  {
    id: "e11",
    from: "page-gate",
    to: "page-builder",
    label: "质量未过",
    kind: "loop",
  },
  { id: "e12", from: "page-gate", to: "summary-unlock", label: "接受页面" },
  {
    id: "e13",
    from: "summary-unlock",
    to: "wave-scheduler",
    label: "下一 wave",
    kind: "loop",
  },
  { id: "e14", from: "summary-unlock", to: "manifest", label: "全部页面完成" },
  { id: "e15", from: "manifest", to: "reviewer" },
  { id: "e16", from: "reviewer", to: "director-review" },
  {
    id: "e17",
    from: "director-review",
    to: "fix-pages",
    label: "revise_pages",
    kind: "conditional",
  },
  {
    id: "e18",
    from: "fix-pages",
    to: "wave-scheduler",
    label: "受影响页面",
    kind: "loop",
  },
  {
    id: "e19",
    from: "director-review",
    to: "replan",
    label: "replan",
    kind: "conditional",
  },
  {
    id: "e20",
    from: "replan",
    to: "architect",
    label: "新 revision",
    kind: "loop",
  },
  { id: "e21", from: "director-review", to: "final-gate", label: "pass" },
  { id: "e22", from: "final-gate", to: "projection" },
  { id: "e23", from: "projection", to: "player" },
];

export const FLOW_RISK_SUMMARY = [
  {
    priority: "P0",
    title: "全局架构没想清楚就派工",
    detail:
      "Architect 必须先提交完整架构，Director 语义接受后才能原子创建页面工作单；少任一步都会让并行页面各写各的。",
    nodeIds: ["architect", "architecture-submission", "director-architecture", "fanout"],
  },
  {
    priority: "P0",
    title: "持久化和租约不可靠",
    detail:
      "真正的多 Agent 协作依赖 WorkOrder、Artifact、幂等键和 lease。只靠进程内 Promise 或聊天记录，重启后一定会重复执行或丢状态。",
    nodeIds: ["bootstrap", "wave-scheduler", "page-builder"],
  },
  {
    priority: "P0",
    title: "页面自评通过、整课却不好",
    detail:
      "Page Gate 只能保证单页；必须再冻结 manifest，让独立 Reviewer 审完全部页面，并由 Director 选择发布、修页或重规划。",
    nodeIds: ["page-gate", "manifest", "reviewer", "director-review", "final-gate"],
  },
  {
    priority: "P1",
    title: "返工范围失控",
    detail:
      "页面问题只重做点名页面和真实依赖闭包；全局结构问题才 replan。否则一次小错误会把整课成本、时间和内容漂移全部放大。",
    nodeIds: ["fix-pages", "replan"],
  },
];

export const FLOW_CANVAS = { width: 5720, height: 920 };

export function getFlowNode(nodeId: string) {
  return FLOW_NODES.find(({ id }) => id === nodeId);
}
