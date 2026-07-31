import type {
  CourseGenerationState,
  CourseTaskStatus,
  PublicAgentEvent,
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

export interface CourseRunStage {
  status: CourseRunStageStatus;
  events: PublicAgentEvent[];
  error?: string;
}

export interface KeyaCourseRun {
  id: string;
  taskId?: string;
  courseId?: string;
  prompt: string;
  traceId: string;
  startedAt: number;
  generation?: CourseGenerationState;
  planner: CourseRunStage;
  design: CourseRunStage;
  pageWrites: Record<string, CourseRunStage>;
  pageAssets: Record<string, CourseRunStage>;
  pageHtml: Record<string, CourseRunStage>;
  pageQa: Record<string, CourseRunStage>;
}

export interface KeyaConversation {
  id: string;
  title: string;
  pinned?: boolean;
  taskStatus?: CourseTaskStatus;
  messages: KeyaChatMessage[];
  courseRun?: KeyaCourseRun;
}
