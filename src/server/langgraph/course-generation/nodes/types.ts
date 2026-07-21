import type { AgentRuntimeContext } from "@/server/agents/core/types";
import type {
  CourseGenerationWorkflowDependencies,
  CourseGenerationWorkflowInput,
} from "@/server/workflows/course-generation-runtime";

export type CourseGenerationGraphNodeContext = {
  input: CourseGenerationWorkflowInput;
  runtime: AgentRuntimeContext;
  dependencies: CourseGenerationWorkflowDependencies;
};
