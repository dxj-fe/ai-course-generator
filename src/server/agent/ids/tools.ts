export const ToolIds = {
  ReadLocalResource: "read_local_resource",

  SearchReferences: "search_references",
  SearchTemplates: "search_templates",
  ValidateCourseArchitecture: "validate_course_architecture",
  SubmitCourseArchitecture: "submit_course_architecture",

  GetRunSummary: "get_run_summary",
  InspectArchitecture: "inspect_architecture",
  InspectCourseReview: "inspect_course_review",
  RequestArchitectureRevision: "request_architecture_revision",
  AcceptArchitectureAndDispatchPages:
    "accept_architecture_and_dispatch_pages",
  AssignPageFixes: "assign_page_fixes",
  RequestReplan: "request_replan",
  AcceptCourseReviewAndPublish:
    "accept_course_review_and_publish",
  FailCourse: "fail_course",

  ReadPageContext: "read_page_context",
  ReadPageWorkspace: "read_page_workspace",
  EditPageWorkspace: "edit_page_workspace",
  GeneratePageImage: "generate_page_image",
  RenderPage: "render_page",
  GeneratePageContent: "generate_page_content",
  ResolvePageAssets: "resolve_page_assets",
  GeneratePageHtml: "generate_page_html",
  InspectPage: "inspect_page",
  RepairPageContent: "repair_page_content",
  RepairPageHtml: "repair_page_html",
  SubmitPage: "submit_page",
  BlockPage: "block_page",

  ReadCourseMatrix: "read_course_matrix",
  ReadPageSummary: "read_page_summary",
  ReadPageQuality: "read_page_quality",
  InspectPageEvidence: "inspect_page_evidence",
  ValidateCourseReview: "validate_course_review",
  SubmitCourseReview: "submit_course_review",
  BlockCourseReview: "block_course_review",
} as const;

export type ToolId = (typeof ToolIds)[keyof typeof ToolIds];

const CoursePageCreatorTools = [
  ToolIds.ReadLocalResource,
  ToolIds.ReadPageContext,
  ToolIds.ReadPageWorkspace,
  ToolIds.EditPageWorkspace,
  ToolIds.GeneratePageImage,
  ToolIds.RenderPage,
  ToolIds.SearchReferences,
  ToolIds.InspectPage,
  ToolIds.SubmitPage,
  ToolIds.BlockPage,
] as const;

const LegacyCoursePageBuilderTools = [
  ToolIds.GeneratePageContent,
  ToolIds.ResolvePageAssets,
  ToolIds.GeneratePageHtml,
  ToolIds.RepairPageContent,
  ToolIds.RepairPageHtml,
] as const;

export const AgentToolSets = {
  CourseArchitect: [
    ToolIds.ReadLocalResource,
    ToolIds.SearchReferences,
    ToolIds.ValidateCourseArchitecture,
    ToolIds.SubmitCourseArchitecture,
  ],
  CourseDirector: [
    ToolIds.GetRunSummary,
    ToolIds.InspectArchitecture,
    ToolIds.InspectCourseReview,
    ToolIds.RequestArchitectureRevision,
    ToolIds.AcceptArchitectureAndDispatchPages,
    ToolIds.AssignPageFixes,
    ToolIds.RequestReplan,
    ToolIds.AcceptCourseReviewAndPublish,
    ToolIds.FailCourse,
  ],
  CourseDirectorTerminal: [
    ToolIds.RequestArchitectureRevision,
    ToolIds.AcceptArchitectureAndDispatchPages,
    ToolIds.AssignPageFixes,
    ToolIds.RequestReplan,
    ToolIds.AcceptCourseReviewAndPublish,
    ToolIds.FailCourse,
  ],
  CoursePageBuilder: CoursePageCreatorTools,
  CoursePageBuilderRuntime: [
    ...CoursePageCreatorTools,
    ...LegacyCoursePageBuilderTools,
  ],
  CourseReviewer: [
    ToolIds.ReadCourseMatrix,
    ToolIds.ReadPageSummary,
    ToolIds.ReadPageQuality,
    ToolIds.InspectPageEvidence,
    ToolIds.ValidateCourseReview,
    ToolIds.SubmitCourseReview,
    ToolIds.BlockCourseReview,
  ],
} as const satisfies Record<string, readonly ToolId[]>;
