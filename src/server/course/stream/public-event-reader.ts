import {
  createCoursePublicEventProjectionContext,
  projectCoursePublicEvents,
} from "@/server/course/projection/public-events";
import { createCourseArtifactStore } from "@/server/course/store/artifact";
import {
  type AppDatabaseOptions,
  resolveAppDatabase,
} from "@/server/infra/database/connection";
import { createCourseRunEventStore } from "@/server/course/store/run-event";
import { createCourseRunStore } from "@/server/course/store/run";
import { createWorkOrderStore } from "@/server/course/store/work-order";
import {
  CourseArchitectureSchema,
  type CourseGenerationPublicEvent,
} from "@/shared/course-schema";

export type CoursePublicEventBatch = {
  traceId?: string;
  scannedThroughSequence: number;
  events: CourseGenerationPublicEvent[];
};

export type CoursePublicEventReader = {
  /**
   * 直接按 course_run_events 的持久化 sequence 增量读取。返回游标可能大于
   * events 最后一项，因为旧 trace 或旧 revision 事件会被安全过滤。
   */
  listAfter(input: {
    taskId: string;
    traceId: string;
    afterSequence: number;
  }): CoursePublicEventBatch;
};

/**
 * 为 SSE 提供跨进程增量事件。整个读取使用同一 SQLite read transaction，
 * 避免 revision 原子切换时拿到新事件配旧 CourseRun 指针并永久跳过事件。
 */
export function createCoursePublicEventReader(
  options: AppDatabaseOptions = {},
): CoursePublicEventReader {
  const database = resolveAppDatabase(options);
  const sharedOptions = { database };
  const runs = createCourseRunStore(sharedOptions);
  const workOrders = createWorkOrderStore(sharedOptions);
  const artifacts = createCourseArtifactStore(sharedOptions);
  const events = createCourseRunEventStore(sharedOptions);

  return {
    listAfter(input) {
      if (
        !Number.isSafeInteger(input.afterSequence) ||
        input.afterSequence < 0
      ) {
        throw new Error("Course public event afterSequence 必须是非负安全整数");
      }

      let transactionOpen = true;
      database.exec("BEGIN");
      try {
        const run = runs.loadByTaskId(input.taskId);
        if (!run || run.traceId !== input.traceId) {
          database.exec("COMMIT");
          transactionOpen = false;
          return {
            traceId: run?.traceId,
            scannedThroughSequence: input.afterSequence,
            events: [],
          };
        }

        const rawEvents = events.listAfter({
          taskId: input.taskId,
          afterSequence: input.afterSequence,
        });
        const scannedThroughSequence =
          rawEvents.at(-1)?.sequence ?? input.afterSequence;
        const architectureRef = run.activeArchitecture?.architectureRef;
        const architectureArtifact = architectureRef
          ? artifacts.load(architectureRef.id)
          : undefined;
        const architecture = architectureRef
          ? CourseArchitectureSchema.parse(architectureArtifact?.payload)
          : undefined;
        const context = createCoursePublicEventProjectionContext({
          run,
          architecture,
          workOrders: workOrders.listByTask(input.taskId),
        });
        const publicEvents = projectCoursePublicEvents({
          ...context,
          events: rawEvents,
          historyLimit: null,
        });

        database.exec("COMMIT");
        transactionOpen = false;
        return {
          traceId: run.traceId,
          scannedThroughSequence,
          events: publicEvents,
        };
      } catch (error) {
        if (transactionOpen) database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
