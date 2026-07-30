import type {
  CourseCreationBrief,
  CourseLanguage,
  CourseLearningMode,
  CourseSectionCount,
} from "@/shared/course-schema";

export type {
  CourseCreationBrief,
  CourseLanguage,
  CourseLearningMode,
  CourseSectionCount,
};

export type ClarificationQuestion = {
  id: "goal" | "sectionCount";
  prompt: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
    recommended?: boolean;
  }>;
};

export type ClarificationQuestionId = ClarificationQuestion["id"];

type CourseCreationMessage = {
  role?: "assistant" | "user";
  content: string;
};

const DEFAULT_AUDIENCE = "初学者";

const goalQuestion: ClarificationQuestion = {
  id: "goal",
  prompt: "你最希望通过这门课做到什么？",
  options: [
    { label: "入门理解", value: "理解核心概念" },
    { label: "实际应用", value: "能够在实际场景中应用" },
    { label: "系统学习", value: "系统掌握知识与方法" },
    { label: "考试复习", value: "完成考试复习与重点巩固" },
  ],
};

/**
 * 从首条课程需求构建一个可继续补充的产品级简报。
 * 受众、学习方式、语言和自动规划使用可见默认值；只有学习目标可能需要继续确认。
 */
export function createCourseCreationBrief(
  request: string,
): CourseCreationBrief {
  const originalRequest = normalizeText(request);
  const topic = extractTopic(originalRequest);
  const audience = extractAudience(originalRequest) ?? DEFAULT_AUDIENCE;
  const explicitSectionCount = extractSectionCount(originalRequest);
  const learningMode = extractLearningMode(originalRequest) ?? "mixed";
  const language = extractLanguage(originalRequest) ?? "zh-CN";
  const explicitGoal = extractExplicitGoal(originalRequest);
  const goal =
    explicitGoal ??
    (isDetailedRequest(originalRequest, {
      audience: extractAudience(originalRequest),
      learningMode: extractLearningMode(originalRequest),
      sectionCount: explicitSectionCount,
    })
      ? defaultGoal(topic)
      : undefined);

  return {
    originalRequest,
    topic,
    audience,
    goal,
    sectionCount: explicitSectionCount ?? "auto",
    learningMode,
    language,
  };
}

/**
 * 把一次回答合并到已有简报。回答可以同时包含受众、节数和学习方式等多个字段。
 */
export function applyCourseCreationAnswer(
  brief: CourseCreationBrief,
  answer: string,
  questionId?: ClarificationQuestion["id"],
): CourseCreationBrief {
  const normalizedAnswer = normalizeText(answer);
  if (!normalizedAnswer) return brief;

  const audience = extractAudience(normalizedAnswer);
  const sectionCount = extractSectionCount(normalizedAnswer);
  const learningMode = extractLearningMode(normalizedAnswer);
  const language = extractLanguage(normalizedAnswer);
  const topic = extractTopicUpdate(normalizedAnswer);
  const explicitGoal = extractExplicitGoal(normalizedAnswer);
  const answeredGoal =
    questionId === "goal"
      ? extractGoalAnswer(normalizedAnswer, brief.topic)
      : undefined;

  return {
    ...brief,
    topic: topic ?? brief.topic,
    audience: audience ?? brief.audience,
    goal: explicitGoal ?? answeredGoal ?? brief.goal,
    sectionCount: sectionCount ?? brief.sectionCount,
    learningMode: learningMode ?? brief.learningMode,
    language: language ?? brief.language,
  };
}

/**
 * 根据持久化对话重新派生简报。Assistant 文案不参与字段提取。
 */
export function deriveCourseCreationBrief(
  messages: readonly CourseCreationMessage[],
): CourseCreationBrief {
  const userMessages = messages.filter(
    ({ content, role }) => role !== "assistant" && normalizeText(content),
  );
  const [firstMessage, ...answers] = userMessages;
  let brief = createCourseCreationBrief(firstMessage?.content ?? "");

  for (const message of answers) {
    brief = applyCourseCreationAnswer(
      brief,
      message.content,
      getNextClarificationQuestion(brief)?.id,
    );
  }

  return brief;
}

/**
 * 只在学习目标不明确时阻塞确认。章节数默认由课程内容和教学目标决定。
 */
export function getNextClarificationQuestion(
  brief: CourseCreationBrief,
): ClarificationQuestion | undefined {
  if (!brief.goal) return goalQuestion;
  return undefined;
}

/**
 * 将用户确认过的简报编译进现有任务 Prompt，确保澄清答案真正影响课程生成。
 */
export function buildCourseTaskPrompt(brief: CourseCreationBrief): string {
  const sectionCount =
    brief.sectionCount === undefined || brief.sectionCount === "auto"
      ? "由课芽根据知识依赖、内容深度、练习与总结需要自动规划；不设固定章节模板，不为压缩数量牺牲关键内容"
      : `${brief.sectionCount} 节`;
  const learningModeCopy: Record<CourseLearningMode, string> = {
    guided: "讲解为主",
    practice: "互动练习为主",
    mixed: "讲解与互动练习结合",
  };
  const languageCopy: Record<CourseLanguage, string> = {
    "zh-CN": "中文",
    "en-US": "英文",
    bilingual: "中英双语",
  };

  return [
    brief.originalRequest,
    "",
    "请按照以下已确认的课程简报生成互动 HTML 课程：",
    `- 课程主题：${brief.topic}`,
    `- 适合对象：${brief.audience}`,
    `- 学习目标：${brief.goal ?? defaultGoal(brief.topic)}`,
    `- 课程节数：${sectionCount}`,
    `- 学习方式：${learningModeCopy[brief.learningMode]}`,
    `- 课程语言：${languageCopy[brief.language]}`,
    "每一节都应形成可独立交互的 HTML 学习内容，并保持整门课程前后连贯。",
    "优先保证知识覆盖、循序渐进、示例、主动练习、反馈和总结的完整质量；不要为了凑数量拆分重复章节。",
  ].join("\n");
}

/**
 * 映射到 Course Task API。undefined 表示由服务端按课程内容自动规划章节数。
 */
export function resolveCourseSectionCount(
  brief: CourseCreationBrief,
): number | undefined {
  return brief.sectionCount === "auto" ? undefined : brief.sectionCount;
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function extractTopic(request: string) {
  if (!request) return "待确认的课程";

  let candidate = request.split(/[，,。；;\n]/, 1)[0]?.trim() ?? request;
  const generatedContent = candidate.match(/(?:生成|创建|制作)(.+)$/)?.[1];
  if (generatedContent) candidate = generatedContent.trim();

  candidate = candidate
    .replace(/^(?:请|帮我|请帮我|我想|我要|想要|给我)\s*/u, "")
    .replace(/^\d+\s*分钟\s*/u, "")
    .replace(/^(?:学习|学|了解|读懂|掌握|练习|练一段|练)\s*/u, "")
    .replace(
      /^(?:(?:\d+|[零一二三四五六七八九十百千万]+)\s*(?:节|课|章节|页)\s*)+/u,
      "",
    )
    .replace(/^(?:一门|一个|一套|一段)\s*/u, "")
    .replace(/(?:互动\s*HTML\s*)?(?:课程|课)$/iu, "")
    .trim();

  return candidate || request.slice(0, 60) || "待确认的课程";
}

function extractTopicUpdate(answer: string) {
  const matched = answer.match(
    /(?:课程)?主题(?:改成|改为|调整为|是)\s*([^，,。；;]+)/u,
  )?.[1];
  if (!matched) return undefined;
  return matched.replace(/(?:课程|课)$/u, "").trim() || undefined;
}

function extractAudience(value: string) {
  if (/零基础|完全不了解|从零开始|新手/u.test(value)) return "零基础";
  if (/进阶|高级学习者/u.test(value)) return "进阶学习者";
  if (/有(?:一定)?基础|学过但不熟/u.test(value)) return "有一定基础";
  if (/初学者|入门学习者|小白/u.test(value)) return "初学者";
  return undefined;
}

function extractSectionCount(value: string): CourseSectionCount | undefined {
  if (
    /交给课芽|自动(?:决定|安排|选择|页数|节数)?|你(?:来)?决定|自行决定|智能决定/u.test(
      value,
    )
  ) {
    return "auto";
  }

  const matched = value.match(
    /(?:^|[^\d])(\d+|[零一二三四五六七八九十百千万]+)\s*(?:节|课|章节|页面|页)(?:[^数]|$)/u,
  )?.[1];
  const count = matched ? parseSectionNumber(matched) : undefined;
  return count !== undefined && count > 0 ? count : undefined;
}

function parseSectionNumber(value: string) {
  const arabic = Number(value);
  if (Number.isSafeInteger(arabic)) return arabic;

  const digits: Record<string, number> = {
    零: 0,
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
  const units: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1_000,
    万: 10_000,
  };
  let total = 0;
  let section = 0;
  let currentDigit = 0;

  for (const character of value) {
    if (digits[character] !== undefined) {
      currentDigit = digits[character];
      continue;
    }

    const unit = units[character];
    if (!unit) return undefined;
    if (unit === 10_000) {
      total += (section + currentDigit) * unit;
      section = 0;
    } else {
      section += (currentDigit || 1) * unit;
    }
    currentDigit = 0;
  }

  return total + section + currentDigit;
}

function extractLearningMode(
  value: string,
): CourseLearningMode | undefined {
  if (/混合|讲解\s*[+＋和与]\s*(?:互动|练习)|讲练结合/u.test(value)) {
    return "mixed";
  }
  if (
    /练习为主|互动为主|实操为主|多(?:做)?(?:互动|练习|实操)|少(?:点)?讲解|讲解少/u.test(
      value,
    )
  ) {
    return "practice";
  }
  if (/讲解为主|理论为主|少(?:点)?练习/u.test(value)) return "guided";

  const hasGuidance = /讲解|讲授|理论/u.test(value);
  const hasPractice = /互动|练习|实操/u.test(value);
  if (hasGuidance && hasPractice) return "mixed";
  if (hasPractice) return "practice";
  if (hasGuidance) return "guided";
  return undefined;
}

function extractLanguage(value: string): CourseLanguage | undefined {
  if (/中英双语|双语/u.test(value)) return "bilingual";
  if (/全英文|使用英文|用英文|英文授课|英语授课/u.test(value)) {
    return "en-US";
  }
  if (/全中文|使用中文|用中文|中文授课/u.test(value)) return "zh-CN";
  return undefined;
}

function extractExplicitGoal(value: string) {
  const labelledGoal = value.match(
    /(?:学习目标|课程目标|目标)(?:是|为|：|:)?\s*([^，,。；;]+)/u,
  )?.[1];
  if (labelledGoal) return labelledGoal.trim();

  const purpose = value.match(
    /(?:为了|希望(?:通过这门课)?|以便)\s*([^，,。；;]+)/u,
  )?.[1];
  if (purpose) return purpose.trim();

  const action = value.match(
    /((?:学会|掌握|理解|读懂|应用|复习|备考|提升|练一段|补上)[^，,。；;]*)/u,
  )?.[1];
  return action?.trim();
}

function extractGoalAnswer(answer: string, topic: string) {
  if (/交给课芽|你(?:来)?决定|自动决定/u.test(answer)) {
    return defaultGoal(topic);
  }

  const segments = answer
    .split(/[，,；;]/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const goalSegment = segments.find(
    (segment) => !isPreferenceOnlySegment(segment),
  );
  return goalSegment;
}

function isPreferenceOnlySegment(segment: string) {
  return (
    extractAudience(segment) !== undefined ||
    extractSectionCount(segment) !== undefined ||
    extractLearningMode(segment) !== undefined ||
    extractLanguage(segment) !== undefined ||
    /^(?:给|适合|面向)/u.test(segment)
  );
}

function isDetailedRequest(
  request: string,
  signals: {
    audience?: string;
    learningMode?: CourseLearningMode;
    sectionCount?: CourseSectionCount;
  },
) {
  const signalCount = [
    signals.audience,
    signals.learningMode,
    signals.sectionCount,
  ].filter((value) => value !== undefined).length;

  return signalCount >= 2 || (request.length >= 28 && signalCount >= 1);
}

function defaultGoal(topic: string) {
  return `理解并应用${topic}的核心内容`;
}
