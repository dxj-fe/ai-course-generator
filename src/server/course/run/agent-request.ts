import type { CourseRunRepository } from "@/server/course/store/repository";
import type {
  CourseCreationBrief,
  ReferencePack,
  WorkOrder,
} from "@/shared/course-schema";

export type CourseAgentExecutionRequest = Readonly<{
  abortSignal?: AbortSignal;
  beforeToolCall?: () => void | PromiseLike<void>;
  creationBrief: CourseCreationBrief;
  model: unknown;
  referencePacks: ReferencePack[];
  repository: CourseRunRepository;
  runLeaseOwner: string;
  traceId: string;
  workOrder: WorkOrder;
  workOrderLeaseOwner: string;
}>;
