import { getErrorText } from "@/features/ai-playground/lib/messages";
import type {
  CourseDesignBriefs,
  CourseIntent,
  CoursePlan,
  HtmlOutput,
  PageContentDSL,
  PagePlan,
  PageWorkerBrief,
  QualityReport,
} from "@/shared/course-schema";

type AgentStatus = "idle" | "running" | "completed" | "failed";
type AgentEventType =
  | "start"
  | "model_call"
  | "tool_call"
  | "validation"
  | "finish"
  | "error";
type CourseDesignAgent = "pedagogy" | "story" | "visual";
type RequestOptions = { traceId?: string; signal?: AbortSignal };

export type PublicAgentEvent = {
  id: string;
  sequence: number;
  type: AgentEventType;
  summary: string;
  traceId?: string;
  timestamp?: string;
  step?: number;
  data?: Record<string, unknown>;
};

export type CoursePlannerResponse = {
  traceId: string;
  intent: CourseIntent;
  state: {
    status: AgentStatus;
    events: PublicAgentEvent[];
    outline?: CoursePlan;
    error?: { code: string; message: string };
  };
};

export type CourseDesignResponse = {
  traceId: string;
  state: {
    status: "completed" | "failed";
    events: Array<PublicAgentEvent & { agent: CourseDesignAgent }>;
    briefs?: CourseDesignBriefs;
    pageWorkerBriefs?: PageWorkerBrief[];
    error?: {
      agent: CourseDesignAgent | "workflow";
      code: string;
      message: string;
    };
  };
};

export type PageWriterResponse = {
  traceId: string;
  state: {
    status: AgentStatus;
    events: PublicAgentEvent[];
    content?: PageContentDSL;
    error?: { code: string; message: string };
  };
};

export type HtmlEngineerResponse = {
  traceId: string;
  state: {
    status: AgentStatus;
    events: PublicAgentEvent[];
    htmlOutput?: HtmlOutput;
    error?: { code: string; message: string };
  };
};

export type PageQAResponse = {
  traceId: string;
  state: {
    status: AgentStatus;
    events: PublicAgentEvent[];
    report?: QualityReport;
    error?: { code: string; message: string };
  };
};

/** 调用现有课程规划接口；响应仍在请求完成后一次性返回。 */
export function planCourse(
  input: { userPrompt?: string; intent?: CourseIntent },
  options?: RequestOptions,
) {
  return postPlannerRequest<CoursePlannerResponse>(
    "/api/courses/plan",
    input,
    options,
  );
}

/** 调用现有专业设计工作流接口。 */
export function designCourse(
  input: { intent: CourseIntent; outline: CoursePlan },
  options?: RequestOptions,
) {
  return postPlannerRequest<CourseDesignResponse>(
    "/api/courses/design",
    input,
    options,
  );
}

/** 调用现有单页内容 DSL 生成接口。 */
export function writeCoursePage(
  input: {
    intent: CourseIntent;
    page: PagePlan;
    brief: PageWorkerBrief;
  },
  options?: RequestOptions,
) {
  return postPlannerRequest<PageWriterResponse>(
    "/api/pages/write",
    input,
    options,
  );
}

/** 调用 HTML Engineer，把一页 DSL 生成并校验为完整 HTML 文档。 */
export function generateCoursePageHtml(
  input: {
    content: PageContentDSL;
    visualBrief: CourseDesignBriefs["visual"];
  },
  options?: RequestOptions,
) {
  return postPlannerRequest<HtmlEngineerResponse>(
    "/api/pages/generate-html",
    input,
    options,
  );
}

/** 评估一页已生成 HTML；接口只返回质量报告，不执行修复。 */
export function evaluateCoursePage(
  input: {
    page: PagePlan;
    content: PageContentDSL;
    html: string;
    visualBrief: CourseDesignBriefs["visual"];
    courseContext?: {
      learningObjectives: string[];
      previousPage?: PagePlan;
      nextPage?: PagePlan;
    };
  },
  options?: RequestOptions,
) {
  return postPlannerRequest<PageQAResponse>("/api/pages/qa", input, options);
}

async function postPlannerRequest<Response>(
  endpoint: string,
  input: object,
  options: RequestOptions = {},
): Promise<Response> {
  const traceId = options.traceId ?? crypto.randomUUID();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-trace-id": traceId,
    },
    body: JSON.stringify({
      ...input,
      traceId,
    }),
    signal: options.signal,
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    throw new Error(getErrorText(payload));
  }

  return payload as Response;
}
