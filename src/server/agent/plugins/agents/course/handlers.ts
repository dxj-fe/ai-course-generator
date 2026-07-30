import { AgentIds, type AgentId } from "@/server/agent/ids";
import type { CourseAgentExecutionRequest } from "@/server/course/run/agent-request";

import { runCurriculumArchitectAgent } from "./architect-handler";
import { runCourseDirectorAgent } from "./director-handler";
import { runPageBuilderAgent } from "./page-builder-handler";
import { runCourseReviewerAgent } from "./reviewer-handler";

export type CourseAgentImplementations = Readonly<{
  runArchitect: typeof runCurriculumArchitectAgent;
  runDirector: typeof runCourseDirectorAgent;
  runPageBuilder: typeof runPageBuilderAgent;
  runReviewer: typeof runCourseReviewerAgent;
}>;

export type CourseAgentHandlerPlugin = Readonly<{
  id: AgentId;
  execute(request: CourseAgentExecutionRequest): Promise<void>;
}>;

/**
 * 课程 Agent 的代码插件目录。新增 Agent 时在这里关联稳定 ID 与执行实现，
 * Course Engine 和 setup 不需要认识具体职责或 WorkOrder kind。
 */
export function createCourseAgentHandlerPlugins(
  overrides: Partial<CourseAgentImplementations> = {},
): readonly CourseAgentHandlerPlugin[] {
  const implementations: CourseAgentImplementations = {
    runArchitect:
      overrides.runArchitect ?? runCurriculumArchitectAgent,
    runDirector: overrides.runDirector ?? runCourseDirectorAgent,
    runPageBuilder:
      overrides.runPageBuilder ?? runPageBuilderAgent,
    runReviewer: overrides.runReviewer ?? runCourseReviewerAgent,
  };

  return Object.freeze([
    {
      id: AgentIds.CourseArchitect,
      execute: async (request) => {
        await implementations.runArchitect(
          {
            ...commonInput(request),
            creationBrief: request.creationBrief,
            referencePacks: request.referencePacks,
          },
          { model: request.model },
        );
      },
    },
    {
      id: AgentIds.CourseDirector,
      execute: async (request) => {
        await implementations.runDirector(commonInput(request), {
          model: request.model,
        });
      },
    },
    {
      id: AgentIds.CoursePageBuilder,
      execute: async (request) => {
        await implementations.runPageBuilder(
          {
            ...commonInput(request),
            creationBrief: request.creationBrief,
            referencePacks: request.referencePacks,
          },
          { model: request.model },
        );
      },
    },
    {
      id: AgentIds.CourseReviewer,
      execute: async (request) => {
        await implementations.runReviewer(commonInput(request), {
          model: request.model,
        });
      },
    },
  ]);
}

function commonInput(request: CourseAgentExecutionRequest) {
  return {
    abortSignal: request.abortSignal,
    beforeToolCall: request.beforeToolCall,
    repository: request.repository,
    runLeaseOwner: request.runLeaseOwner,
    traceId: request.traceId,
    workOrder: request.workOrder,
    workOrderLeaseOwner: request.workOrderLeaseOwner,
  };
}
