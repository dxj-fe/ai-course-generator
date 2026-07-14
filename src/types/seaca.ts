import type {
  CourseDesignResponse,
  CoursePlannerResponse,
  HtmlEngineerResponse,
  PageWriterResponse,
  PublicAgentEvent,
} from "@/features/course-planner/lib/course-planner-api";

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
  prompt: string;
  traceId: string;
  startedAt: number;
  planner: CourseRunStage<CoursePlannerResponse>;
  design: CourseRunStage<CourseDesignResponse>;
  pageWrites: Record<string, CourseRunStage<PageWriterResponse>>;
  pageHtml: Record<string, CourseRunStage<HtmlEngineerResponse>>;
}

export interface SeacaConversation {
  id: string;
  title: string;
  pinned?: boolean;
  messages: SeacaChatMessage[];
  courseRun?: SeacaCourseRun;
}
