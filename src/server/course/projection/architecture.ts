import {
  CourseDesignBriefsSchema,
  CourseIntentSchema,
  CoursePlanSchema,
  PageWorkerBriefSchema,
  type CourseArchitecture,
  type CourseCreationBrief,
  type CourseDesignBriefs,
  type CourseIntent,
  type CoursePlan,
  type PageTask,
  type PageWorkerBrief,
  type PedagogyPageGuidance,
  type StoryPageBeat,
  type VisualPageGuidance,
} from "@/shared/course-schema";

export type CourseArchitectureProjection = {
  intent: CourseIntent;
  outline: CoursePlan;
  briefs: CourseDesignBriefs;
  pageWorkerBriefs: PageWorkerBrief[];
};

/** CourseArchitecture 是唯一规划真相；这里为页面生成与产品 UI 构造稳定读模型。 */
export function projectCourseArchitecture(
  architecture: CourseArchitecture,
  creationBrief: CourseCreationBrief,
): CourseArchitectureProjection {
  const pageTasks = [...architecture.pageTasks].sort(
    (left, right) => left.order - right.order,
  );

  const intent = CourseIntentSchema.parse({
    topic: architecture.coursePack.topic,
    audienceAgeRange:
      architecture.blueprint.audience.ageRange ??
      defaultAudienceAgeRange(architecture.blueprint.audience.description),
    courseLength: pageTasks.length,
    learningGoal:
      creationBrief.goal ??
      architecture.blueprint.objectives.map(({ outcome }) => outcome).join("；"),
    priorKnowledge: architecture.blueprint.audience.priorKnowledge,
    successCriteria: architecture.blueprint.objectives.map(
      ({ evidence }) => evidence,
    ),
    visualStyle: architecture.blueprint.courseRules.visualStyle,
    difficulty: architecture.blueprint.audience.difficulty,
    mustInclude: uniqueStrings(
      pageTasks.flatMap(({ acceptance }) => acceptance.requiredConcepts),
    )
      .slice(0, 12)
      .map((value) => truncate(value, 80)),
    avoid: uniqueStrings(architecture.coursePack.constraints)
      .slice(0, 12)
      .map((value) => truncate(value, 80)),
    language: architecture.blueprint.language,
  });

  const objectiveById = new Map(
    architecture.blueprint.objectives.map((objective) => [
      objective.id,
      objective,
    ]),
  );
  const displayOrderByPageId = new Map(
    pageTasks.map(({ pageId, order }) => [pageId, order]),
  );
  const outline = CoursePlanSchema.parse({
    overview: ensureMinimumText(
      `${architecture.blueprint.title}：${creationBrief.goal ?? architecture.coursePack.topic}`,
      5,
    ),
    learningObjectives: architecture.blueprint.objectives.map(({ outcome }) =>
      ensureMinimumText(outcome, 5),
    ),
    pages: pageTasks.map((page) => ({
      id: page.pageId,
      order: page.order,
      pageType: page.pageType,
      title: page.title,
      learningObjective: truncate(
        ensureMinimumText(
          page.objectiveIds
            .map((objectiveId) => objectiveById.get(objectiveId)?.outcome)
            .filter((value): value is string => Boolean(value))
            .join("；"),
          5,
        ),
        300,
      ),
      contentSummary: truncate(
        ensureMinimumText(
          [page.purpose, ...page.teachingPoints].join("；"),
          5,
        ),
        500,
      ),
      interactionType: page.interactionType,
      assetNeeds: page.assetNeeds,
      functionalTemplateId: page.functionalTemplateId,
      styleTemplateId: page.styleTemplateId,
      assetIds: [],
      // CoursePlan 只表达学习顺序；真实生成依赖完整保留在 CourseArchitecture。
      dependsOnPageIds: page.buildDependsOnPageIds.filter(
        (dependencyId) =>
          (displayOrderByPageId.get(dependencyId) ?? page.order) <
          page.order,
      ),
      usedReferences: page.referenceUsages,
      status: "planned" as const,
    })),
  });

  const pedagogyByPage = new Map<string, PedagogyPageGuidance>(
    pageTasks.map((page) => [
      page.pageId,
      {
        pageId: page.pageId,
        cognitiveLevel: cognitiveLevelFor(page),
        scaffolding: page.teachingPoints.map((point) =>
          ensureMinimumText(point, 2),
        ),
        interactionPurpose: ensureMinimumText(page.learnerAction, 2),
        checkForUnderstanding: ensureMinimumText(
          page.assessment ?? page.acceptance.expectedLearnerOutcome,
          2,
        ),
      },
    ]),
  );
  const storyByPage = new Map<string, StoryPageBeat>(
    pageTasks.map((page, index) => [
      page.pageId,
      {
        pageId: page.pageId,
        beat: ensureMinimumText(page.purpose, 2),
        transition: ensureMinimumText(
          pageTasks[index + 1]
            ? `接下来学习${pageTasks[index + 1]!.title}`
            : "完成本课并回顾学习目标",
          2,
        ),
      },
    ]),
  );
  const visualByPage = new Map<string, VisualPageGuidance>(
    pageTasks.map((page) => {
      const visualDesign = page.visualDesign ?? {
        theme: `${page.title}的内容隐喻`,
        layout: `${page.pageType}页面围绕“${page.title}”建立主视觉，并让解释与“${page.learnerAction}”形成清晰阅读路径`,
        graphicMotif: `把“${page.teachingPoints.join("、")}”的知识关系转化为 HTML/CSS/内联 SVG 图形`,
      };
      return [
        page.pageId,
        {
          pageId: page.pageId,
          theme: ensureMinimumText(visualDesign.theme, 2),
          focalPoint: ensureMinimumText(
            `${visualDesign.theme}：${page.purpose}`,
            2,
          ),
          composition: ensureMinimumText(visualDesign.layout, 2),
          graphicMotif: ensureMinimumText(
            visualDesign.graphicMotif,
            2,
          ),
          assetPurpose: ensureMinimumText(
            page.assetNeeds.length > 0
              ? page.assetNeeds.map(({ purpose }) => purpose).join("；")
              : "本页以 graphicMotif 指定的代码原生知识图形作为主视觉",
            2,
          ),
        },
      ];
    }),
  );

  const briefs = CourseDesignBriefsSchema.parse({
    pedagogy: {
      audienceSummary: ensureMinimumText(
        architecture.blueprint.audience.description,
        5,
      ),
      ageAdaptation: {
        readingLevel: "使用适合目标学习者的短句和清晰术语",
        tone: ensureMinimumText(architecture.blueprint.courseRules.tone, 2),
        explanationDepth: "先给直观解释，再给例子与可观察的应用",
        chunkingStrategy: "每页只承担一个明确职责，重点分块呈现",
      },
      learningProgression:
        pageTasks.length >= 2
          ? pageTasks.map(({ purpose }) => ensureMinimumText(purpose, 5))
          : [
              ensureMinimumText(pageTasks[0]!.purpose, 5),
              ensureMinimumText(
                pageTasks[0]!.acceptance.expectedLearnerOutcome,
                5,
              ),
            ],
      interactionCadence: {
        recommendedIntervalPages: 2,
        maxPassivePages: 2,
        strategy: "讲解后尽快安排一次可操作的理解检查",
      },
      pageGuidance: [...pedagogyByPage.values()],
      misconceptions: [],
      accessibilityStrategies: [
        "保证文字对比度和清晰层级",
        "互动控件同时支持键盘操作",
      ],
    },
    story: {
      narrativeMode: "none",
      premise: ensureMinimumText(
        `围绕${architecture.coursePack.topic}完成一条连贯学习路径`,
        5,
      ),
      learnerRole: "主动学习者",
      mission: ensureMinimumText(
        creationBrief.goal ?? "理解并应用课程核心知识",
        5,
      ),
      characters: [],
      pageBeats: [...storyByPage.values()],
      tone: ensureMinimumText(architecture.blueprint.courseRules.tone, 2),
      continuityRules: [
        "术语与事实在所有页面保持一致",
        "每页承接课程目标但不重复上一页正文",
      ],
    },
    visual: {
      styleTemplateId: architecture.blueprint.courseRules.styleTemplateId,
      visualConcept: ensureMinimumText(
        architecture.blueprint.courseRules.visualDirection,
        5,
      ),
      layoutPrinciples: [
        "固定画布内保持单一视觉焦点",
        "用清晰层级区分讲解、示例和学习动作",
      ],
      typographyGuidance: "标题、正文和操作提示保持稳定层级并控制行长",
      colorUsage: "遵守样式模板色彩 Token，避免复制或创造临时颜色",
      assetDirection: {
        medium: "与课程主题一致的教育插图或信息图",
        composition: "主体清晰，预留文字区域，不遮挡互动控件",
        negativeConstraints: [
          "不要生成图片内文字",
          "不要使用与学习目标无关的装饰",
        ],
      },
      pageGuidance: [...visualByPage.values()],
      motionGuidance: {
        intensity: "subtle",
        strategy: "动效只用于状态反馈和注意力引导",
        reducedMotionAlternative: "降低动效时保留等价的静态状态提示",
      },
      accessibilityRules: [
        "不只依赖颜色表达状态",
        "图片和互动元素提供可理解的文本说明",
      ],
    },
  });

  const pageWorkerBriefs = pageTasks.map((page) =>
    PageWorkerBriefSchema.parse({
      pageId: page.pageId,
      styleTemplateId: page.styleTemplateId,
      pedagogy: pedagogyByPage.get(page.pageId),
      story: storyByPage.get(page.pageId),
      visual: visualByPage.get(page.pageId),
    }),
  );

  return { intent, outline, briefs, pageWorkerBriefs };
}

function cognitiveLevelFor(
  page: PageTask,
): PedagogyPageGuidance["cognitiveLevel"] {
  if (page.pageType === "comparison") return "analyze";
  if (
    page.pageType === "quiz" ||
    page.pageType === "achievement" ||
    page.interactionType === "input" ||
    page.interactionType === "sort"
  ) {
    return "apply";
  }
  if (page.pageType === "summary" || page.pageType === "cover") {
    return "remember";
  }
  return "understand";
}

function defaultAudienceAgeRange(description: string) {
  const explicitRange = description.match(
    /(\d{1,2})\s*(?:-|–|—|至|到|~)\s*(\d{1,2})\s*岁/,
  );
  if (explicitRange) {
    const first = Number(explicitRange[1]);
    const second = Number(explicitRange[2]);
    return {
      min: Math.min(first, second),
      max: Math.max(first, second),
      label: ensureMinimumText(truncate(description, 40), 2),
    };
  }

  const explicitAge = description.match(/(\d{1,2})\s*岁/);
  if (explicitAge) {
    const age = Number(explicitAge[1]);
    return {
      min: age,
      max: age,
      label: ensureMinimumText(truncate(description, 40), 2),
    };
  }

  const gradeAge = inferChineseGradeAge(description);
  if (gradeAge) {
    return {
      ...gradeAge,
      label: ensureMinimumText(truncate(description, 40), 2),
    };
  }

  return {
    min: 16,
    max: 65,
    label: ensureMinimumText(truncate(description, 40), 2),
  };
}

function inferChineseGradeAge(description: string) {
  const gradeNumbers: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const primary = description.match(/小学\s*([一二三四五六1-6])\s*年级/);
  if (primary) {
    const grade = Number(primary[1]) || gradeNumbers[primary[1]!]!;
    const age = grade + 5;
    return { min: age, max: age + 1 };
  }

  const secondary = description.match(/(初中|高中|初|高)\s*([一二三1-3])/);
  if (secondary) {
    const grade = Number(secondary[2]) || gradeNumbers[secondary[2]!]!;
    const baseAge = secondary[1] === "高中" || secondary[1] === "高" ? 15 : 12;
    const age = baseAge + grade - 1;
    return { min: age, max: age + 1 };
  }

  if (/幼儿园|学龄前/.test(description)) return { min: 3, max: 6 };
  if (/小学生/.test(description)) return { min: 6, max: 12 };
  return undefined;
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function ensureMinimumText(value: string, minimum: number) {
  const normalized = value.trim();
  if (normalized.length >= minimum) return normalized;
  return `${normalized || "课程"}学习说明`.slice(0, Math.max(minimum, 6));
}

function truncate(value: string, maximum: number) {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}
