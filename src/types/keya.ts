import type {
  CourseDesignResponse,
  CoursePlannerResponse,
  HtmlEngineerResponse,
  ImageAssetResponse,
  PageQAResponse,
  PageWriterResponse,
  PublicAgentEvent,
} from "@/features/course-planner/lib/course-planner-api";
import type {
  CourseGenerationState,
  CourseTaskRuntimeSource,
} from "@/shared/course-schema";

export type ChatMessageRole = "assistant" | "user";

export interface KeyaChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  duration?: string;
}

export type CourseRunStageStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export interface CourseRunStage<Result> {
  status: CourseRunStageStatus;
  events: PublicAgentEvent[];
  data?: Result;
  error?: string;
}

export interface KeyaCourseRun {
  id: string;
  taskId?: string;
  courseId?: string;
  prompt: string;
  traceId: string;
  source?: CourseTaskRuntimeSource;
  startedAt: number;
  generation?: CourseGenerationState;
  planner: CourseRunStage<CoursePlannerResponse>;
  design: CourseRunStage<CourseDesignResponse>;
  pageWrites: Record<string, CourseRunStage<PageWriterResponse>>;
  pageAssets: Record<string, CourseRunStage<ImageAssetResponse>>;
  pageHtml: Record<string, CourseRunStage<HtmlEngineerResponse>>;
  pageQa: Record<string, CourseRunStage<PageQAResponse>>;
}

export interface KeyaConversation {
  id: string;
  title: string;
  pinned?: boolean;
  messages: KeyaChatMessage[];
  courseRun?: KeyaCourseRun;
}
