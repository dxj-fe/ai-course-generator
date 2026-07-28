import { getErrorText } from "@/features/ai-playground/lib/messages";
import { z } from "zod";
import type {
  CourseDesignBriefs,
  AssetGenerationResult,
  AssetRequest,
  CourseIntent,
  CoursePageCount,
  CoursePlan,
  HtmlOutput,
  PageContentDSL,
  PagePlan,
  PageWorkerBrief,
  QualityReport,
  ReferencePack,
} from "@/shared/course-schema";
import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";

type AgentStatus = "idle" | "running" | "completed" | "failed";
type AgentEventType =
  | "start"
  | "agent_start"
  | "agent_done"
  | "model_call"
  | "tool_call"
  | "validation"
  | "repair_attempt"
  | "repair_success"
  | "page_done"
  | "finish"
  | "error";
type CourseDesignAgent = "pedagogy" | "story" | "visual";
type RequestOptions = { traceId?: string; signal?: AbortSignal };
type CourseWorkerOptions = {
  executionMode?: "serial" | "parallel";
  concurrency?: number;
};

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

export type ImageAssetResponse = {
  traceId: string;
  state: {
    status: "completed" | "failed";
    events: PublicAgentEvent[];
    requests?: AssetRequest[];
    results?: AssetGenerationResult[];
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

export type CourseMvpPageCount = CoursePageCount;

export type CourseGenerationResponse = {
  courseId: string;
  traceId: string;
  state: CourseGenerationState;
};

const CourseGenerationResponseSchema = z
  .object({
    courseId: z.string().min(1),
    traceId: z.string().min(1),
    state: CourseGenerationStateSchema,
  })
  .strict();

/** 一次请求以可配置 Page Worker 生成内容驱动的课程；传 courseId 时恢复。 */
export async function generateCourseMvp(
  input:
    | (CourseWorkerOptions & {
        userPrompt: string;
        courseId?: string;
        pageCount?: CourseMvpPageCount;
      })
    | (CourseWorkerOptions & {
        courseId: string;
        userPrompt?: string;
        pageCount?: CourseMvpPageCount;
      }),
  options?: RequestOptions,
): Promise<CourseGenerationResponse> {
  const payload = await postPlannerRequest<unknown>(
    "/api/courses/generate",
    input,
    options,
  );
  const parsed = CourseGenerationResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new Error(
      `整课生成接口返回了无效状态：${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}

/** 调用现有课程规划接口；响应仍在请求完成后一次性返回。 */
export function planCourse(
  input: {
    userPrompt?: string;
    intent?: CourseIntent;
    referencePacks?: ReferencePack[];
  },
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
    referencePacks?: ReferencePack[];
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
    assets?: AssetGenerationResult[];
  },
  options?: RequestOptions,
) {
  return postPlannerRequest<HtmlEngineerResponse>(
    "/api/pages/generate-html",
    input,
    options,
  );
}

/** 将 Page DSL 素材槽编译为生图请求，并返回真实图片或可继续的 fallback。 */
export function generateCoursePageAssets(
  input: {
    content: PageContentDSL;
    visualBrief: CourseDesignBriefs["visual"];
  },
  options?: RequestOptions,
) {
  return postPlannerRequest<ImageAssetResponse>(
    "/api/pages/generate-assets",
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
    assets?: AssetGenerationResult[];
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
