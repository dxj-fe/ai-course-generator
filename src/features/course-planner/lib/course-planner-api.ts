import { getErrorText } from "@/features/ai-playground/lib/messages";
import type {
  CourseDesignBriefs,
  AssetGenerationResult,
  CourseIntent,
  CoursePlan,
  CourseDesignResponse,
  HtmlEngineerResponse,
  ImageAssetResponse,
  PageContentDSL,
  PageQAResponse,
  PagePlan,
  PageWriterResponse,
  PageWorkerBrief,
  ReferencePack,
} from "@/shared/course-schema";

type RequestOptions = { traceId?: string; signal?: AbortSignal };

export type {
  CourseDesignResponse,
  CourseGenerationResponse,
  CoursePlannerResponse,
  HtmlEngineerResponse,
  ImageAssetResponse,
  PageQAResponse,
  PageWriterResponse,
  PublicAgentEvent,
} from "@/shared/course-schema";

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
