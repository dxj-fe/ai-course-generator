import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { validateHtmlEngineerOutput } from "@/server/agents/html-engineer-agent";
import {
  CourseGenerationStateSchema,
  QualityDimensionNameSchema,
  type CourseGenerationState,
} from "@/shared/course-schema";

const ExpectedOutlineSlotSchema = z
  .object({
    order: z.number().int().positive(),
    purpose: z.string().min(2).max(120),
    allowedPageTypes: z.array(z.string().min(1)).min(1),
    allowedInteractionTypes: z.array(z.string().min(1)).min(1),
  })
  .strict();

const RequiredConceptSchema = z
  .object({
    label: z.string().min(1).max(80),
    anyOf: z.array(z.string().min(1).max(80)).min(1),
  })
  .strict();

export const DemoBaselineSchema = z
  .object({
    version: z.literal(1),
    id: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(2).max(120),
    prompt: z.string().min(10).max(4_000),
    pageCount: z.union([z.literal(3), z.literal(4), z.literal(5)]),
    expectedOutline: z.array(ExpectedOutlineSlotSchema).min(3).max(5),
    requiredConcepts: z.array(RequiredConceptSchema).min(2).max(12),
    quality: z
      .object({
        minOverallScore: z.number().min(0).max(100),
        minDimensionScore: z.number().min(0).max(100),
        requireScreenshotEvidence: z.boolean(),
      })
      .strict(),
    manualReview: z
      .object({
        minimumTotal: z.number().int().min(6).max(30),
        minimumDimension: z.number().int().min(1).max(5),
      })
      .strict(),
  })
  .strict()
  .superRefine((baseline, context) => {
    if (baseline.expectedOutline.length !== baseline.pageCount) {
      context.addIssue({
        code: "custom",
        message: "expectedOutline 必须逐页覆盖 pageCount",
        path: ["expectedOutline"],
      });
    }
    baseline.expectedOutline.forEach((slot, index) => {
      if (slot.order !== index + 1) {
        context.addIssue({
          code: "custom",
          message: `expectedOutline 第 ${index + 1} 项的 order 必须为 ${index + 1}`,
          path: ["expectedOutline", index, "order"],
        });
      }
    });
  });

export type DemoBaseline = z.infer<typeof DemoBaselineSchema>;

export type DemoCheckIssue = {
  code: string;
  message: string;
  pageId?: string;
};

export type DemoCheckReport = {
  version: 1;
  baselineId: string;
  courseId?: string;
  passed: boolean;
  checkedAt: string;
  metrics: {
    expectedPages: number;
    actualPages: number;
    qaPages: number;
    screenshotPages: number;
    minimumOverallScore?: number;
    archiveEntryCount: number;
  };
  issues: DemoCheckIssue[];
};

type CheckDemoCourseInput = {
  course: unknown;
  baseline: DemoBaseline;
  archiveBytes?: Uint8Array;
  now?: () => string;
};

/** 对持久化课程执行 Day 36 的结构、HTML、素材、QA 与导出聚合验收。 */
export function checkDemoCourse(input: CheckDemoCourseInput): DemoCheckReport {
  const baseline = DemoBaselineSchema.parse(input.baseline);
  const parsedCourse = CourseGenerationStateSchema.safeParse(input.course);
  const issues: DemoCheckIssue[] = [];
  const archiveEntries = input.archiveBytes
    ? readZipCentralDirectoryEntries(input.archiveBytes, issues)
    : [];

  if (!parsedCourse.success) {
    for (const issue of parsedCourse.error.issues) {
      issues.push({
        code: "COURSE_SCHEMA_INVALID",
        message: `${issue.path.join(".") || "root"}: ${issue.message}`,
      });
    }
    return reportFor({
      baseline,
      issues,
      archiveEntries,
      now: input.now,
    });
  }

  const course = parsedCourse.data;
  if (course.status !== "completed") {
    issues.push({
      code: "COURSE_NOT_COMPLETED",
      message: `课程终态应为 completed，实际为 ${course.status}。`,
    });
  }
  if (!course.outline) {
    issues.push({
      code: "OUTLINE_MISSING",
      message: "课程缺少可验收的 CoursePlan。",
    });
  }
  if (!course.briefs?.visual) {
    issues.push({
      code: "VISUAL_BRIEF_MISSING",
      message: "课程缺少 HTML 合同复核所需的 VisualBrief。",
    });
  }
  if (course.pages.length !== baseline.pageCount) {
    issues.push({
      code: "PAGE_COUNT_MISMATCH",
      message: `期望 ${baseline.pageCount} 页，实际 ${course.pages.length} 页。`,
    });
  }

  if (course.outline) {
    checkOutline(course, baseline, issues);
  }
  checkPages(course, baseline, issues);
  checkArchive(course, input.archiveBytes, archiveEntries, issues);

  const scores = course.pages.flatMap((page) =>
    page.qualityReport ? [page.qualityReport.overallScore] : [],
  );
  return reportFor({
    baseline,
    course,
    issues,
    archiveEntries,
    now: input.now,
    minimumOverallScore:
      scores.length > 0 ? Math.min(...scores) : undefined,
  });
}

function checkOutline(
  course: CourseGenerationState,
  baseline: DemoBaseline,
  issues: DemoCheckIssue[],
) {
  const outline = course.outline!;
  if (outline.pages.length !== baseline.pageCount) {
    issues.push({
      code: "OUTLINE_PAGE_COUNT_MISMATCH",
      message: `预期大纲 ${baseline.pageCount} 页，实际 ${outline.pages.length} 页。`,
    });
  }

  for (const slot of baseline.expectedOutline) {
    const page = outline.pages.find(({ order }) => order === slot.order);
    if (!page) {
      issues.push({
        code: "OUTLINE_SLOT_MISSING",
        message: `大纲缺少第 ${slot.order} 页（${slot.purpose}）。`,
      });
      continue;
    }
    if (!slot.allowedPageTypes.includes(page.pageType)) {
      issues.push({
        code: "OUTLINE_PAGE_TYPE_MISMATCH",
        pageId: page.id,
        message: `第 ${slot.order} 页应承担“${slot.purpose}”，允许页型为 ${slot.allowedPageTypes.join("/")}，实际为 ${page.pageType}。`,
      });
    }
    if (!slot.allowedInteractionTypes.includes(page.interactionType)) {
      issues.push({
        code: "OUTLINE_INTERACTION_MISMATCH",
        pageId: page.id,
        message: `第 ${slot.order} 页允许交互为 ${slot.allowedInteractionTypes.join("/")}，实际为 ${page.interactionType}。`,
      });
    }
  }

  const searchableOutline = normalizeSearchText({
    overview: outline.overview,
    learningObjectives: outline.learningObjectives,
    pages: outline.pages.map((page) => ({
      title: page.title,
      learningObjective: page.learningObjective,
      contentSummary: page.contentSummary,
    })),
  });
  for (const concept of baseline.requiredConcepts) {
    if (
      !concept.anyOf.some((term) =>
        searchableOutline.includes(normalizeSearchText(term)),
      )
    ) {
      issues.push({
        code: "OUTLINE_CONCEPT_MISSING",
        message: `大纲缺少“${concept.label}”语义；至少应包含：${concept.anyOf.join("、")}。`,
      });
    }
  }
}

function checkPages(
  course: CourseGenerationState,
  baseline: DemoBaseline,
  issues: DemoCheckIssue[],
) {
  for (const page of course.pages) {
    if (page.status !== "completed") {
      issues.push({
        code: "PAGE_NOT_COMPLETED",
        pageId: page.pageId,
        message: `页面状态应为 completed，实际为 ${page.status}。`,
      });
    }
    if (!page.content || !page.htmlOutput) {
      issues.push({
        code: "PAGE_ARTIFACT_MISSING",
        pageId: page.pageId,
        message: "页面缺少 PageContentDSL 或 HTML 输出。",
      });
    } else if (course.briefs?.visual) {
      try {
        validateHtmlEngineerOutput(page.htmlOutput.html, {
          content: page.content,
          visualBrief: course.briefs.visual,
          assets: page.assets,
        });
      } catch (error) {
        issues.push({
          code: "HTML_CONTRACT_FAILED",
          pageId: page.pageId,
          message:
            error instanceof Error ? error.message : "HTML 合同校验失败。",
        });
      }
    }

    const quality = page.qualityReport;
    if (!quality) {
      issues.push({
        code: "QUALITY_REPORT_MISSING",
        pageId: page.pageId,
        message: "页面缺少最终 QualityReport。",
      });
      continue;
    }
    if (quality.decision !== "pass" || quality.shouldRepair) {
      issues.push({
        code: "QUALITY_NOT_PASSED",
        pageId: page.pageId,
        message: `QA 应为 pass 且无需修复，实际为 ${quality.decision}/${quality.shouldRepair}。`,
      });
    }
    if (quality.overallScore < baseline.quality.minOverallScore) {
      issues.push({
        code: "QUALITY_OVERALL_BELOW_BASELINE",
        pageId: page.pageId,
        message: `总分应不低于 ${baseline.quality.minOverallScore}，实际为 ${quality.overallScore}。`,
      });
    }
    for (const dimension of QualityDimensionNameSchema.options) {
      const score = quality.dimensions[dimension].score;
      if (score < baseline.quality.minDimensionScore) {
        issues.push({
          code: "QUALITY_DIMENSION_BELOW_BASELINE",
          pageId: page.pageId,
          message: `${dimension} 应不低于 ${baseline.quality.minDimensionScore}，实际为 ${score}。`,
        });
      }
    }
    if (
      baseline.quality.requireScreenshotEvidence &&
      quality.screenshotEvidence?.status !== "captured"
    ) {
      issues.push({
        code: "SCREENSHOT_EVIDENCE_MISSING",
        pageId: page.pageId,
        message: `应包含 captured 截图证据，实际为 ${quality.screenshotEvidence?.status ?? "missing"}。`,
      });
    }
  }
}

function checkArchive(
  course: CourseGenerationState,
  archiveBytes: Uint8Array | undefined,
  archiveEntries: string[],
  issues: DemoCheckIssue[],
) {
  if (!archiveBytes) {
    issues.push({
      code: "ARCHIVE_MISSING",
      message: "缺少课程 ZIP 导出结果。",
    });
    return;
  }
  const expectedEntries = [
    "course.json",
    ...course.pages.map(
      (page) =>
        `pages/${String(page.order).padStart(2, "0")}-${page.pageId}.html`,
    ),
    "assets/manifest.json",
  ];
  for (const entry of expectedEntries) {
    if (!archiveEntries.includes(entry)) {
      issues.push({
        code: "ARCHIVE_ENTRY_MISSING",
        message: `ZIP 缺少 ${entry}。`,
      });
    }
  }
}

function readZipCentralDirectoryEntries(
  bytes: Uint8Array,
  issues: DemoCheckIssue[],
) {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    issues.push({
      code: "ARCHIVE_SIGNATURE_INVALID",
      message: "导出文件不是有效的 ZIP 本地文件头。",
    });
    return [];
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries: string[] = [];
  for (let offset = 0; offset + 46 <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > bytes.length) {
      issues.push({
        code: "ARCHIVE_CENTRAL_DIRECTORY_INVALID",
        message: "ZIP 中央目录的文件名长度越界。",
      });
      return entries;
    }
    entries.push(decoder.decode(bytes.subarray(nameStart, nameEnd)));
    offset = nameEnd + extraLength + commentLength - 1;
  }
  if (entries.length === 0) {
    issues.push({
      code: "ARCHIVE_CENTRAL_DIRECTORY_MISSING",
      message: "ZIP 缺少可读取的中央目录。",
    });
  }
  return entries;
}

function normalizeSearchText(value: unknown) {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  return source
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/g, "");
}

function reportFor(input: {
  baseline: DemoBaseline;
  course?: CourseGenerationState;
  issues: DemoCheckIssue[];
  archiveEntries: string[];
  minimumOverallScore?: number;
  now?: () => string;
}): DemoCheckReport {
  const course = input.course;
  return {
    version: 1,
    baselineId: input.baseline.id,
    courseId: course?.courseId,
    passed: input.issues.length === 0,
    checkedAt: (input.now ?? (() => new Date().toISOString()))(),
    metrics: {
      expectedPages: input.baseline.pageCount,
      actualPages: course?.pages.length ?? 0,
      qaPages:
        course?.pages.filter(({ qualityReport }) => Boolean(qualityReport))
          .length ?? 0,
      screenshotPages:
        course?.pages.filter(
          ({ qualityReport }) =>
            qualityReport?.screenshotEvidence?.status === "captured",
        ).length ?? 0,
      minimumOverallScore: input.minimumOverallScore,
      archiveEntryCount: input.archiveEntries.length,
    },
    issues: input.issues,
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (!flags.course || !flags.baseline || !flags.archive) {
    throw new Error(
      "用法：pnpm demo:check -- --course <course.json> --baseline <baseline.json> --archive <course.zip> [--report <report.json>]",
    );
  }
  const [courseSource, baselineSource, archive] = await Promise.all([
    readFile(path.resolve(flags.course), "utf8"),
    readFile(path.resolve(flags.baseline), "utf8"),
    readFile(path.resolve(flags.archive)),
  ]);
  const report = checkDemoCourse({
    course: JSON.parse(courseSource),
    baseline: DemoBaselineSchema.parse(JSON.parse(baselineSource)),
    archiveBytes: archive,
  });
  const rendered = `${JSON.stringify(report, null, 2)}\n`;
  if (flags.report) {
    await writeFile(path.resolve(flags.report), rendered, "utf8");
  }
  process.stdout.write(rendered);
  if (!report.passed) process.exitCode = 1;
}

function parseFlags(args: string[]) {
  const normalizedArgs = args.filter((argument) => argument !== "--");
  const flags: Record<string, string> = {};
  for (let index = 0; index < normalizedArgs.length; index += 2) {
    const flag = normalizedArgs[index];
    const value = normalizedArgs[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(`无效参数：${flag ?? ""}`);
    }
    flags[flag.slice(2)] = value;
  }
  return flags;
}

const entryPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (entryPath === import.meta.url) {
  void main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "课程检查失败。"}\n`,
    );
    process.exitCode = 1;
  });
}
