import { rm } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentIds,
  SkillIds,
} from "../../../../src/server/agent/ids";
import {
  LocalResourceSession,
} from "../../../../src/server/agent/skill";
import {
  assertPageBuilderToolCall,
  createPageBuilderExecution,
  loadPageBuilderSnapshot,
  loadPageBuilderWorkingSnapshot,
} from "../../../../src/server/agent/plugins/contexts/course/page-builder";
import {
  buildPageDesignGuidance,
  buildPageWriterCourseContext,
} from "../../../../src/server/agent/plugins/tools/course/page-builder-model-steps";
import {
  createPageBuilderTools,
  resolvePageBuilderActiveTools,
} from "../../../../src/server/agent/plugins/tools/course/page-builder";
import { createReadLocalResourceTool } from "../../../../src/server/agent/plugins/tools/system";
import {
  compactPageBuilderRevisionMessages,
  preparePageBuilderStep,
  prunePageBuilderRenderEvidenceMessages,
  runPageBuilderAgent,
} from "../../../../src/server/agent/plugins/agents/course/page-builder-handler";
import { assertFixSubmissionUsesCurrentCheckpoints } from "../../../../src/server/course/policy/page-fix";
import {
  AgentTerminalNotCommittedError,
  FatalAgentRuntimeError,
} from "../../../../src/server/agent/runtime";
import { createProjectSkillRegistry } from "../../../../src/server/setup/skills";
import {
  PageContentDSLSchema,
  PageSummarySchema,
  QualityReportSchema,
} from "../../../../src/shared/course-schema";
import {
  createBrief,
  createReferencePack,
} from "../../../fixtures/course-architecture";
import {
  ENGINE_OWNER,
  PAGE_ID,
  PAGE_OWNER,
  executeTool,
  failingContentQuality,
  htmlOutput,
  modelSteps,
  pageContent,
  pageSummary,
  passingQuality,
  prepareContentFixPageBuilder as prepareContentFixPageBuilderFixture,
  preparePageBuilder as preparePageBuilderFixture,
  scriptedPageBuilderFactory,
} from "./page-builder-agent-test-support";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Page Builder ToolLoopAgent", () => {
  it("新 Page Creator 由 Harness 预加载上下文和 workspace，第一轮直接创作 HTML", async () => {
    const prepared = await preparePageBuilder();
    const stop = new Error("已完成首步检查");

    await expect(
      runPageBuilderAgent(
        {
          repository: prepared.repository,
          workOrder: prepared.workOrder,
          workOrderLeaseOwner: PAGE_OWNER,
          runLeaseOwner: ENGINE_OWNER,
          traceId: prepared.run.traceId,
          creationBrief: createBrief(),
          referencePacks: [createReferencePack()],
        },
        {
          createAgent: (settings) => ({
            generate: async ({ prompt }) => {
              expect(prompt).toContain("Harness 已预加载的封口上下文与 workspace");
              expect(prompt).toContain('"coursePack"');
              expect(prompt).toContain("禁止 script、Tailwind/CDN、link、@import");
              expect(prompt).toContain("有且只能有一个 main");
              expect(prompt).toContain("本页 requiresInteraction=true");
              expect(prompt).toContain("details/summary");
              expect(prompt).toContain("无可信原生行为时不要输出 button");
              expect(prompt).toContain("authored canvas 上至少 72px 高");
              expect(prompt).toContain("input:checked + label/CSS");
              expect(prompt).toContain("禁止用 CSS [value] 伪造滑块反馈");
              const firstStep = await settings.prepareStep({
                messages: [],
                stepNumber: 0,
                steps: [],
              });
              expect(firstStep).toMatchObject({
                toolChoice: {
                  type: "tool",
                  toolName: "edit_page_workspace",
                },
              });
              throw stop;
            },
          }),
          model: {},
          now: () => "2026-07-29T12:03:30.000Z",
        },
      ),
    ).rejects.toBe(stop);
  });

  it("只向模型保留最新一轮截图证据，避免多模态上下文随修订次数膨胀", () => {
    const oldEvidence = {
      role: "user",
      content: [
        {
          type: "text",
          text: "下面是刚刚渲染的页面 revision 2。",
        },
        { type: "file", data: new Uint8Array([1]), mediaType: "image/png" },
      ],
    };
    const normalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "继续修订页面。" }],
    };

    expect(
      prunePageBuilderRenderEvidenceMessages([
        normalMessage,
        oldEvidence,
      ]),
    ).toEqual([normalMessage]);
  });

  it("质量修订丢弃旧 HTML 工具历史，只保留封口任务", () => {
    const promptMessage = {
      role: "user",
      content: "完成页面。Harness 已预加载的封口上下文与 workspace。",
    };
    const systemMessage = { role: "system", content: "页面 Agent" };
    const oldHtmlCall = {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolName: "edit_page_workspace",
          input: { html: "<main>旧版超长 HTML</main>" },
        },
      ],
    };
    const oldToolResult = {
      role: "tool",
      content: [{ type: "tool-result", output: "旧质量结果" }],
    };

    expect(
      compactPageBuilderRevisionMessages([
        systemMessage,
        promptMessage,
        oldHtmlCall,
        oldToolResult,
      ]),
    ).toEqual([systemMessage, promptMessage]);
  });

  it("最终编辑后的机械 render 步骤会移除旧截图并固定单一工具选择", async () => {
    const prepared = await preparePageBuilder();
    prepared.execution.legacyModelPipeline = false;
    prepared.execution.latestRenderEvidence = {
      htmlRevision: 1,
      evidence: { captures: [] },
      issues: [],
      images: [],
    };
    prepared.execution.injectedRenderRevision = 1;
    prepared.execution.progress.workspaceDirty = true;
    const oldEvidence = {
      role: "user",
      content: [
        {
          type: "text",
          text: "下面是刚刚渲染的页面 revision 1。",
        },
        {
          type: "file",
          data: new Uint8Array([1]),
          mediaType: "image/png",
        },
      ],
    };
    const normalMessage = {
      role: "assistant",
      content: [{ type: "text", text: "已完成最终编辑。" }],
    };

    const preparedStep = preparePageBuilderStep(prepared.execution, [
      oldEvidence,
      normalMessage,
    ]);
    expect(preparedStep).toMatchObject({
      messages: [normalMessage],
      toolChoice: { type: "tool", toolName: "render_page" },
    });
    expect(preparedStep.activeTools).toContain("render_page");
  });

  it("把 Browser Harness 的具体问题和修复方向连同截图注入下一轮", async () => {
    const prepared = await preparePageBuilder();
    prepared.execution.legacyModelPipeline = false;
    prepared.execution.latestRenderEvidence = {
      htmlRevision: 2,
      evidence: { captures: [] },
      issues: [
        {
          code: "BROWSER_CONTENT_CLIPPED",
          dimension: "layoutQuality",
          severity: "error",
          source: "browser",
          message: "body > main 存在内容裁切。",
          location: {
            pageId: PAGE_ID,
            selector: "body > main",
            viewport: "1280x720",
            description: "Playwright 固定视口渲染结果",
          },
          repairHint: "重新计算固定画布的内容总高度。",
        },
      ],
      images: [
        {
          viewport: { width: 1280, height: 720 },
          png: new Uint8Array([1]),
        },
      ],
    };

    const preparedStep = preparePageBuilderStep(prepared.execution, []);
    expect(JSON.stringify(preparedStep.messages)).toContain(
      "BROWSER_CONTENT_CLIPPED（body > main）：body > main 存在内容裁切。 修复方向：重新计算固定画布的内容总高度。",
    );
  });

  it("只把按需读取的页面设计 reference 注入内容和 HTML Model Step", async () => {
    const prepared = await preparePageBuilder();
    const registry = await createProjectSkillRegistry();
    const session = new LocalResourceSession({
      agentId: AgentIds.CoursePageBuilder,
      workOrderId: prepared.workOrder.id,
      skillIds: [SkillIds.CoursePageDesign],
      maxFileBytes: 128 * 1024,
      maxSessionBytes: 512 * 1024,
      maxReadCount: 8,
      allowedMediaTypes: ["text/markdown"],
    });
    prepared.execution.localResourceSession = session;
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: modelSteps({
        content: pageContent(),
        quality: passingQuality(),
      }),
      readLocalResourceTool: createReadLocalResourceTool({
        registry,
        session,
      }),
    });

    expect(resolvePageBuilderActiveTools(prepared.execution)).toEqual(
      expect.arrayContaining([
        "read_local_resource",
        "read_page_context",
      ]),
    );
    await executeTool(tools, "read_page_context", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "read_local_resource", {
      path: "agent/skills/course-page-design/SKILL.md",
    });
    await executeTool(tools, "read_local_resource", {
      path: "agent/skills/course-page-design/references/fixed-canvas-composition.md",
    });

    expect(resolvePageBuilderActiveTools(prepared.execution)).toContain(
      "generate_page_content",
    );
    expect(buildPageDesignGuidance(prepared.execution)).toEqual([
      expect.objectContaining({
        logicalPath:
          "agent/skills/course-page-design/references/fixed-canvas-composition.md",
        content: expect.stringContaining("先选信息关系"),
      }),
    ]);
    expect(
      buildPageWriterCourseContext(prepared.execution)
        .pageDesignGuidance,
    ).toEqual(buildPageDesignGuidance(prepared.execution));
  });

  it("无素材页生成内容后直接开放 HTML 工具，不做无用生图", async () => {
    const prepared = await preparePageBuilder();
    const steps = modelSteps({
      content: pageContent(),
      quality: passingQuality(),
    });
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: steps,
    });

    await executeTool(tools, "generate_page_content", {
      pageId: PAGE_ID,
    });

    const initialContentInput =
      vi.mocked(steps.generateContent).mock.calls[0]?.[0];
    expect(initialContentInput).toBeDefined();
    expect(
      "validationFeedback" in initialContentInput!,
    ).toBe(false);
    expect(
      resolvePageBuilderActiveTools(prepared.execution),
    ).toEqual(
      expect.arrayContaining(["generate_page_html"]),
    );
    expect(
      resolvePageBuilderActiveTools(prepared.execution),
    ).not.toContain("block_page");
    expect(
      resolvePageBuilderActiveTools(prepared.execution),
    ).not.toContain("resolve_page_assets");
    expect(steps.resolveAssets).not.toHaveBeenCalled();
  });

  it("Page Creator 编辑 workspace 后由 Harness 自动完成渲染和质量检查", async () => {
    const prepared = await preparePageBuilder();
    prepared.execution.legacyModelPipeline = false;
    const content = pageContent();
    const steps = modelSteps({
      content,
      quality: passingQuality(),
    });
    const captureScreenshot = vi.fn(async () => ({
      evidence: {
        captures: [
          { width: 1280, height: 720 },
          { width: 960, height: 540 },
          { width: 640, height: 360 },
        ].map((viewport, index) => ({
          status: "captured" as const,
          artifactId: `workspace-shot-${index}`,
          viewport,
          metrics: {
            documentWidth: viewport.width,
            documentHeight: viewport.height,
            horizontalOverflowPx: 0,
            verticalOverflowPx: 0,
            clippedElementCount: 0,
            zeroSizeInteractiveCount: 0,
          },
          capturedAt: "2026-07-29T12:01:00.000Z",
        })),
      },
      issues: [],
      modelImages: [
        {
          viewport: { width: 1280, height: 720 },
          png: new Uint8Array([137, 80, 78, 71]),
        },
      ],
    }));
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: steps,
      captureScreenshot,
    });
    const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://fonts.example.invalid/course.css">
<style>@import url('https://fonts.example.invalid/course.css');html,body,main{width:100%;min-height:100%;margin:0}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}@media (max-width: 768px){main{grid-template-columns:1fr}}</style>
</head><body><main>
<header><h1>恒星与行星的区别</h1><p>先用是否自身发光来区分恒星和行星。</p></header>
<article><h2>恒星</h2><p>恒星能够自身发光发热，太阳就是一颗恒星。</p><p>判断重点是能否自身发光。</p></article>
<article><h2>行星</h2><p>行星不会自身发光，并且会围绕恒星运行。</p><p>地球是围绕太阳运行的行星。</p></article>
<section>
<p>展开卡片查看判断依据。</p>
<details><summary>恒星</summary><p>能够自身发光发热。</p></details>
<details><summary>行星</summary><p>不会自身发光。</p></details>
</section></main></body></html>`;

    await executeTool(tools, "read_page_context", { pageId: PAGE_ID });
    await executeTool(tools, "read_page_workspace", { pageId: PAGE_ID });

    const edited = await executeTool(tools, "edit_page_workspace", {
      pageId: PAGE_ID,
      mode: "write",
      html: `<think_never_used_hash>内部推理</think_never_used_hash>\n<![CDATA[${html}]]>`,
    });

    expect(edited).toMatchObject({
      ok: true,
      committed: true,
      data: {
        decision: "pass",
        screenshotCount: 1,
      },
    });
    expect(captureScreenshot).toHaveBeenCalledOnce();
    expect(steps.generateContent).not.toHaveBeenCalled();
    expect(steps.generateHtml).not.toHaveBeenCalled();
    expect(steps.inspectPage).not.toHaveBeenCalled();
    const snapshot = loadPageBuilderSnapshot(prepared.execution);
    expect(snapshot).toMatchObject({
      content: { pageId: PAGE_ID, blocks: [], interaction: { type: "none" } },
      quality: { decision: "pass" },
    });
    expect(snapshot.html?.html).toContain("max-width: 520px");
    expect(snapshot.html?.html).toMatch(/^<!doctype html>/i);
    expect(snapshot.html?.html).not.toContain("CDATA");
    expect(snapshot.html?.html).not.toContain("think_never_used");
    expect(snapshot.html?.html).not.toContain("fonts.example.invalid");
    expect(snapshot.html?.html).not.toContain("@import");
  });

  it("Page Creator 三轮实质修订仍失败后只开放 block_page，避免无界空转", async () => {
    const prepared = await preparePageBuilder();
    prepared.execution.legacyModelPipeline = false;
    const captures = [
      { width: 1280, height: 720 },
      { width: 960, height: 540 },
      { width: 640, height: 360 },
    ].map((viewport, index) => ({
      status: "captured" as const,
      artifactId: `failed-shot-${index}`,
      viewport,
      metrics: {
        documentWidth: viewport.width,
        documentHeight: viewport.height,
        horizontalOverflowPx: 0,
        verticalOverflowPx: 0,
        clippedElementCount: 0,
        zeroSizeInteractiveCount: 0,
        inertButtonCount: 1,
      },
      capturedAt: "2026-07-29T12:01:00.000Z",
    }));
    const captureScreenshot = vi.fn(async () => ({
      evidence: { captures },
      issues: captures.map((capture) => ({
        code: "BROWSER_INERT_BUTTON",
        dimension: "htmlRuntime" as const,
        severity: "error" as const,
        source: "browser" as const,
        message: "按钮没有可信运行时或原生表单行为。",
        location: {
          pageId: PAGE_ID,
          viewport: `${capture.viewport.width}x${capture.viewport.height}`,
          selector: "button",
          description: "无法完成动作的按钮",
        },
        repairHint: "移除伪交互或改用原生 details。",
      })),
      modelImages: [],
    }));
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: modelSteps({
        content: pageContent(),
        quality: passingQuality(),
      }),
      captureScreenshot,
    });

    await executeTool(tools, "read_page_context", { pageId: PAGE_ID });
    await executeTool(tools, "read_page_workspace", { pageId: PAGE_ID });
    for (let revision = 0; revision <= 3; revision += 1) {
      const html = `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>main{min-height:100vh}</style></head><body><main><h1>恒星与行星</h1><p>修订 ${revision}</p><button>提交判断</button></main></body></html>`;
      await executeTool(tools, "edit_page_workspace", {
        pageId: PAGE_ID,
        mode: "write",
        html,
      });

      const activeTools = resolvePageBuilderActiveTools(prepared.execution);
      if (revision < 3) {
        expect(activeTools).toContain("edit_page_workspace");
        expect(activeTools).not.toContain("block_page");
      } else {
        expect(activeTools).toEqual(["block_page"]);
      }
    }
  });

  it("修订预算耗尽后由 Harness 直接提交阻塞终态，不再等待模型做机械调用", async () => {
    const prepared = await preparePageBuilder();
    const captures = [
      { width: 1280, height: 720 },
      { width: 960, height: 540 },
      { width: 640, height: 360 },
    ].map((viewport, index) => ({
      status: "captured" as const,
      artifactId: `blocked-shot-${index}`,
      viewport,
      metrics: {
        documentWidth: viewport.width,
        documentHeight: viewport.height,
        horizontalOverflowPx: 0,
        verticalOverflowPx: 0,
        clippedElementCount: 0,
        zeroSizeInteractiveCount: 0,
        inertButtonCount: 1,
      },
      capturedAt: "2026-07-29T12:01:00.000Z",
    }));
    let agentRunCount = 0;

    const result = await runPageBuilderAgent(
      {
        repository: prepared.repository,
        workOrder: prepared.workOrder,
        workOrderLeaseOwner: PAGE_OWNER,
        runLeaseOwner: ENGINE_OWNER,
        traceId: prepared.run.traceId,
        creationBrief: createBrief(),
        referencePacks: [createReferencePack()],
        workspaceRoot: prepared.execution.workspace.directory,
      },
      {
        captureScreenshot: vi.fn(async () => ({
          evidence: { captures },
          issues: [
            {
              code: "BROWSER_INERT_BUTTON",
              dimension: "htmlRuntime" as const,
              severity: "error" as const,
              source: "browser" as const,
              message: "按钮没有可信运行时或原生表单行为。",
              location: {
                pageId: PAGE_ID,
                viewport: "1280x720",
                selector: "button",
                description: "无法完成动作的按钮",
              },
              repairHint: "移除伪交互或改用原生 details。",
            },
          ],
          modelImages: [],
        })),
        createAgent: (settings) => ({
          generate: async ({ abortSignal }) => {
            agentRunCount += 1;
            for (let revision = 0; revision <= 3; revision += 1) {
              await executeTool(
                settings.tools,
                "edit_page_workspace",
                {
                  pageId: PAGE_ID,
                  mode: "write",
                  html: `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>main{min-height:100vh}</style></head><body><main><h1>恒星与行星</h1><p>修订 ${revision}</p><button>提交判断</button></main></body></html>`,
                },
                abortSignal,
              );
            }
            return {};
          },
        }),
        model: {},
        now: () => "2026-07-29T12:03:30.000Z",
      },
    );

    expect(agentRunCount).toBe(1);
    expect(result.status).toBe("blocked");
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)?.error
        ?.message,
    ).toContain("BROWSER_INERT_BUTTON");
  });

  it("QA 发现内容问题后只开放内容修复，并在修复后重建下游产物", async () => {
    const prepared = await preparePageBuilder();
    const content = pageContent();
    const repairedContent = PageContentDSLSchema.parse({
      ...content,
      narration: [
        "恒星自身发光，行星不自身发光；现在用这个标准完成判断。",
      ],
    });
    const steps = modelSteps({
      content,
      quality: failingContentQuality(),
      repairedContent,
    });
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: steps,
    });

    await executeTool(tools, "generate_page_content", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "generate_page_html", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "inspect_page", {
      pageId: PAGE_ID,
    });

    const repairActions = resolvePageBuilderActiveTools(
      prepared.execution,
    );
    expect(repairActions).toContain("repair_page_content");
    expect(repairActions).not.toContain("repair_page_html");

    await executeTool(tools, "repair_page_content", {
      pageId: PAGE_ID,
    });

    expect(steps.repairPage).toHaveBeenCalledOnce();
    expect(
      resolvePageBuilderActiveTools(prepared.execution),
    ).toContain("generate_page_html");
    const stored =
      prepared.repository.workOrders.load(
        prepared.workOrder.id,
      )!;
    expect(
      stored.checkpointArtifactRefs.map(({ kind }) => kind),
    ).toEqual(["page_content"]);
  });

  it("真实视口结构问题 BROWSER_VERTICAL_OVERFLOW 从干净 HTML 检查点重建，而不是追加局部 patch", async () => {
    const issueCode = "BROWSER_VERTICAL_OVERFLOW";
    const prepared = await preparePageBuilder();
    const baselineHtml = htmlOutput();
    const regeneratedHtml = {
      ...baselineHtml,
      html: baselineHtml.html.replace(
        "</main>",
        '<div class="structural-regeneration"></div></main>',
      ),
    };
    const baseQuality = passingQuality();
    const quality = QualityReportSchema.parse({
      ...baseQuality,
      id: "quality-page-overflow",
      overallScore: 72,
      dimensions: {
        ...baseQuality.dimensions,
        layoutQuality: {
          score: 40,
          summary: "固定播放器产生大幅纵向溢出。",
          issueCodes: [issueCode],
          repairHints: ["从干净 HTML 检查点重建布局。"],
        },
      },
      issues: [
        {
          code: issueCode,
          dimension: "layoutQuality",
          severity: "error",
          source: "browser",
          message: "页面产生 561px 纵向溢出。",
          location: {
            pageId: PAGE_ID,
            viewport: "1280x720",
            description: "Playwright 固定视口渲染结果",
          },
          repairHint: "重构为横向或网格布局。",
        },
      ],
      screenshotEvidence: {
        captures: [
          {
            status: "captured",
            artifactId: "overflow-desktop",
            viewport: { width: 1280, height: 720 },
            metrics: {
              documentWidth: 922,
              documentHeight: 1021,
              horizontalOverflowPx: 0,
              verticalOverflowPx: 561,
              clippedElementCount: 0,
              zeroSizeInteractiveCount: 0,
              largestVisualAreaRatio: 1,
              largestVisualSelector:
                '[data-asset-slot-id="asset-slot-01"]',
            },
            capturedAt: "2026-08-05T12:00:00.000Z",
          },
          {
            status: "captured",
            artifactId: "overflow-tablet",
            viewport: { width: 960, height: 540 },
            metrics: {
              documentWidth: 712,
              documentHeight: 910,
              horizontalOverflowPx: 0,
              verticalOverflowPx: 260,
              clippedElementCount: 0,
              zeroSizeInteractiveCount: 0,
              largestVisualAreaRatio: 0.55,
            },
            capturedAt: "2026-08-05T12:00:00.000Z",
          },
          {
            status: "captured",
            artifactId: "overflow-mobile",
            viewport: { width: 640, height: 360 },
            metrics: {
              documentWidth: 366,
              documentHeight: 980,
              horizontalOverflowPx: 0,
              verticalOverflowPx: 480,
              clippedElementCount: 0,
              zeroSizeInteractiveCount: 0,
            },
            capturedAt: "2026-08-05T12:00:00.000Z",
          },
        ],
      },
      shouldRepair: true,
      decision: "revise",
    });
    const steps = modelSteps({
      content: pageContent(),
      html: baselineHtml,
      quality,
    });
    vi.mocked(steps.generateHtml)
      .mockResolvedValueOnce(baselineHtml)
      .mockResolvedValueOnce(regeneratedHtml);
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: steps,
    });

    await executeTool(tools, "read_page_context", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "generate_page_content", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "generate_page_html", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "inspect_page", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "repair_page_html", {
      pageId: PAGE_ID,
    });

    expect(steps.repairPage).not.toHaveBeenCalled();
    expect(steps.generateHtml).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(steps.generateHtml).mock.calls[1]?.[0]
        .validationFeedback,
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("从干净 HTML 检查点完整重建构图"),
        expect.stringContaining("documentHeight=1021"),
        expect.stringContaining("largestVisualAreaRatio=1.00"),
        expect.stringContaining(
          'largestVisualSelector=[data-asset-slot-id="asset-slot-01"]',
        ),
        expect.stringContaining(issueCode),
      ]),
    );
    const snapshot = loadPageBuilderWorkingSnapshot(
      prepared.execution,
    );
    expect(snapshot.html?.html).toContain(
      'class="structural-regeneration"',
    );
    expect(snapshot.quality).toBeUndefined();

    await executeTool(tools, "inspect_page", {
      pageId: PAGE_ID,
    });
    expect(
      resolvePageBuilderActiveTools(prepared.execution),
    ).not.toContain("repair_page_html");
    expect(
      resolvePageBuilderActiveTools(prepared.execution),
    ).toContain("block_page");

    await expect(
      executeTool(tools, "repair_page_html", {
        pageId: PAGE_ID,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: "PAGE_REPAIR_BUDGET_EXHAUSTED",
      retryable: false,
    });
    expect(steps.generateHtml).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(steps.generateHtml).mock.calls[1]?.[0],
    ).not.toHaveProperty("deterministicFallback");

    const blocked = await executeTool(tools, "block_page", {
      pageId: PAGE_ID,
      code: "PAGE_REPAIR_BUDGET_EXHAUSTED",
      message: "模型重构后仍未通过真实视口检查。",
    });
    expect(blocked).toMatchObject({
      ok: true,
      terminal: true,
    });
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id),
    ).toMatchObject({
      status: "blocked",
      error: {
        code: "PAGE_REPAIR_BUDGET_EXHAUSTED",
        message: "模型重构后仍未通过真实视口检查。",
        retryable: false,
      },
      submission: {
        status: "blocked",
        evidence: [expect.stringContaining("已完成 1 轮")],
        issues: [
          "PAGE_REPAIR_BUDGET_EXHAUSTED: 模型重构后仍未通过真实视口检查。",
        ],
      },
    });
    expect(
      loadPageBuilderWorkingSnapshot(prepared.execution).html?.html,
    ).toContain('class="structural-regeneration"');
    expect(
      loadPageBuilderWorkingSnapshot(prepared.execution).html?.html,
    ).not.toContain('data-keya-renderer="deterministic"');
  });

  it("拒绝跨页调用和未授权资料 chunk", async () => {
    const prepared = await preparePageBuilder();

    expect(() =>
      assertPageBuilderToolCall(prepared.execution, {
        toolName: "generate_page_content",
        input: { pageId: "page-practice" },
      }, "2026-07-29T12:03:30.000Z"),
    ).toThrowError(
      expect.objectContaining({ code: "AGENT_TOOL_FORBIDDEN" }),
    );
    expect(() =>
      assertPageBuilderToolCall(prepared.execution, {
        toolName: "search_references",
        input: {
          pageId: PAGE_ID,
          referencePackId: createReferencePack().id,
          chunkIds: ["chunk-02"],
        },
      }, "2026-07-29T12:03:30.000Z"),
    ).toThrowError(
      expect.objectContaining({ code: "AGENT_TOOL_FORBIDDEN" }),
    );
  });

  it.each([
    {
      label: "缺少 ReferencePack",
      referencePacks: [],
    },
    {
      label: "ReferencePack 缺少 PageTask 封口 chunk",
      referencePacks: [
        {
          ...createReferencePack(),
          keyFacts: [],
          chunks: [
            {
              id: "chunk-02",
              index: 1,
              text: "这段资料不包含 PageTask 封口要求的 chunk-01。",
            },
          ],
        },
      ],
    },
  ])("$label 时在 Page Builder 创建前确定性失败", async ({
    referencePacks,
  }) => {
    const prepared = await preparePageBuilder();

    expect(() =>
      createPageBuilderExecution({
        repository: prepared.repository,
        workOrder: prepared.workOrder,
        workOrderLeaseOwner: PAGE_OWNER,
        runLeaseOwner: ENGINE_OWNER,
        traceId: prepared.run.traceId,
        creationBrief: createBrief(),
        referencePacks,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "PAGE_REFERENCE_INPUT_INVALID",
      }),
    );
  });

  it("第一步随意调用 block_page 会被执行层拒绝且不会写入终态", async () => {
    const prepared = await preparePageBuilder();
    let blockResult: unknown;

    await expect(
      runPageBuilderAgent(
        {
          repository: prepared.repository,
          workOrder: prepared.workOrder,
          workOrderLeaseOwner: PAGE_OWNER,
          runLeaseOwner: ENGINE_OWNER,
          traceId: prepared.run.traceId,
          creationBrief: createBrief(),
          referencePacks: [createReferencePack()],
        },
        {
          createAgent: (settings) => ({
            generate: async () => {
              blockResult = await executeTool(
                settings.tools,
                "block_page",
                {
                  pageId: PAGE_ID,
                  code: "MODEL_GAVE_UP",
                  message: "还没有工作就直接放弃。",
                },
              );
              return {};
            },
          }),
          model: {},
          modelSteps: modelSteps({
            content: pageContent(),
            quality: passingQuality(),
          }),
          now: () => "2026-07-29T12:03:30.000Z",
        },
      ),
    ).rejects.toBeInstanceOf(AgentTerminalNotCommittedError);

    expect(blockResult).toMatchObject({
      ok: false,
      committed: false,
      terminal: false,
      code: "PAGE_BLOCK_NOT_ALLOWED",
    });
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)
        ?.status,
    ).toBe("running");
  });

  it("瞬时 Provider 连续失败不能让模型 block_page", async () => {
    const prepared = await preparePageBuilder();
    const steps = modelSteps({
      content: pageContent(),
      quality: passingQuality(),
    });
    steps.generateContent = vi.fn(async () => {
      throw Object.assign(new Error("provider unavailable"), {
        status: 503,
      });
    });
    let blockResult: unknown;

    await expect(
      runPageBuilderAgent(
        {
          repository: prepared.repository,
          workOrder: prepared.workOrder,
          workOrderLeaseOwner: PAGE_OWNER,
          runLeaseOwner: ENGINE_OWNER,
          traceId: prepared.run.traceId,
          creationBrief: createBrief(),
          referencePacks: [createReferencePack()],
        },
        {
          createAgent: (settings) => ({
            generate: async () => {
              await executeTool(settings.tools, "read_page_context", {
                pageId: PAGE_ID,
              });
              await executeTool(
                settings.tools,
                "generate_page_content",
                {
                  pageId: PAGE_ID,
                },
              );
              await executeTool(
                settings.tools,
                "generate_page_content",
                {
                  pageId: PAGE_ID,
                },
              );
              expect(
                (
                  await settings.prepareStep({
                    messages: [],
                    stepNumber: 3,
                    steps: [],
                  })
                ).activeTools,
              ).not.toContain("block_page");
              blockResult = await executeTool(
                settings.tools,
                "block_page",
                {
                  pageId: PAGE_ID,
                  code: "PAGE_CONTENT_PROVIDER_UNAVAILABLE",
                  message: "页面内容连续生成失败。",
                },
              );
              return {};
            },
          }),
          model: {},
          modelSteps: steps,
          now: () => "2026-07-29T12:03:30.000Z",
        },
      ),
    ).rejects.toBeInstanceOf(AgentTerminalNotCommittedError);

    expect(blockResult).toMatchObject({
      ok: false,
      code: "PAGE_BLOCK_NOT_ALLOWED",
    });
    expect(steps.generateContent).toHaveBeenCalledTimes(2);
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)
        ?.status,
    ).toBe("running");
  });

  it("页面内容连续三次生成失败后立即终止，不再循环到工具预算耗尽", async () => {
    const prepared = await preparePageBuilder();
    const steps = modelSteps({
      content: pageContent(),
      quality: passingQuality(),
    });
    steps.generateContent = vi.fn(async () => {
      throw Object.assign(new Error("provider unavailable"), {
        status: 503,
      });
    });
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: steps,
    });

    await expect(
      executeTool(tools, "generate_page_content", {
        pageId: PAGE_ID,
      }),
    ).resolves.toMatchObject({ ok: false, retryable: true });
    await expect(
      executeTool(tools, "generate_page_content", {
        pageId: PAGE_ID,
      }),
    ).resolves.toMatchObject({ ok: false, retryable: true });
    await expect(
      executeTool(tools, "generate_page_content", {
        pageId: PAGE_ID,
      }),
    ).rejects.toMatchObject({
      code: "PAGE_CONTENT_RETRY_EXHAUSTED",
      name: "FatalAgentRuntimeError",
    } satisfies Partial<FatalAgentRuntimeError>);
    expect(steps.generateContent).toHaveBeenCalledTimes(3);
  });

  it("页面定向返工连续三次生成失败后立即终止，不再耗尽工具预算", async () => {
    const prepared = await preparePageBuilder();
    const steps = modelSteps({
      content: pageContent(),
      quality: failingContentQuality(),
    });
    steps.repairPage = vi.fn(async () => {
      throw Object.assign(new Error("repair provider unavailable"), {
        status: 503,
      });
    });
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: steps,
    });
    await executeTool(tools, "generate_page_content", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "generate_page_html", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "inspect_page", {
      pageId: PAGE_ID,
    });

    await expect(
      executeTool(tools, "repair_page_content", {
        pageId: PAGE_ID,
      }),
    ).resolves.toMatchObject({ ok: false, retryable: true });
    await expect(
      executeTool(tools, "repair_page_content", {
        pageId: PAGE_ID,
      }),
    ).resolves.toMatchObject({ ok: false, retryable: true });
    await expect(
      executeTool(tools, "repair_page_content", {
        pageId: PAGE_ID,
      }),
    ).rejects.toMatchObject({
      code: "REPAIR_EXECUTION_RETRY_EXHAUSTED",
      name: "FatalAgentRuntimeError",
    } satisfies Partial<FatalAgentRuntimeError>);
    expect(steps.repairPage).toHaveBeenCalledTimes(3);
  });

  it("读取上下文且失败质量的定向 repair 明确 declined 后允许合法 block", async () => {
    const prepared = await preparePageBuilder();
    const steps = modelSteps({
      content: pageContent(),
      quality: failingContentQuality(),
    });
    let repairResult: unknown;

    const result = await runPageBuilderAgent(
      {
        repository: prepared.repository,
        workOrder: prepared.workOrder,
        workOrderLeaseOwner: PAGE_OWNER,
        runLeaseOwner: ENGINE_OWNER,
        traceId: prepared.run.traceId,
        creationBrief: createBrief(),
        referencePacks: [createReferencePack()],
      },
      {
        createAgent: (settings) => ({
          generate: async () => {
            await executeTool(settings.tools, "read_page_context", {
              pageId: PAGE_ID,
            });
            await executeTool(settings.tools, "generate_page_content", {
              pageId: PAGE_ID,
            });
            await executeTool(settings.tools, "read_local_resource", {
              path: "agent/skills/course-page-design/references/fixed-canvas-composition.md",
            });
            await executeTool(settings.tools, "generate_page_html", {
              pageId: PAGE_ID,
            });
            await executeTool(settings.tools, "inspect_page", {
              pageId: PAGE_ID,
            });
            repairResult = await executeTool(
              settings.tools,
              "repair_page_content",
              { pageId: PAGE_ID },
            );
            expect(
              (
                await settings.prepareStep({
                  messages: [],
                  stepNumber: 5,
                  steps: [],
                })
              ).activeTools,
            ).toContain("block_page");
            await executeTool(settings.tools, "block_page", {
              pageId: PAGE_ID,
              code: "PAGE_REPAIR_DECLINED",
              message: "定向内容修订明确拒绝在授权范围内修改。",
            });
            return {};
          },
        }),
        model: {},
        modelSteps: steps,
        now: () => "2026-07-29T12:03:30.000Z",
      },
    );

    expect(result.status).toBe("blocked");
    expect(repairResult).toMatchObject({
      ok: false,
      code: "PAGE_REPAIR_DECLINED",
    });
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)
        ?.submission,
    ).toMatchObject({
      status: "blocked",
      evidence: [
        expect.stringContaining("repair 已明确拒绝"),
      ],
    });
  });

  it("旧质量已通过的 Fix WorkOrder 仍必须先读上下文并生成授权目标，不能原样 submit", async () => {
    const prepared = await prepareContentFixPageBuilder();
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: prepared.steps,
    });

    expect(loadPageBuilderSnapshot(prepared.execution)).toMatchObject({
      content: undefined,
      html: undefined,
      quality: undefined,
    });
    expect(resolvePageBuilderActiveTools(prepared.execution)).not.toContain(
      "submit_page",
    );
    expect(resolvePageBuilderActiveTools(prepared.execution)).not.toContain(
      "generate_page_content",
    );

    await executeTool(tools, "read_page_context", { pageId: PAGE_ID });
    expect(resolvePageBuilderActiveTools(prepared.execution)).toContain(
      "generate_page_content",
    );
    expect(resolvePageBuilderActiveTools(prepared.execution)).not.toContain(
      "submit_page",
    );
    await expect(
      executeTool(tools, "submit_page", { pageId: PAGE_ID }),
    ).resolves.toMatchObject({
      ok: false,
      code: "PAGE_FIX_NOT_APPLIED",
    });
  });

  it("Fix 内容修订后旧 HTML 和 Quality 被遮蔽，必须重建下游链", async () => {
    const prepared = await prepareContentFixPageBuilder();
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: prepared.steps,
    });
    await executeTool(tools, "read_page_context", { pageId: PAGE_ID });
    await executeTool(tools, "generate_page_content", {
      pageId: PAGE_ID,
    });

    const current = loadPageBuilderSnapshot(prepared.execution);
    const working = loadPageBuilderWorkingSnapshot(prepared.execution);
    expect(current.content?.narration).toEqual([
      "返工后的内容已经消除跨页重复。",
    ]);
    expect(current.html).toBeUndefined();
    expect(current.quality).toBeUndefined();
    expect(working.html).toBeUndefined();
    expect(working.quality).toBeUndefined();
    expect(resolvePageBuilderActiveTools(prepared.execution)).toContain(
      "generate_page_html",
    );
    expect(resolvePageBuilderActiveTools(prepared.execution)).not.toContain(
      "submit_page",
    );
  });

  it("内容 Fix 生成与 baseline 完全相同的内容时，工具和提交事务都会拒绝伪返工", async () => {
    const prepared = await prepareContentFixPageBuilder();
    const baselineContent = prepared.execution.baseline!.content;
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: modelSteps({
        content: baselineContent,
        html: prepared.revisedHtml,
        quality: prepared.revisedQuality,
      }),
    });
    await executeTool(tools, "read_page_context", {
      pageId: PAGE_ID,
    });

    expect(
      await executeTool(tools, "generate_page_content", {
        pageId: PAGE_ID,
      }),
    ).toMatchObject({
      ok: false,
      code: "PAGE_FIX_UNCHANGED",
    });
    expect(
      loadPageBuilderSnapshot(prepared.execution).content,
    ).toBeUndefined();

    let lockVersion = prepared.execution.currentLockVersion;
    for (const checkpoint of [
      {
        toolName: "generate_page_content",
        kind: "page_content" as const,
        payload: baselineContent,
        invalidates: [
          "page_assets",
          "page_html",
          "page_quality",
        ] as const,
      },
      {
        toolName: "generate_page_html",
        kind: "page_html" as const,
        payload: prepared.revisedHtml,
        invalidates: ["page_quality"] as const,
      },
      {
        toolName: "inspect_page",
        kind: "page_quality" as const,
        payload: prepared.revisedQuality,
        invalidates: [] as const,
      },
    ]) {
      const saved = prepared.repository.checkpointPageArtifact({
        workOrderId: prepared.workOrder.id,
        expectedWorkOrderLockVersion: lockVersion,
        workOrderLeaseOwner: "page-builder-fix-test",
        runLeaseOwner: ENGINE_OWNER,
        traceId: prepared.run.traceId,
        toolName: checkpoint.toolName,
        kind: checkpoint.kind,
        payload: checkpoint.payload,
        invalidates: [...checkpoint.invalidates],
      });
      lockVersion = saved.workOrder.lockVersion;
    }
    expect(() =>
      assertFixSubmissionUsesCurrentCheckpoints({
        artifacts: prepared.repository.artifacts,
        workOrder: prepared.repository.workOrders.load(
          prepared.workOrder.id,
        )!,
        payloads: {
          content: baselineContent,
          html: prepared.revisedHtml,
          quality: prepared.revisedQuality,
        },
      }),
    ).toThrow("与 baseline 相同");
  });

  it("HTML 定向 Fix 只把旧内容当只读 baseline，仍必须生成新 HTML 和当前 Quality", async () => {
    const prepared = await prepareContentFixPageBuilder("page_html");
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: prepared.steps,
    });
    expect(loadPageBuilderSnapshot(prepared.execution).content).toBeUndefined();
    expect(
      loadPageBuilderWorkingSnapshot(prepared.execution).content,
    ).toEqual(prepared.execution.baseline?.content);

    await executeTool(tools, "read_page_context", { pageId: PAGE_ID });
    expect(() =>
      assertPageBuilderToolCall(
        prepared.execution,
        {
          toolName: "generate_page_content",
          input: { pageId: PAGE_ID },
        },
        "2026-07-29T12:02:03.000Z",
      ),
    ).toThrowError(
      expect.objectContaining({ code: "AGENT_TOOL_FORBIDDEN" }),
    );
    expect(resolvePageBuilderActiveTools(prepared.execution)).toContain(
      "generate_page_html",
    );
    expect(resolvePageBuilderActiveTools(prepared.execution)).not.toContain(
      "generate_page_content",
    );
    await executeTool(tools, "generate_page_html", {
      pageId: PAGE_ID,
    });
    expect(loadPageBuilderSnapshot(prepared.execution).quality).toBeUndefined();
    expect(resolvePageBuilderActiveTools(prepared.execution)).toContain(
      "inspect_page",
    );
    await executeTool(tools, "inspect_page", { pageId: PAGE_ID });
    expect(resolvePageBuilderActiveTools(prepared.execution)).toContain(
      "submit_page",
    );
  });

  it("Fix 产生实质内容、重建 HTML 并用当前质量复检后才能完整提交", async () => {
    const prepared = await prepareContentFixPageBuilder();
    const tools = createPageBuilderTools(prepared.execution, {
      modelSteps: prepared.steps,
      pageGate: () => ({
        ok: true,
        payloads: {
          content: prepared.revisedContent,
          assets: [],
          html: prepared.revisedHtml,
          quality: prepared.revisedQuality,
          summary: pageSummary(
            prepared.revisedContent,
            prepared.revisedQuality,
          ),
        },
      }),
    });
    await executeTool(tools, "read_page_context", { pageId: PAGE_ID });
    await executeTool(tools, "generate_page_content", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "generate_page_html", {
      pageId: PAGE_ID,
    });
    await executeTool(tools, "inspect_page", { pageId: PAGE_ID });
    const submitted = await executeTool(tools, "submit_page", {
      pageId: PAGE_ID,
    });

    expect(submitted).toMatchObject({
      ok: true,
      committed: true,
      terminal: true,
    });
    const accepted = prepared.repository.workOrders.load(
      prepared.workOrder.id,
    )!;
    expect(accepted.status).toBe("accepted");
    for (const ref of accepted.submission!.artifactRefs) {
      expect(
        prepared.repository.artifacts.load(ref.id)?.createdByWorkOrderId,
      ).toBe(prepared.workOrder.id);
    }
  });

  it("repair declined 跨 executionAttempt 回放，当前 attempt 仍须重读上下文，后续成功会清零", async () => {
    const prepared = await preparePageBuilder();
    const declinedSteps = modelSteps({
      content: pageContent(),
      quality: failingContentQuality(),
    });
    const initialTools = createPageBuilderTools(prepared.execution, {
      modelSteps: declinedSteps,
    });
    await executeTool(initialTools, "generate_page_content", {
      pageId: PAGE_ID,
    });
    await executeTool(initialTools, "generate_page_html", {
      pageId: PAGE_ID,
    });
    await executeTool(initialTools, "inspect_page", {
      pageId: PAGE_ID,
    });
    await executeTool(initialTools, "repair_page_content", {
      pageId: PAGE_ID,
    });

    const firstCurrent = prepared.repository.workOrders.load(
      prepared.workOrder.id,
    )!;
    prepared.repository.workOrders.release({
      workOrderId: firstCurrent.id,
      expectedLockVersion: firstCurrent.lockVersion,
      owner: PAGE_OWNER,
      now: "2026-07-29T12:04:00.000Z",
    });
    const secondAttempt = prepared.repository.workOrders.claim(
      firstCurrent.id,
      {
        owner: "page-builder-recovered-2",
        now: "2026-07-29T12:04:01.000Z",
        durationMs: 60_000,
      },
    )!;
    const recovered = createPageBuilderExecution({
      repository: prepared.repository,
      workOrder: secondAttempt,
      workOrderLeaseOwner: "page-builder-recovered-2",
      runLeaseOwner: ENGINE_OWNER,
      traceId: prepared.run.traceId,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
    });

    expect(recovered.progress.contextRead).toBe(false);
    expect(resolvePageBuilderActiveTools(recovered)).not.toContain(
      "block_page",
    );
    await executeTool(
      createPageBuilderTools(recovered, {
        modelSteps: declinedSteps,
      }),
      "read_page_context",
      { pageId: PAGE_ID },
    );
    expect(resolvePageBuilderActiveTools(recovered)).toEqual([
      "read_page_workspace",
    ]);
    await executeTool(
      createPageBuilderTools(recovered, {
        modelSteps: declinedSteps,
      }),
      "read_page_workspace",
      { pageId: PAGE_ID },
    );
    expect(resolvePageBuilderActiveTools(recovered)).toContain(
      "block_page",
    );

    const appliedSteps = modelSteps({
      content: pageContent(),
      quality: passingQuality(),
      repairedContent: PageContentDSLSchema.parse({
        ...pageContent(),
        narration: ["已完成一次有实际 checkpoint 的定向修订。"],
      }),
      repairSummary: "REPAIR_APPLIED: 已完成定向修订。",
    });
    const unfinishedLedger =
      prepared.repository.toolOperations.begin({
        workOrderId: secondAttempt.id,
        executionAttempt: secondAttempt.executionAttempt,
        agentStepNumber: 1,
        toolOrdinal: 1,
        toolName: "repair_page_content",
        toolCallId: "tool-call-repair_page_content",
        input: { pageId: PAGE_ID },
      });
    await executeTool(
      createPageBuilderTools(recovered, {
        modelSteps: appliedSteps,
      }),
      "repair_page_content",
      { pageId: PAGE_ID },
    );
    expect(
      prepared.repository.toolOperations.load(unfinishedLedger.id)
        ?.status,
    ).toBe("running");

    const secondCurrent = prepared.repository.workOrders.load(
      secondAttempt.id,
    )!;
    prepared.repository.workOrders.release({
      workOrderId: secondCurrent.id,
      expectedLockVersion: secondCurrent.lockVersion,
      owner: "page-builder-recovered-2",
      now: "2026-07-29T12:04:30.000Z",
    });
    const thirdAttempt = prepared.repository.workOrders.claim(
      secondCurrent.id,
      {
        owner: "page-builder-recovered-3",
        now: "2026-07-29T12:04:31.000Z",
        durationMs: 60_000,
      },
    )!;
    const recoveredAfterSuccess = createPageBuilderExecution({
      repository: prepared.repository,
      workOrder: thirdAttempt,
      workOrderLeaseOwner: "page-builder-recovered-3",
      runLeaseOwner: ENGINE_OWNER,
      traceId: prepared.run.traceId,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
    });
    await executeTool(
      createPageBuilderTools(recoveredAfterSuccess, {
        modelSteps: appliedSteps,
      }),
      "read_page_context",
      { pageId: PAGE_ID },
    );
    const thirdTools = createPageBuilderTools(
      recoveredAfterSuccess,
      { modelSteps: appliedSteps },
    );
    await executeTool(thirdTools, "generate_page_html", {
      pageId: PAGE_ID,
    });
    await executeTool(thirdTools, "inspect_page", {
      pageId: PAGE_ID,
    });
    expect(
      resolvePageBuilderActiveTools(recoveredAfterSuccess),
    ).not.toContain("block_page");
  });

  it("通过 ToolLoopAgent 完成真实 Gate 提交并以 Repository 终态为准", async () => {
    const prepared = await preparePageBuilder();
    const content = pageContent();
    const quality = passingQuality();
    const html = htmlOutput();
    const steps = modelSteps({ content, quality, html });

    const result = await runPageBuilderAgent(
      {
        repository: prepared.repository,
        workOrder: prepared.workOrder,
        workOrderLeaseOwner: PAGE_OWNER,
        runLeaseOwner: ENGINE_OWNER,
        traceId: prepared.run.traceId,
        creationBrief: createBrief(),
        referencePacks: [createReferencePack()],
      },
      {
        createAgent: scriptedPageBuilderFactory([
          "generate_page_content",
          "generate_page_html",
          "inspect_page",
          "submit_page",
        ]),
        model: {},
        modelSteps: steps,
        now: () => "2026-07-29T12:03:30.000Z",
        pageGate: () => ({
          ok: true,
          payloads: {
            content,
            assets: [],
            html,
            quality,
            summary: PageSummarySchema.parse({
              courseId: prepared.workOrder.courseId,
              pageId: PAGE_ID,
              order: 1,
              title: "恒星与行星的区别",
              purpose: "讲清是否自身发光这一核心区别",
              objectiveIds: ["objective-distinguish"],
              buildDependencyPageIds: [],
              keyPoints: ["恒星能自身发光", "行星不能自身发光"],
              contentDigest: "恒星自身发光，行星不能自身发光。",
              learnerAction: "展开两张卡片并说出区别",
              assessment: "判断太阳和地球的天体类型",
              interactionType: "reveal",
              usedReferences: [],
              quality: {
                overallScore: quality.overallScore,
                decision: "pass",
                issueCodes: [],
              },
            }),
          },
        }),
      },
    );

    expect(result.status).toBe("accepted");
    const accepted =
      prepared.repository.workOrders.load(prepared.workOrder.id);
    expect(accepted?.status).toBe("accepted");
    expect(accepted?.leaseOwner).toBeUndefined();
    expect(
      prepared.repository.runs.load(prepared.run.id)
        ?.currentPages[PAGE_ID]?.sourceWorkOrderId,
    ).toBe(prepared.workOrder.id);
  });

  it("Agent 已保存新 checkpoint 但提前结束时由 Harness 续跑到持久化终态", async () => {
    const prepared = await preparePageBuilder();
    const content = pageContent();
    const quality = passingQuality();
    const html = htmlOutput();
    const steps = modelSteps({ content, quality, html });
    let runCount = 0;

    const result = await runPageBuilderAgent(
      {
        repository: prepared.repository,
        workOrder: prepared.workOrder,
        workOrderLeaseOwner: PAGE_OWNER,
        runLeaseOwner: ENGINE_OWNER,
        traceId: prepared.run.traceId,
        creationBrief: createBrief(),
        referencePacks: [createReferencePack()],
      },
      {
        createAgent: (settings) => ({
          generate: async ({ abortSignal }) => {
            runCount += 1;
            const sequence =
              runCount === 1
                ? ([
                    "generate_page_content",
                    "generate_page_html",
                  ] as const)
                : (["inspect_page", "submit_page"] as const);
            for (const toolName of sequence) {
              await executeTool(
                settings.tools,
                toolName,
                { pageId: PAGE_ID },
                abortSignal,
              );
            }
            return {};
          },
        }),
        model: {},
        modelSteps: steps,
        now: () => "2026-07-29T12:03:30.000Z",
        pageGate: () => ({
          ok: true,
          payloads: {
            content,
            assets: [],
            html,
            quality,
            summary: pageSummary(content, quality),
          },
        }),
      },
    );

    expect(runCount).toBe(2);
    expect(result.status).toBe("accepted");
    expect(
      prepared.repository.workOrders.load(prepared.workOrder.id)
        ?.status,
    ).toBe("accepted");
  });
});

async function preparePageBuilder() {
  return preparePageBuilderFixture(directories);
}

async function prepareContentFixPageBuilder(
  targetArtifact: "page_content" | "page_html" = "page_content",
) {
  return prepareContentFixPageBuilderFixture(
    directories,
    targetArtifact,
  );
}
