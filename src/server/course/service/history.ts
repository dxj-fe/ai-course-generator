import {
  createCourseStore,
  type CourseStore,
} from "@/server/course/store/course";
import {
  createCourseTaskStore,
  type CourseTaskStore,
} from "@/server/course/store/task";
import {
  CourseHistoryDetailResponseSchema,
  CourseHistoryListResponseSchema,
  CourseIdSchema,
  CourseRunSummarySchema,
  type CourseGenerationState,
  type CourseHistoryItem,
  type CourseTaskRecord,
} from "@/shared/course-schema";

export type CourseHistoryQuery = {
  query?: string;
  status?: CourseGenerationState["status"];
};

export type CourseHistoryService = {
  list(query?: CourseHistoryQuery): Promise<
    ReturnType<typeof CourseHistoryListResponseSchema.parse>
  >;
  load(courseId: string): Promise<
    ReturnType<typeof CourseHistoryDetailResponseSchema.parse> | undefined
  >;
};

export function createCourseHistoryService(input: {
  courseStore?: CourseStore;
  taskStore?: CourseTaskStore;
} = {}): CourseHistoryService {
  const courseStore = input.courseStore ?? createCourseStore();
  const taskStore = input.taskStore ?? createCourseTaskStore();

  return {
    async list(query = {}) {
      const [courses, tasks] = await Promise.all([
        courseStore.list(),
        taskStore.list(),
      ]);
      const tasksByCourse = groupTasksByCourse(tasks.items);
      const normalizedQuery = query.query?.trim().toLocaleLowerCase("zh-CN");
      const items = courses.items
        .filter((course) => tasksByCourse.has(course.courseId))
        .map((course) =>
          historyItem(course, tasksByCourse.get(course.courseId) ?? []),
        )
        .filter((item) => !query.status || item.status === query.status)
        .filter(
          (item) =>
            !normalizedQuery ||
            `${item.title}\n${item.prompt}\n${item.courseId}`
              .toLocaleLowerCase("zh-CN")
              .includes(normalizedQuery),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      return CourseHistoryListResponseSchema.parse({
        items: items.slice(0, 100),
        total: items.length,
        unavailableCount:
          courses.unavailableCount + tasks.unavailableCount,
      });
    },

    async load(courseId) {
      const safeCourseId = CourseIdSchema.parse(courseId);
      const [course, tasks] = await Promise.all([
        courseStore.load(safeCourseId),
        taskStore.list(),
      ]);
      const courseTasks = tasks.items
        .filter((task) => task.courseId === safeCourseId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      if (!course || !courseTasks[0]) {
        return undefined;
      }

      return CourseHistoryDetailResponseSchema.parse({
        course,
        runs: courseTasks.map(runSummary),
      });
    },
  };
}

function groupTasksByCourse(tasks: CourseTaskRecord[]) {
  const grouped = new Map<string, CourseTaskRecord[]>();
  for (const task of tasks) {
    const entries = grouped.get(task.courseId) ?? [];
    entries.push(task);
    grouped.set(task.courseId, entries);
  }
  for (const entries of grouped.values()) {
    entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  return grouped;
}

function historyItem(
  course: CourseGenerationState,
  tasks: CourseTaskRecord[],
): CourseHistoryItem {
  const title = course.intent?.topic.trim() || course.userPrompt.trim();
  const firstPage = course.pages.find(({ order }) => order === 1);
  const cover =
    firstPage?.status === "completed" && firstPage.htmlOutput
      ? {
          pageId: firstPage.pageId,
          revision: firstPage.htmlOutput.revision,
          generatedAt: firstPage.htmlOutput.generatedAt,
        }
      : undefined;

  return {
    courseId: course.courseId,
    title: title.length > 160 ? `${title.slice(0, 159)}…` : title,
    prompt: course.userPrompt,
    status: course.status,
    currentStage: course.currentStage,
    totalPages: course.outline?.pages.length ?? course.pages.length,
    completedPages: course.pages.filter(({ status }) => status === "completed")
      .length,
    referenceCount: course.referencePacks?.length ?? 0,
    runCount: tasks.length,
    exportable: course.status === "completed",
    startedAt: course.startedAt,
    updatedAt: course.updatedAt,
    completedAt: course.completedAt,
    latestRun: tasks[0] ? runSummary(tasks[0]) : undefined,
    cover,
  };
}

function runSummary(task: CourseTaskRecord) {
  return CourseRunSummarySchema.parse({
    taskId: task.taskId,
    traceId: task.traceId,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    error: task.error,
  });
}
