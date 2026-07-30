import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkDemoCourse,
  DemoBaselineSchema,
} from "../../../scripts/check-course";
import {
  CourseGenerationStateSchema,
  PageContentDSLSchema,
  QualityReportSchema,
  type CourseGenerationState,
} from "../../../src/shared/course-schema";
import {
  courseDesignIntent,
  courseDesignOutline,
  pageContentDsl,
  pedagogyPlan,
  storyArc,
  visualBrief,
} from "../../fixtures/course-design";
import { buildValidGeneratedHtml } from "../../fixtures/generated-html";

const baseline = DemoBaselineSchema.parse({
  version: 1,
  id: "solar-system-test",
  name: "太阳系测试",
  prompt: "为儿童生成一门三页太阳系测试课程。",
  pageCount: 3,
  expectedOutline: [
    {
      order: 1,
      purpose: "建立目标",
      allowedPageTypes: ["cover"],
      allowedInteractionTypes: ["navigate"],
    },
    {
      order: 2,
      purpose: "解释知识",
      allowedPageTypes: ["knowledge_card"],
      allowedInteractionTypes: ["reveal"],
    },
    {
      order: 3,
      purpose: "完成总结",
      allowedPageTypes: ["summary"],
      allowedInteractionTypes: ["navigate"],
    },
  ],
  requiredConcepts: [
    { label: "太阳系", anyOf: ["太阳系"] },
    { label: "恒星与行星", anyOf: ["恒星", "行星"] },
  ],
  quality: {
    minOverallScore: 85,
    minDimensionScore: 80,
    requireScreenshotEvidence: true,
  },
  manualReview: { minimumTotal: 24, minimumDimension: 3 },
});

describe("Day 36 course checker", () => {
  it("accepts a completed course with semantic outline, HTML, QA, screenshots and export", () => {
    const course = completedCourse();
    const report = checkDemoCourse({
      course,
      baseline,
      archiveBytes: archiveFor(course),
      now: () => "2026-07-23T02:00:00.000Z",
    });

    expect(report).toMatchObject({
      passed: true,
      baselineId: "solar-system-test",
      courseId: course.courseId,
      metrics: {
        actualPages: 3,
        qaPages: 3,
        screenshotPages: 3,
        firstPassAcceptedPages: 3,
        firstPassAcceptanceRate: 1,
        modelFirstPassAcceptedPages: 3,
        modelFirstPassAcceptanceRate: 1,
        modelRenderedPages: 3,
        modelRenderRate: 1,
        requestedAssets: 0,
        readyAssets: 0,
        fallbackAssets: 0,
        assetReadyRate: 1,
        architectureAttempts: 1,
        architectureRevisions: 0,
        replanCount: 0,
        courseRevisionCount: 0,
        courseFirstPassAccepted: true,
        repairAttemptCount: 0,
        averageRepairAttempts: 0,
        averageOverallScore: 95,
        averageVisualScore: 95,
        compositeScore: 97,
        minimumOverallScore: 95,
        archiveEntryCount: 5,
      },
      issues: [],
    });
  });

  it("reports semantic, HTML, QA and archive failures with page context", () => {
    const course = completedCourse();
    const broken = {
      ...course,
      outline: {
        ...course.outline!,
        overview: "一门普通课程。",
        learningObjectives: ["完成普通学习任务。"],
        pages: course.outline!.pages.map((page) => ({
          ...page,
          title: `普通页面 ${page.order}`,
          learningObjective: "完成本页的普通学习任务。",
          contentSummary: "普通课程内容。",
        })),
      },
      pages: course.pages.map((page, index) =>
        index === 1
          ? {
              ...page,
              htmlOutput: {
                ...page.htmlOutput!,
                html: page.htmlOutput!.html.replace(/<style>[\s\S]*?<\/style>/, ""),
              },
              qualityReport: {
                ...page.qualityReport!,
                overallScore: 70,
                dimensions: {
                  ...page.qualityReport!.dimensions,
                  layoutQuality: {
                    ...page.qualityReport!.dimensions.layoutQuality,
                    score: 70,
                  },
                },
              },
            }
          : page,
      ),
    };
    const entries = expectedArchiveEntries(course).filter(
      (entry) => entry !== "assets/manifest.json",
    );
    const report = checkDemoCourse({
      course: broken,
      baseline,
      archiveBytes: fakeZip(entries),
    });

    expect(report.passed).toBe(false);
    expect(report.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "OUTLINE_CONCEPT_MISSING",
        "HTML_CONTRACT_FAILED",
        "QUALITY_OVERALL_BELOW_BASELINE",
        "QUALITY_DIMENSION_BELOW_BASELINE",
        "ARCHIVE_ENTRY_MISSING",
      ]),
    );
    expect(
      report.issues.find(({ code }) => code === "HTML_CONTRACT_FAILED")?.pageId,
    ).toBe("page-02-knowledge");
  });

  it("reports invalid course payloads without throwing", () => {
    const report = checkDemoCourse({
      course: { status: "completed" },
      baseline,
    });

    expect(report.passed).toBe(false);
    expect(report.issues.some(({ code }) => code === "COURSE_SCHEMA_INVALID")).toBe(
      true,
    );
  });

  it("does not mistake deterministic HTML fallback for model quality", () => {
    const course = completedCourse();
    const firstPage = course.pages[0]!;
    const fallbackCourse = {
      ...course,
      pages: [
        {
          ...firstPage,
          htmlOutput: {
            ...firstPage.htmlOutput!,
            html: firstPage.htmlOutput!.html.replace(
              "<html",
              '<html data-keya-renderer="deterministic"',
            ),
          },
        },
        ...course.pages.slice(1),
      ],
    };

    const report = checkDemoCourse({
      course: fallbackCourse,
      baseline,
      archiveBytes: archiveFor(course),
    });

    expect(report.passed).toBe(false);
    expect(report.metrics.firstPassAcceptedPages).toBe(3);
    expect(report.metrics.modelFirstPassAcceptedPages).toBe(2);
    expect(report.metrics.modelRenderedPages).toBe(2);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "DETERMINISTIC_HTML_FALLBACK_USED",
        pageId: firstPage.pageId,
      }),
    );
  });

  it("keeps all checked-in Demo baseline files schema-valid", async () => {
    for (const fileName of [
      "mars-exploration.json",
      "solar-system.json",
      "ai-literacy.json",
    ]) {
      const source = await readFile(
        path.join(process.cwd(), "docs", "demo", "baselines", fileName),
        "utf8",
      );
      expect(DemoBaselineSchema.safeParse(JSON.parse(source)).success).toBe(true);
    }
  });
});

function completedCourse(): CourseGenerationState {
  const completedAt = "2026-07-23T01:59:00.000Z";
  const contents = courseDesignOutline.pages.map((page) =>
    PageContentDSLSchema.parse({
      ...pageContentDsl,
      pageId: page.id,
      functionalTemplateId: page.functionalTemplateId,
      title: page.title,
      interaction:
        page.interactionType === "reveal"
          ? pageContentDsl.interaction
          : {
              type: "navigate",
              actionLabel:
                page.pageType === "summary" ? "完成课程" : "继续学习",
              destination:
                page.pageType === "summary" ? "course-home" : "next",
            },
    }),
  );

  return CourseGenerationStateSchema.parse({
    version: 1,
    courseId: "course-demo-solar-system",
    traceId: "trace-demo-solar-system",
    userPrompt: baseline.prompt,
    status: "completed",
    currentStage: "complete",
    intent: courseDesignIntent,
    outline: courseDesignOutline,
    briefs: {
      pedagogy: pedagogyPlan,
      story: storyArc,
      visual: visualBrief,
    },
    pageWorkerBriefs: courseDesignOutline.pages.map((page, index) => ({
      pageId: page.id,
      styleTemplateId: visualBrief.styleTemplateId,
      pedagogy: pedagogyPlan.pageGuidance[index],
      story: storyArc.pageBeats[index],
      visual: visualBrief.pageGuidance[index],
    })),
    workerConfig: { mode: "serial", concurrency: 1 },
    generationMetrics: {
      architectureAttemptCount: 1,
      architectureRevisionCount: 0,
      replanCount: 0,
      courseRevisionCount: 0,
    },
    pages: courseDesignOutline.pages.map((page, index) => ({
      pageId: page.id,
      order: page.order,
      status: "completed",
      currentStage: "complete",
      content: contents[index],
      assets: [],
      htmlOutput: {
        version: 1,
        html: buildValidGeneratedHtml(contents[index]!),
        generatedAt: completedAt,
      },
      qualityReport: qualityReport(page.id, completedAt),
    })),
    events: [],
    errors: [],
    startedAt: "2026-07-23T01:50:00.000Z",
    updatedAt: completedAt,
    completedAt,
    durationMs: 540_000,
  });
}

function qualityReport(pageId: string, createdAt: string) {
  return QualityReportSchema.parse({
    id: `quality-${pageId}`,
    target: { type: "page", pageId },
    overallScore: 95,
    dimensions: {
      contentAccuracy: { score: 95, summary: "内容准确。" },
      layoutQuality: { score: 95, summary: "布局清楚。" },
      courseCoherence: { score: 95, summary: "教学连贯。" },
      styleConsistency: { score: 95, summary: "风格一致。" },
      htmlRuntime: { score: 95, summary: "运行正常。" },
      assetUsability: { score: 95, summary: "素材可用。" },
    },
    issues: [],
    screenshotEvidence: {
      status: "captured",
      artifactId: `artifact-${pageId}`,
      viewport: { width: 1440, height: 900 },
      metrics: {
        documentWidth: 1440,
        documentHeight: 900,
        horizontalOverflowPx: 0,
        clippedElementCount: 0,
        zeroSizeInteractiveCount: 0,
      },
      capturedAt: createdAt,
    },
    shouldRepair: false,
    decision: "pass",
    createdAt,
  });
}

function archiveFor(course: CourseGenerationState) {
  return fakeZip(expectedArchiveEntries(course));
}

function expectedArchiveEntries(course: CourseGenerationState) {
  return [
    "course.json",
    ...course.pages.map(
      (page) =>
        `pages/${String(page.order).padStart(2, "0")}-${page.pageId}.html`,
    ),
    "assets/manifest.json",
  ];
}

function fakeZip(entries: string[]) {
  const encoder = new TextEncoder();
  const centralEntries = entries.map((entry) => {
    const name = encoder.encode(entry);
    const bytes = new Uint8Array(46 + name.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(28, name.length, true);
    bytes.set(name, 46);
    return bytes;
  });
  const length = 4 + centralEntries.reduce((total, entry) => total + entry.length, 0);
  const result = new Uint8Array(length);
  result.set([0x50, 0x4b, 0x03, 0x04]);
  let offset = 4;
  for (const entry of centralEntries) {
    result.set(entry, offset);
    offset += entry.length;
  }
  return result;
}
