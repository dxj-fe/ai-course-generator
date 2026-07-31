import type {
  CourseGenerationState,
  LessonRuntime,
  PageContentInteraction,
  PageInteractionType,
} from "@/shared/course-schema";

export type CoursePlayerSectionGenerationStatus =
  | "ready"
  | "generating"
  | "failed"
  | "pending";

export type CoursePlayerSection = {
  id: string;
  order: number;
  title: string;
  learningObjective: string;
  interactionType: PageInteractionType;
  generationStatus: CoursePlayerSectionGenerationStatus;
  html?: string;
  htmlRevision?: number;
  interaction?: PageContentInteraction;
  runtime?: LessonRuntime;
  narration: string[];
};

export type CoursePlayerManifest = {
  courseId: string;
  title: string;
  overview?: string;
  sections: CoursePlayerSection[];
};

export type CoursePlayerDirection = "previous" | "next";

/**
 * 将持久化生成状态收敛为学习者播放器所需的最小数据。
 * Agent 事件、错误、QA、Repair、Trace 等内部状态不得进入该投影。
 */
export function buildCoursePlayerManifest(
  course: CourseGenerationState,
): CoursePlayerManifest {
  const sections = [...(course.outline?.pages ?? [])]
    .sort((left, right) => left.order - right.order)
    .map((page): CoursePlayerSection => {
      const generatedPage = course.pages.find(
        ({ pageId }) => pageId === page.id,
      );
      const generationStatus = toPlayerGenerationStatus(generatedPage);
      const readyHtml =
        generationStatus === "ready" ? generatedPage?.htmlOutput : undefined;
      const content =
        generationStatus === "ready" ? generatedPage?.content : undefined;

      return {
        id: page.id,
        order: page.order,
        title: page.title,
        learningObjective: page.learningObjective,
        interactionType: page.interactionType,
        generationStatus,
        ...(readyHtml
          ? {
              html: readyHtml.html,
              htmlRevision: readyHtml.revision,
            }
          : {}),
        ...(content
          ? {
              interaction: content.interaction,
              runtime: content.runtime,
            }
          : {}),
        narration: [...(generatedPage?.content?.narration ?? [])],
      };
    });

  return {
    courseId: course.courseId,
    title: course.intent?.topic.trim() || "未命名课程",
    ...(course.outline?.overview
      ? { overview: course.outline.overview }
      : {}),
    sections,
  };
}

export function getInitialCourseSectionId(
  manifest: CoursePlayerManifest,
  storedId?: string,
) {
  if (
    storedId &&
    manifest.sections.some(
      ({ generationStatus, id }) =>
        id === storedId && generationStatus === "ready",
    )
  ) {
    return storedId;
  }

  return manifest.sections.find(
    ({ generationStatus }) => generationStatus === "ready",
  )?.id;
}

export function getAdjacentReadySectionId(
  manifest: CoursePlayerManifest,
  currentId: string,
  direction: CoursePlayerDirection,
) {
  const currentIndex = manifest.sections.findIndex(
    ({ id }) => id === currentId,
  );
  if (
    currentIndex < 0 ||
    manifest.sections[currentIndex]?.generationStatus !== "ready"
  ) {
    return undefined;
  }

  const step = direction === "next" ? 1 : -1;
  for (
    let index = currentIndex + step;
    index >= 0 && index < manifest.sections.length;
    index += step
  ) {
    const section = manifest.sections[index];
    if (section?.generationStatus === "ready") return section.id;
  }

  return undefined;
}

function toPlayerGenerationStatus(
  page: CourseGenerationState["pages"][number] | undefined,
): CoursePlayerSectionGenerationStatus {
  if (!page || page.status === "pending") return "pending";
  if (page.status === "running") return "generating";
  if (page.status === "failed") return "failed";
  return page.htmlOutput ? "ready" : "pending";
}
