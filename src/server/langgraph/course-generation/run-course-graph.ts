import { getWriter } from "@langchain/langgraph";

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
import {
  createCourseGraphCheckpointEnvelope,
  mapGraphChunkToAgentEvent,
  type MappedCourseGraphChunk,
} from "./graph-stream-map";

export type CourseGenerationGraphStreamObserver = (
  update: MappedCourseGraphChunk,
) => void | Promise<void>;

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

/**
 * 生产 LangGraph 流入口。checkpoint 先交给持久化依赖，再写入 custom
 * channel；调用方只收到经产品 Schema 映射后的状态和公开事件。
 */
export async function streamCourseGenerationGraphWorkflow(
  input: CourseGenerationWorkflowInput,
  context: AgentRuntimeContext,
  overrides: Partial<CourseGenerationWorkflowDependencies> = {},
  observe?: CourseGenerationGraphStreamObserver,
): Promise<CourseGenerationState> {
  const dependencies = resolveCourseGenerationDependencies(overrides);
  const initialCursor = input.existingState?.events.at(-1)?.sequence ?? 0;
  let cursor = initialCursor;
  let state = initializeCourseGenerationState(input, context, dependencies.now);
  if (state.status === "completed") return state;

  state = await startCourseGeneration(state, input, dependencies);
  const started = mapGraphChunkToAgentEvent(
    ["custom", createCourseGraphCheckpointEnvelope(state)],
    { cursor, traceId: context.traceId },
  );
  cursor = started.cursor;
  await observe?.(started);

  const streamingDependencies: CourseGenerationWorkflowDependencies = {
    ...dependencies,
    checkpoint: async (checkpoint) => {
      await dependencies.checkpoint(checkpoint);
      getWriter()?.(createCourseGraphCheckpointEnvelope(checkpoint));
    },
  };
  const graph = createCourseGenerationGraph({
    input,
    runtime: context,
    dependencies: streamingDependencies,
  });
  const stream = await graph.stream(state, {
    signal: context.abortSignal,
    streamMode: ["updates", "custom"],
  });

  for await (const chunk of stream) {
    const mapped = mapGraphChunkToAgentEvent(chunk, {
      cursor,
      traceId: context.traceId,
    });
    state = mapped.state;
    cursor = mapped.cursor;
    await observe?.(mapped);
  }

  return CourseGenerationStateSchema.parse(state);
}
