import type { DatabaseSync } from "node:sqlite";

import { CourseTaskRecordSchema } from "../../src/shared/course-schema";

/** 为直接测试 CourseRun Repository 的夹具建立真实 running TaskRecord。 */
export function seedRunningCourseTask(
  database: DatabaseSync,
  input: {
    taskId: string;
    courseId: string;
    traceId: string;
    now: string;
  },
) {
  const task = CourseTaskRecordSchema.parse({
    version: 1,
    taskId: input.taskId,
    courseId: input.courseId,
    traceId: input.traceId,
    userPrompt: "测试 CourseRun 控制围栏",
    source: "workflow",
    status: "running",
    createdAt: input.now,
    updatedAt: input.now,
  });
  database
    .prepare(`
      INSERT INTO course_tasks (
        id, course_id, payload, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      task.taskId,
      task.courseId,
      JSON.stringify(task),
      task.createdAt,
      task.updatedAt,
    );
  return task;
}
