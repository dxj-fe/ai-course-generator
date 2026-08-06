import { describe, expect, it } from "vitest";

import {
  applyCourseCreationAnswer,
  buildCourseTaskPrompt,
  createCourseCreationBrief,
  deriveCourseCreationBrief,
  getNextClarificationQuestion,
  resolveCourseSectionCount,
} from "../../../src/features/keya/course-creation-model";

describe("course creation model", () => {
  it("does not ask for a goal when a detailed request is already sufficient", () => {
    const brief = createCourseCreationBrief(
      "为零基础职场新人生成 5 节地道英文面试对话课，每节包含简短讲解和互动练习。",
    );

    expect(brief).toMatchObject({
      topic: "地道英文面试对话",
      audience: "零基础",
      sectionCount: 5,
      learningMode: "mixed",
      language: "zh-CN",
    });
    expect(brief.goal).toContain("地道英文面试对话");
    expect(getNextClarificationQuestion(brief)).toBeUndefined();
  });

  it("keeps a numeric child audience separate from section count and topic", () => {
    const brief = createCourseCreationBrief(
      "为 10 岁孩子制作一门 4 节的太阳系互动课程，用探索任务认识行星，包含比较和小测验。",
    );

    expect(brief).toMatchObject({
      topic: "太阳系",
      audience: "10 岁儿童",
      sectionCount: 4,
      learningMode: "practice",
    });
    expect(brief.goal).toContain("太阳系");
  });

  it("prefers an explicitly quoted topic over generic course-format words", () => {
    const brief = createCourseCreationBrief(
      "请为 12 岁初学者制作一个 5 页互动微课，主题是“三步看懂色彩搭配”。",
    );

    expect(brief).toMatchObject({
      topic: "三步看懂色彩搭配",
      audience: "12 岁儿童",
      sectionCount: 5,
    });
  });

  it("recognizes a concrete post-course outcome with comma-separated criteria", () => {
    const brief = createCourseCreationBrief(
      "色彩搭配。学完后，学习者应能从色相关系、面积比例、明度层级三个方面判断并改进一组配色。",
    );

    expect(brief.goal).toBe(
      "能从色相关系、面积比例、明度层级三个方面判断并改进一组配色",
    );
  });

  it("allows a follow-up to correct an incorrectly inferred topic", () => {
    const brief = applyCourseCreationAnswer(
      createCourseCreationBrief("制作一个 5 页互动微课"),
      "请把课程主题更正为“三步看懂色彩搭配”。",
    );

    expect(brief.topic).toBe("三步看懂色彩搭配");
  });

  it("asks a broad request only for its goal and lets the backend plan sections", () => {
    const brief = createCourseCreationBrief("帮我学英语");

    expect(brief).toMatchObject({
      topic: "英语",
      audience: "初学者",
      sectionCount: "auto",
      learningMode: "mixed",
      language: "zh-CN",
    });
    expect(brief.goal).toBeUndefined();
    expect(getNextClarificationQuestion(brief)?.id).toBe("goal");

    const withGoal = applyCourseCreationAnswer(brief, "日常交流", "goal");

    expect(withGoal.goal).toBe("日常交流");
    expect(getNextClarificationQuestion(withGoal)).toBeUndefined();
  });

  it("merges multiple fields from one follow-up answer", () => {
    const brief = applyCourseCreationAnswer(
      createCourseCreationBrief("帮我学英语"),
      "目标是完成日常交流，给有基础的学习者，做 3 节，讲解少一点，多做互动。",
      "goal",
    );

    expect(brief).toMatchObject({
      audience: "有一定基础",
      goal: "完成日常交流",
      sectionCount: 3,
      learningMode: "practice",
    });
    expect(getNextClarificationQuestion(brief)).toBeUndefined();
  });

  it("recognizes any positive explicit section count and automatic planning", () => {
    const base = applyCourseCreationAnswer(
      createCourseCreationBrief("帮我学英语"),
      "职场沟通",
      "goal",
    );
    const eightSections = applyCourseCreationAnswer(
      base,
      "安排 8 节系统学习",
      "sectionCount",
    );
    const oneSection = applyCourseCreationAnswer(
      base,
      "1 节微课",
      "sectionCount",
    );
    const twentySections = applyCourseCreationAnswer(
      base,
      "二十章节",
      "sectionCount",
    );
    const oneHundredTwentySections = applyCourseCreationAnswer(
      base,
      "安排 120 节完整课程",
      "sectionCount",
    );
    const automatic = applyCourseCreationAnswer(
      base,
      "交给课芽",
      "sectionCount",
    );

    expect(eightSections.sectionCount).toBe(8);
    expect(resolveCourseSectionCount(eightSections)).toBe(8);
    expect(oneSection.sectionCount).toBe(1);
    expect(twentySections.sectionCount).toBe(20);
    expect(oneHundredTwentySections.sectionCount).toBe(120);
    expect(automatic.sectionCount).toBe("auto");
    expect(resolveCourseSectionCount(automatic)).toBeUndefined();
  });

  it("removes an arbitrary explicit section count from the inferred topic", () => {
    const brief = createCourseCreationBrief(
      "120 节 TypeScript 课程，目标是系统掌握类型系统",
    );

    expect(brief.topic).toBe("TypeScript");
    expect(brief.sectionCount).toBe(120);
  });

  it("derives the latest brief from user messages and ignores assistant copy", () => {
    const brief = deriveCourseCreationBrief([
      { role: "user", content: "帮我学英语" },
      { role: "assistant", content: "你最希望通过这门课做到什么？" },
      {
        role: "user",
        content: "旅行交流，给初学者，练习为主",
      },
      { role: "assistant", content: "你希望课程分成几节？" },
      { role: "user", content: "五节完整学习" },
    ]);

    expect(brief).toMatchObject({
      originalRequest: "帮我学英语",
      topic: "英语",
      audience: "初学者",
      goal: "旅行交流",
      sectionCount: 5,
      learningMode: "practice",
    });
  });

  it.each([
    ["讲解为主", "guided"],
    ["互动练习为主", "practice"],
    ["简短讲解和互动练习", "mixed"],
  ] as const)("recognizes the %s learning mode", (answer, learningMode) => {
    const brief = applyCourseCreationAnswer(
      createCourseCreationBrief("目标是理解太阳系，3 节"),
      answer,
    );

    expect(brief.learningMode).toBe(learningMode);
  });

  it("recognizes bilingual and English teaching-language preferences", () => {
    const base = createCourseCreationBrief("目标是练习面试表达，3 节");

    expect(
      applyCourseCreationAnswer(base, "课程使用中英双语").language,
    ).toBe("bilingual");
    expect(applyCourseCreationAnswer(base, "请用英文授课").language).toBe(
      "en-US",
    );
  });

  it("builds a task prompt containing every confirmed brief field", () => {
    const brief = applyCourseCreationAnswer(
      createCourseCreationBrief("帮我学英语"),
      "目标是职场沟通，给零基础学习者，4 节，讲解与互动结合，中英双语",
      "goal",
    );
    const prompt = buildCourseTaskPrompt(brief);

    expect(prompt).toContain("课程主题：英语");
    expect(prompt).toContain("适合对象：零基础");
    expect(prompt).toContain("学习目标：职场沟通");
    expect(prompt).toContain("课程节数：4 节");
    expect(prompt).toContain("学习方式：讲解与互动练习结合");
    expect(prompt).toContain("课程语言：中英双语");
    expect(resolveCourseSectionCount(brief)).toBe(4);
  });

  it("keeps the automatic section mapping explicit in the generated prompt", () => {
    const brief = applyCourseCreationAnswer(
      applyCourseCreationAnswer(
        createCourseCreationBrief("帮我学英语"),
        "日常交流",
        "goal",
      ),
      "自动安排",
      "sectionCount",
    );

    const prompt = buildCourseTaskPrompt(brief);

    expect(prompt).toContain("课程节数：由课芽根据知识依赖");
    expect(prompt).toContain("不为压缩数量牺牲关键内容");
    expect(prompt).not.toContain("自动安排 3–5 节");
    expect(resolveCourseSectionCount(brief)).toBeUndefined();
  });
});
