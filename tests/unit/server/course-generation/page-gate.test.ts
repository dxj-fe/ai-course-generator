import { describe, expect, it } from "vitest";

import { runPageGate } from "../../../../src/server/course/gate/page";
import { renderDeterministicPageFallback } from "../../../../src/server/course/page/deterministic-fallback";
import { buildPageQualityReport } from "../../../../src/server/course/page/quality/report";
import type {
  CourseArchitecture,
  PageContentDSL,
  QualityScreenshotEvidence,
} from "../../../../src/shared/course-schema";
import { getStyleTemplate } from "../../../../src/shared/templates/style";

const COURSE_ID = "course-page-gate-test";
const PAGE_ID = "page-concept";
const NOW = "2026-07-29T10:00:00.000Z";

const screenshotEvidence: QualityScreenshotEvidence = {
  captures: [
    ["desktop", 922, 500],
    ["tablet", 768, 500],
    ["mobile", 366, 500],
  ].map(([label, width, height]) => ({
      status: "captured",
      artifactId: `screenshot-page-concept-${label}`,
      viewport: { width: Number(width), height: Number(height) },
      metrics: {
        documentWidth: Number(width),
        documentHeight: Number(height),
        horizontalOverflowPx: 0,
        clippedElementCount: 0,
        zeroSizeInteractiveCount: 0,
      },
      capturedAt: NOW,
    })),
};

describe("页面确定性 Gate", () => {
  it("只有内容、HTML、安全、截图和质量全部通过才生成受控摘要", () => {
    const candidate = validCandidate();
    const result = runPageGate({
      architecture: architecture(),
      creationBrief: creationBrief(),
      referencePacks: [],
      pageId: PAGE_ID,
      ...candidate,
    });

    expect(
      result.ok,
      result.ok ? undefined : JSON.stringify(result.issues),
    ).toBe(true);
    if (result.ok) {
      expect(result.payloads.summary).toMatchObject({
        courseId: COURSE_ID,
        pageId: PAGE_ID,
        objectiveIds: ["objective-concept"],
        quality: { decision: "pass" },
      });
      expect(result.payloads.summary.contentDigest).toContain("恒星");
    }
  });

  it("互动承载全部正文时仍能生成可提交的内容摘要", () => {
    const candidate = validCandidate();
    const content: PageContentDSL = {
      ...candidate.content,
      narration: [],
      blocks: [],
      layoutHints: {
        ...candidate.content.layoutHints,
        readingOrder: [],
      },
      interaction: {
        type: "reveal",
        prompt: "点击两个天体查看判断依据。",
        items: [
          {
            id: "item-star",
            label: "恒星",
            content: "恒星能够自身发光发热。",
          },
          {
            id: "item-planet",
            label: "行星",
            content: "行星不会自身发光。",
          },
        ],
      },
    };
    const style = getStyleTemplate("minimal");
    if (!style) throw new Error("测试需要 minimal 样式模板");
    const result = runPageGate({
      architecture: architecture(),
      creationBrief: creationBrief(),
      referencePacks: [],
      pageId: PAGE_ID,
      ...candidate,
      content,
      html: {
        ...candidate.html,
        html: renderDeterministicPageFallback({
          content,
          styleTemplate: style,
        }),
      },
    });

    expect(
      result.ok,
      result.ok ? undefined : JSON.stringify(result.issues),
    ).toBe(true);
    if (result.ok) {
      expect(result.payloads.summary.contentDigest).toContain(
        "恒星能够自身发光发热",
      );
    }
  });

  it("允许没有模板类名和 DSL data 标记的 Agent 原生构图", () => {
    const candidate = validCandidate();
    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; font-family: system-ui; background: #07111f; color: #f8fafc; }
    main { min-height: 100vh; display: grid; place-items: center; padding: 8vw; box-sizing: border-box; }
    details { max-width: 46rem; padding: 2rem; border: 1px solid #38bdf8; border-radius: 1.5rem; }
  </style>
</head>
<body>
  <main>
    <details>
      <summary>恒星与行星怎样区分？</summary>
      <p>恒星能够自身发光，行星主要反射恒星的光。</p>
    </details>
  </main>
</body>
</html>`;
    const result = runPageGate({
      architecture: architecture(),
      creationBrief: creationBrief(),
      referencePacks: [],
      pageId: PAGE_ID,
      ...candidate,
      html: { ...candidate.html, html },
    });

    expect(
      result.ok,
      result.ok ? undefined : JSON.stringify(result.issues),
    ).toBe(true);
  });

  it("不再用中英文字符比例正则拒绝术语密集页面", () => {
    const candidate = validCandidate();
    const content: PageContentDSL = {
      ...candidate.content,
      narration: [
        "Compare these objects and decide whether each one produces its own light.",
      ],
      blocks: candidate.content.blocks.map((block, index) => ({
        ...block,
        heading: index === 0 ? "A star produces light" : "A planet reflects light",
        body:
          index === 0
            ? "A star releases energy and produces its own light across the Solar System."
            : "A planet travels around a star and reflects the light that reaches its surface.",
        supportingPoints: [
          index === 0
            ? "The Sun is the star at the center of our Solar System."
            : "Earth is a planet that travels around the Sun.",
        ],
      })),
      interaction: {
        type: "reveal",
        prompt: "Reveal each object to compare its most important feature.",
        items: [
          {
            id: "item-star",
            label: "The Sun",
            content: "The Sun is a star that produces light and releases energy.",
          },
          {
            id: "item-planet",
            label: "The Earth",
            content: "The Earth is a planet that reflects light from the Sun.",
          },
        ],
      },
    };
    const style = getStyleTemplate("minimal");
    if (!style) throw new Error("测试需要 minimal 样式模板");
    const html = {
      ...candidate.html,
      html: renderDeterministicPageFallback({
        content,
        styleTemplate: style,
      }),
    };
    const result = runPageGate({
      architecture: architecture(),
      creationBrief: creationBrief(),
      referencePacks: [],
      pageId: PAGE_ID,
      ...candidate,
      content,
      html,
    });

    expect(
      result.ok,
      result.ok ? undefined : JSON.stringify(result.issues),
    ).toBe(true);
  });

  it("低主观分数和截图基础设施状态都不替代交付故障判断", () => {
    const candidate = validCandidate();
    const quality = {
      ...candidate.quality,
      screenshotEvidence: undefined,
      dimensions: {
        ...candidate.quality.dimensions,
        layoutQuality: {
          ...candidate.quality.dimensions.layoutQuality,
          score: 70,
        },
      },
      overallScore: 90,
    };
    const result = runPageGate({
      architecture: architecture(),
      creationBrief: creationBrief(),
      referencePacks: [],
      pageId: PAGE_ID,
      ...candidate,
      quality,
    });

    expect(result.ok).toBe(true);
  });

  it("有完整证据且没有可定位 error 时，不因单个模型分数较低拒绝首轮页面", () => {
    const candidate = validCandidate();
    const quality = {
      ...candidate.quality,
      dimensions: {
        ...candidate.quality.dimensions,
        styleConsistency: {
          ...candidate.quality.dimensions.styleConsistency,
          score: 70,
        },
      },
      overallScore: 89,
    };

    const result = runPageGate({
      architecture: architecture(),
      creationBrief: creationBrief(),
      referencePacks: [],
      pageId: PAGE_ID,
      ...candidate,
      quality,
    });

    expect(result.ok).toBe(true);
  });
});

function validCandidate() {
  const content = pageContent();
  const style = getStyleTemplate("minimal");
  if (!style) throw new Error("测试需要 minimal 样式模板");
  const html = renderDeterministicPageFallback({
    content,
    styleTemplate: style,
  });
  const quality = buildPageQualityReport({
    id: "quality-page-concept",
    pageId: PAGE_ID,
    modelDimensions: {
      contentAccuracy: { score: 96, summary: "内容准确。" },
      layoutQuality: { score: 94, summary: "布局稳定。" },
      courseCoherence: { score: 95, summary: "教学目标清楚。" },
      styleConsistency: { score: 94, summary: "风格一致。" },
      htmlRuntime: { score: 98, summary: "运行正常。" },
      assetUsability: { score: 95, summary: "本页无需素材。" },
    },
    heuristicIssues: [],
    modelIssues: [],
    screenshotEvidence,
    createdAt: NOW,
  });
  return {
    content,
    assets: [],
    html: {
      html,
      generatedAt: NOW,
      revision: 1,
    },
    quality,
  };
}

function pageContent(): PageContentDSL {
  return {
    pageId: PAGE_ID,
    functionalTemplateId: "knowledge-card-grid",
    title: "恒星与行星",
    runtime: {
      sceneKind: "demo",
      visualPrimitive: "concept-map",
      motionPlan: { intensity: "none", cuePoints: [] },
      completionRule: {
        type: "interaction-complete",
        interactionId: `interaction-${PAGE_ID}`,
      },
    },
    narration: ["先比较两类天体，再用是否自身发光来判断。"],
    blocks: [
      {
        id: "block-star",
        kind: "concept",
        heading: "恒星",
        body: "恒星能够自身发光发热，太阳就是离我们最近的一颗恒星。",
        supportingPoints: ["判断重点是天体能否自身发光。"],
      },
      {
        id: "block-planet",
        kind: "concept",
        heading: "行星",
        body: "行星不会自身发光，会围绕恒星运行，例如地球围绕太阳运行。",
        supportingPoints: ["行星看到的光通常来自恒星反射。"],
      },
    ],
    interaction: {
      type: "reveal",
      prompt: "逐项查看两类天体的判断依据。",
      items: [
        {
          id: "item-star",
          label: "恒星",
          content: "能够自身发光发热。",
        },
        {
          id: "item-planet",
          label: "行星",
          content: "不会自身发光，并围绕恒星运行。",
        },
      ],
    },
    usedReferences: [],
    assetSlots: [],
    layoutHints: {
      contentDensity: "balanced",
      visualPriority: "突出恒星与行星的关键区别",
      groupingStrategy: "两个同层级概念并排比较",
      readingOrder: ["block-star", "block-planet"],
    },
  };
}

function architecture(): CourseArchitecture {
  return {
    courseId: COURSE_ID,
    coursePack: {
      courseId: COURSE_ID,
      topic: "太阳系",
      facts: [],
      terms: [],
      examples: [],
      constraints: [],
    },
    blueprint: {
      courseId: COURSE_ID,
      title: "认识太阳系",
      audience: {
        description: "第一次接触太阳系的学习者",
        priorKnowledge: [],
        difficulty: "beginner",
      },
      language: "zh-CN",
      objectives: [
        {
          id: "objective-concept",
          outcome: "能够解释恒星与行星的基本区别",
          evidence: "能够根据是否自身发光作出判断",
        },
      ],
      courseRules: {
        tone: "直接、清楚",
        terminology: ["恒星", "行星"],
        visualDirection: "用清楚的对比帮助理解",
        visualStyle: "minimal",
        styleTemplateId: "minimal",
        teachingPattern: ["先比较", "再判断"],
      },
    },
    pageTasks: [
      {
        pageId: PAGE_ID,
        order: 1,
        title: "恒星与行星",
        pageType: "knowledge_card",
        purpose: "讲清两类天体的核心区别",
        objectiveIds: ["objective-concept"],
        buildDependsOnPageIds: [],
        teachingPoints: ["恒星能自身发光", "行星围绕恒星运行"],
        learnerAction: "根据是否自身发光判断天体类型",
        assessment: "说出太阳和地球分别属于哪类天体",
        referenceUsages: [],
        functionalTemplateId: "knowledge-card-grid",
        styleTemplateId: "minimal",
        interactionType: "reveal",
        assetNeeds: [],
        acceptance: {
          requiredConcepts: ["恒星", "行星"],
          expectedLearnerOutcome: "能说出两类天体的一项区别",
          requiresInteraction: true,
          pageSpecific: ["两类概念不能混写"],
        },
      },
    ],
  };
}

function creationBrief() {
  return {
    originalRequest: "给初学者做一门太阳系课程",
    topic: "太阳系",
    audience: "初学者",
    goal: "理解恒星和行星的区别",
    sectionCount: 1,
    learningMode: "mixed" as const,
    language: "zh-CN" as const,
  };
}
