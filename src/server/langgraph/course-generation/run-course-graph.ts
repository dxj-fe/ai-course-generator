import type { AgentRuntimeContext } from "@/server/agents/core/types";
import {
  initializeCourseGenerationState,
  resolveCourseGenerationDependencies,
  startCourseGeneration,
  type CourseGenerationWorkflowDependencies,
  type CourseGenerationWorkflowInput,
} from "@/server/workflows/course-generation-runtime";
import {
  CourseGenerationStateSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";

import { createCourseGenerationGraph } from "./course-graph";

/**
 * LangGraph 课程入口与手写 workflow 共享输入、依赖和最终状态合同。
 * 调用方显式选择运行时，失败时不会自动重复执行另一条链路。
 */
export async function runCourseGenerationGraphWorkflow(
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  overrides: Partial<CourseGenerationWorkflowDependencies> = {},
): Promise<CourseGenerationState> {
  const dependencies = resolveCourseGenerationDependencies(overrides);
  let state = initializeCourseGenerationState(input, context, dependencies.now);
  if (state.status === "completed") return state;

  state = await startCourseGeneration(state, input, dependencies);
  const graph = createCourseGenerationGraph({
    input,
    runtime: context,
    dependencies,
  });
  const result = await graph.invoke(state);
  return CourseGenerationStateSchema.parse(result);
}
