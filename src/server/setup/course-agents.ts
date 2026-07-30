import {
  AgentExecutor,
  createCourseAgentHandlerPlugins,
  type CourseAgentImplementations,
} from "@/server/agent";
import type { CourseAgentExecutionRequest } from "@/server/course/run/agent-request";

export type { CourseAgentImplementations };

export function createCourseAgentExecutor(
  overrides: Partial<CourseAgentImplementations> = {},
) {
  const executor = new AgentExecutor<CourseAgentExecutionRequest>();

  for (const plugin of createCourseAgentHandlerPlugins(overrides)) {
    executor.register(plugin.id, plugin.execute);
  }

  return executor.freeze();
}
