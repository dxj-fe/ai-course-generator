import type { AssetGenerationResult, AssetRequest } from "./asset";
import type {
  CourseDesignBriefs,
  PageWorkerBrief,
} from "./course-design";
import type { CourseGenerationState } from "./course-generation-state";
import type { CourseIntent } from "./intent";
import type { HtmlOutput } from "./page";
import type { PageContentDSL } from "./page-content-dsl";
import type { QualityReport } from "./quality";
import type { CoursePlan } from "./course-plan";

export type AgentCapabilityStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export type PublicAgentEvent = {
  id: string;
  sequence: number;
  type:
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
    status: AgentCapabilityStatus;
    events: PublicAgentEvent[];
    outline?: CoursePlan;
    error?: { code: string; message: string };
  };
};

export type CourseDesignResponse = {
  traceId: string;
  state: {
    status: "completed" | "failed";
    events: Array<
      PublicAgentEvent & { agent: "pedagogy" | "story" | "visual" }
    >;
    briefs?: CourseDesignBriefs;
    pageWorkerBriefs?: PageWorkerBrief[];
    error?: {
      agent: "pedagogy" | "story" | "visual" | "workflow";
      code: string;
      message: string;
    };
  };
};

export type PageWriterResponse = {
  traceId: string;
  state: {
    status: AgentCapabilityStatus;
    events: PublicAgentEvent[];
    content?: PageContentDSL;
    error?: { code: string; message: string };
  };
};

export type HtmlEngineerResponse = {
  traceId: string;
  state: {
    status: AgentCapabilityStatus;
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
    status: AgentCapabilityStatus;
    events: PublicAgentEvent[];
    report?: QualityReport;
    error?: { code: string; message: string };
  };
};

export type CourseGenerationResponse = {
  courseId: string;
  traceId: string;
  state: CourseGenerationState;
};
