import type {
  CourseDesignResponse,
  CoursePlannerResponse,
  HtmlEngineerResponse,
  ImageAssetResponse,
  PageQAResponse,
  PageWriterResponse,
  PublicAgentEvent,
} from "@/features/course-planner/lib/course-planner-api";
import type { CourseGenerationState } from "@/shared/course-schema";

export type CourseLibraryTab = "learning" | "works" | "likes" | "saved";

export type WorkCoverVariant =
  | "capital"
  | "english"
  | "picasso"
  | "poem"
  | "printing";

export interface SeacaWork {
  id: string;
  title: string;
  description: string;
  tags: string[];
  author: string;
  avatar: string;
  likes: number;
  saves: number;
  image?: string;
  coverVariant?: WorkCoverVariant;
}

export interface FeaturedWork {
  id: string;
  title: string;
  image?: string;
  coverVariant?: WorkCoverVariant;
}

export type ChatMessageRole = "assistant" | "user";

export interface SeacaChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  time: string;
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

export interface SeacaCourseRun {
  id: string;
  taskId?: string;
  courseId?: string;
  prompt: string;
  traceId: string;
  startedAt: number;
  generation?: CourseGenerationState;
  planner: CourseRunStage<CoursePlannerResponse>;
  design: CourseRunStage<CourseDesignResponse>;
  pageWrites: Record<string, CourseRunStage<PageWriterResponse>>;
  pageAssets: Record<string, CourseRunStage<ImageAssetResponse>>;
  pageHtml: Record<string, CourseRunStage<HtmlEngineerResponse>>;
  pageQa: Record<string, CourseRunStage<PageQAResponse>>;
}

export interface SeacaConversation {
  id: string;
  title: string;
  pinned?: boolean;
  messages: SeacaChatMessage[];
  courseRun?: SeacaCourseRun;
}
