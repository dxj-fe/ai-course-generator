import { describe, expect, it } from "vitest";

import { runArchitectureGate } from "../../../../src/server/course/gate/architecture";
import {
  createArchitecture,
  createBrief,
  createReferencePack,
  COURSE_ID,
} from "../../../fixtures/course-architecture";
import type { CourseArchitecture } from "../../../../src/shared/course-schema";

describe("Architecture Gate", () => {
  it("用户列出与页数相同的逐页职责时拒绝额外封面占页", () => {
    const architecture = createArchitecture();
    const creationBrief = {
      ...createBrief(),
      originalRequest:
        "课程结构：1. 认识太阳；2. 区分恒星与行星；3. 练习分类；4. 完成总结任务 视觉方向：太空观察。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief,
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "EXPLICIT_PAGE_RESPONSIBILITIES_REPLACED_BY_COVER",
          path: "pageTasks.0",
          message: expect.stringContaining("不能额外用 cover 消耗页数"),
        }),
      ]),
    });
  });

  it("用户列出与页数相同的逐页职责时允许知识讲解页直接开场", () => {
    const architecture = createArchitecture();
    architecture.pageTasks[0]!.pageType = "knowledge_card";
    architecture.pageTasks[0]!.functionalTemplateId = "knowledge-card-grid";
    const creationBrief = {
      ...createBrief(),
      originalRequest:
        "课程结构：1. 认识太阳；2. 区分恒星与行星；3. 练习分类；4. 完成总结任务 视觉方向：太空观察。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief,
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("展示顺序不限制生成依赖：前一展示页可以依赖后一展示页", () => {
    const architecture = createArchitecture({
      reverseDisplayDependency: true,
    });

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(
        result.architecture.pageTasks[0]?.buildDependsOnPageIds,
      ).toEqual(["page-summary"]);
      expect(result.architecture.pageTasks.map(({ order }) => order)).toEqual([
        1, 2, 3, 4,
      ]);
    }
  });

  it("CoursePack 引用错误返回可直接修复的真实字段路径", () => {
    const architecture = createArchitecture();
    architecture.coursePack.facts[0]!.sourceUsages = [
      {
        referencePackId: "ref-000000000000000000000000",
        chunkIds: ["chunk-99"],
      },
    ];

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_USAGE_INVALID",
          path: "coursePack.facts.0.sourceUsages",
        }),
      ]),
    });
  });

  it("拒绝不要求互动的总结页用 reveal 重复总结正文", () => {
    const architecture = createArchitecture();
    const summary = architecture.pageTasks.find(
      ({ pageType }) => pageType === "summary",
    )!;
    summary.acceptance.requiresInteraction = false;
    summary.interactionType = "reveal";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
        expect.objectContaining({
          code: "SUMMARY_INTERACTION_REDUNDANT",
          path: "pageTasks.3.interactionType",
        }),
        ]),
      );
    }
  });

  it("拒绝真实互动与 requiresInteraction=false 的矛盾架构", () => {
    const architecture = createArchitecture();
    architecture.pageTasks[1]!.acceptance.requiresInteraction = false;

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "INTERACTION_ACCEPTANCE_MISMATCH",
          path: "pageTasks.1.acceptance.requiresInteraction",
        }),
      ],
    });
  });

  it("在派工前拒绝 interaction 槽位容不下教学点的模板", () => {
    const architecture = createArchitecture();
    const page = architecture.pageTasks[1]!;
    page.pageType = "story_intro";
    page.functionalTemplateId = "story-intro";
    page.interactionType = "reveal";
    page.teachingPoints = ["稀薄大气", "极端低温", "水冰资源"];
    page.acceptance.requiresInteraction = true;

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "FUNCTIONAL_TEMPLATE_INTERACTION_CAPACITY_MISMATCH",
          path: "pageTasks.1.functionalTemplateId",
        }),
      ]),
    });
  });

  it("功能模板类型错误时返回当前 pageType 的准确模板 ID", () => {
    const architecture = createArchitecture();
    architecture.pageTasks[0]!.functionalTemplateId = "interactive-quiz";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "FUNCTIONAL_TEMPLATE_MISMATCH",
          path: "pageTasks.0.functionalTemplateId",
          message: expect.stringContaining("请改用：course-cover"),
        }),
      ]),
    });
  });

  it("用户明确要求代码原生 Broadside 时拒绝重新规划 AI 图片", () => {
    const architecture = createArchitecture();
    architecture.blueprint.courseRules.visualStyle = "broadside";
    architecture.blueprint.courseRules.styleTemplateId = "broadside";
    architecture.pageTasks.forEach((page) => {
      page.styleTemplateId = "broadside";
    });
    architecture.pageTasks[0]!.assetNeeds = [
      {
        type: "image",
        role: "hero",
        purpose: "展示天空场景",
        required: false,
      },
    ];
    const creationBrief = {
      ...createBrief(),
      originalRequest:
        "使用 frontend-slides Broadside，采用代码原生科学图形，不要小插图。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief,
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "BROADSIDE_CODE_NATIVE_ASSET_CONFLICT",
          path: "pageTasks.0.assetNeeds",
        }),
      ]),
    });
  });

  it("拒绝新架构依赖通用视觉投影兜底", () => {
    const architecture = createArchitecture();
    delete architecture.pageTasks[1]!.visualDesign;

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: createBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "PAGE_VISUAL_DESIGN_MISSING",
          path: "pageTasks.1.visualDesign",
        }),
      ]),
    });
  });

  it("在派工前拒绝无依据排他事实、错误光程定义和不成立的光路拓扑", () => {
    const architecture = createSkyScatteringArchitecture(false);

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "STYLE_MATERIAL_LANGUAGE_MISMATCH",
        }),
        expect.objectContaining({
          code: "UNSUPPORTED_PRECISE_OR_EXCLUSIVE_CLAIM",
          path: "coursePack.facts.3.text",
        }),
        expect.objectContaining({
          code: "OPTICAL_PATH_DEFINITION_INACCURATE",
        }),
        expect.objectContaining({
          code: "SCATTERING_MEDIUM_UNSPECIFIED",
        }),
        expect.objectContaining({
          code: "SCATTERED_LIGHT_OBSERVATION_DIRECTION_UNCLEAR",
        }),
        expect.objectContaining({
          code: "SKY_SCATTERING_VISUAL_TOPOLOGY_INCOMPLETE",
          path: "pageTasks.1.visualDesign",
        }),
        expect.objectContaining({
          code: "VISUAL_PATH_RECEIVER_TOPOLOGY_INVALID",
          path: "pageTasks.1.visualDesign",
        }),
        expect.objectContaining({
          code: "VISUAL_PATH_COMPARISON_INCOMPLETE",
          path: "pageTasks.2.visualDesign",
        }),
        expect.objectContaining({
          code: "VISUAL_EXCLUSIVE_CLAIM_UNSUPPORTED",
          path: "pageTasks.2.visualDesign",
        }),
      ]),
    });
  });

  it("允许相对事实准确、支路进入观察者且高低状态完整对比的光路架构", () => {
    const result = runArchitectureGate({
      candidate: createSkyScatteringArchitecture(true),
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("拒绝看似完整但仍混淆光程、波长编码和散射支路的架构", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.coursePack.facts[2]!.text =
      "正午太阳高度高，阳光穿过的大气厚度（光程）短，大量蓝光被散射到各个方向，因此天空呈蓝色。";
    architecture.coursePack.facts[3]!.text =
      "日落时太阳高度低，阳光穿过的大气厚度（光程）长，蓝光大部分被散射出主光束。";
    architecture.coursePack.terms = [
      {
        term: "光程",
        definition: "光线从光源到观察者所穿过的介质总厚度。",
        sourceUsages: [],
      },
    ];
    architecture.pageTasks[1]!.visualDesign = {
      theme: "不同波长光线的散射过程",
      layout:
        "左侧为太阳光源，右侧为观察者，散射光线从横向主光路向四周发散。",
      graphicMotif:
        "波长用线段长度编码，散射强度用发散线条数量编码。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_PRECISE_OR_EXCLUSIVE_CLAIM",
        }),
        expect.objectContaining({
          code: "OPTICAL_PATH_DEFINITION_INACCURATE",
        }),
        expect.objectContaining({
          code: "OPTICAL_PATH_RELATION_OVERSIMPLIFIED",
        }),
        expect.objectContaining({
          code: "SCATTERED_LIGHT_OBSERVATION_DIRECTION_UNCLEAR",
        }),
        expect.objectContaining({
          code: "SKY_SCATTERING_VISUAL_TOPOLOGY_INCOMPLETE",
        }),
        expect.objectContaining({
          code: "WAVELENGTH_PATH_LENGTH_ENCODING_COLLISION",
        }),
      ]),
    });
  });

  it("拒绝用光程别名、伪量化和正相关措辞绕过语义门禁", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.coursePack.facts[1]!.text =
      "空气分子使短波蓝光大多被散射，直射蓝光近乎殆尽，仅保留红橙光。";
    architecture.coursePack.terms = [
      {
        term: "大气光程",
        definition: "光从太阳到观察者所走过的几何距离。",
        sourceUsages: [],
      },
    ];
    architecture.pageTasks[2]!.purpose =
      "检验太阳高度与大气光程呈正相关";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "UNSUPPORTED_PRECISE_OR_EXCLUSIVE_CLAIM",
          path: "coursePack.facts.1.text",
        }),
        expect.objectContaining({
          code: "OPTICAL_PATH_DEFINITION_INACCURATE",
          path: "coursePack.terms.0.definition",
        }),
        expect.objectContaining({
          code: "SUN_HEIGHT_PATH_RELATION_REVERSED",
          path: "pageTasks.2.purpose",
        }),
      ]),
    });
  });

  it("拒绝 Run Q 式全局光程混用、观察者起点和剩余颜色分量", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.blueprint.objectives[0]!.outcome =
      "能判断太阳高度对大气光程的影响";
    architecture.blueprint.objectives[0]!.evidence =
      "能选出太阳高度与光程的对应结论";
    architecture.coursePack.facts[3]!.text =
      "日落时路径更长，短波蓝光更多被散射出直射光束，剩余长波的红光和橙光到达观察者。";
    architecture.pageTasks[2]!.title = "太阳高度与光程关系判断";
    architecture.pageTasks[2]!.purpose =
      "检验学习者对太阳高度与光程关系的理解";
    architecture.pageTasks[2]!.acceptance.expectedLearnerOutcome =
      "正确选择太阳高度与光程的对应关系";
    architecture.pageTasks[2]!.visualDesign!.graphicMotif =
      "太阳越低，大气路径线段越长；两条路径共用观察者起点。";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "OPTICAL_PATH_TERM_UNQUALIFIED",
          path: "blueprint.objectives.0.outcome",
        }),
        expect.objectContaining({
          code: "OPTICAL_PATH_TERM_UNQUALIFIED",
          path: "pageTasks.2.title",
        }),
        expect.objectContaining({
          code: "VISUAL_RECEIVER_AS_PATH_ORIGIN",
          path: "pageTasks.2.visualDesign",
        }),
        expect.objectContaining({
          code: "UNSUPPORTED_PRECISE_OR_EXCLUSIVE_CLAIM",
          path: "coursePack.facts.3.text",
        }),
      ]),
    });
  });

  it("准确界定光程后允许在页面字段中继续使用该术语", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.coursePack.terms = [
      {
        term: "光程",
        definition:
          "光程是折射率 n 沿几何路径 ds 的积分；折射率近似不变时，几何路径越长，光程也越长。",
        sourceUsages: [],
      },
    ];
    architecture.pageTasks[2]!.purpose =
      "检验太阳高度与光程的反向关系";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("光程定义出现折射率字样但否定其关系或缺近似条件时仍拒绝", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.coursePack.terms = [
      {
        term: "大气光程",
        definition: "大气光程就是几何路径长度，与折射率无关。",
        sourceUsages: [],
      },
    ];
    architecture.pageTasks[2]!.purpose = "检验太阳高度与光程的关系";

    const denied = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });
    expect(denied).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "OPTICAL_PATH_DEFINITION_INACCURATE",
        }),
        expect.objectContaining({
          code: "OPTICAL_PATH_TERM_UNQUALIFIED",
          path: "pageTasks.2.purpose",
        }),
      ]),
    });

    architecture.coursePack.terms[0]!.definition =
      "光程是折射率 n 沿几何路径 ds 的积分。";
    const missingApproximation = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });
    expect(missingApproximation).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "OPTICAL_PATH_GEOMETRIC_APPROXIMATION_MISSING",
          path: "coursePack.terms",
        }),
      ]),
    });
  });

  it("选择题提及正相关干扰项时不把否定或判断语境误判为错误事实", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[2]!.purpose =
      "判断太阳高度与大气路径长度是正相关还是负相关，正确答案为负相关";
    architecture.pageTasks[2]!.assessment =
      "排除“太阳高度越高路径越长”这个错误干扰项";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("问句、否定比较和低太阳解释不被误判为反向事实", () => {
    const validTitles = [
      "请回答：太阳高度越高，大气路径长度越长吗？并说明理由",
      "正午光路不比日落更长",
      "正午和日落的两条光路说明低太阳时为何路径更长",
    ];

    validTitles.forEach((title) => {
      const architecture = createSkyScatteringArchitecture(true);
      architecture.pageTasks[2]!.title = title;

      const result = runArchitectureGate({
        candidate: architecture,
        creationBrief: skyScatteringBrief(),
        referencePacks: [createReferencePack()],
        expectedCourseId: COURSE_ID,
      });

      expect(result, title).toMatchObject({ ok: true });
    });
  });

  it("仍拒绝高太阳路径更长的事实断言", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[2]!.title = "高太阳路径更长";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "SUN_HEIGHT_PATH_RELATION_REVERSED",
          path: "pageTasks.2.title",
        }),
      ]),
    });
  });

  it("拒绝把正午画成长路径、日落画成短路径，即使错误分散在不同视觉字段", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[2]!.teachingPoints = [
      "正午光路较长，日落光路较短",
    ];
    architecture.pageTasks[2]!.visualDesign = {
      theme: "正午与日落的大气路径对比",
      layout:
        "正午高太阳光路较长；两条完整路径都到达同一观察者。",
      graphicMotif: "日落低太阳光路较短。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "SUN_HEIGHT_PATH_RELATION_REVERSED",
          path: "pageTasks.2.teachingPoints.0",
        }),
        expect.objectContaining({
          code: "SUN_HEIGHT_PATH_RELATION_REVERSED",
          path: "pageTasks.2.visualDesign",
        }),
      ]),
    });
  });

  it("准确光程术语不能掩护 fact 中任一语序的错误等同", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.coursePack.terms = [
      {
        term: "光程",
        definition:
          "光程是折射率 n 沿几何路径 ds 的积分；折射率近似不变时可比较几何长度。",
        sourceUsages: [],
      },
    ];
    architecture.coursePack.facts.push({
      id: "wrong-optical-path",
      text: "大气路径长度就是光程，与折射率无关。",
      sourceUsages: [],
    });
    architecture.coursePack.facts.push({
      id: "wrong-reversed-optical-path",
      text: "光程等于大气路径长度，与折射率无关。",
      sourceUsages: [],
    });

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "OPTICAL_PATH_RELATION_OVERSIMPLIFIED",
          path: "coursePack.facts.4.text",
        }),
        expect.objectContaining({
          code: "OPTICAL_PATH_RELATION_OVERSIMPLIFIED",
          path: "coursePack.facts.5.text",
        }),
      ]),
    });
  });

  it("允许蓝色散射支路的名称、分出与进眼关系分布在三个 visualDesign 字段", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[1]!.visualDesign = {
      theme: "蓝色侧向散射支路",
      layout: "观察者位于主光路侧方；该支路从主光束分出。",
      graphicMotif:
        "该支路进入人眼；直射主光路最终到达地面。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("拒绝把散射支路写成始于人眼", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[1]!.visualDesign = {
      theme: "蓝色侧向散射支路",
      layout:
        "观察者位于主光路侧方；蓝色散射支路始于人眼，从主光束分出后连接到观察者眼睛。",
      graphicMotif: "直射主光路最终到达地面。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "VISUAL_RECEIVER_AS_PATH_ORIGIN",
          path: "pageTasks.1.visualDesign",
        }),
      ]),
    });
  });

  it("接受从两个太阳位置分别到达同一个观察者的等价完整路径措辞", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[2]!.visualDesign = {
      theme: "正午与日落的大气路径对比",
      layout:
        "同一画面显示高太阳和低太阳两个太阳位置，从两个太阳位置分别画出完整光路到达同一个观察者。",
      graphicMotif:
        "两条光路使用同一比例尺，低太阳路径更长，高太阳路径更短。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("拒绝页面字段重新引入 CoursePack 已删掉的无来源精确幂次关系", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[1]!.referenceUsages = [];
    architecture.pageTasks[1]!.teachingPoints[0] =
      "散射强度与波长四次方成反比";

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "PAGE_CLAIM_UNSUPPORTED",
          path: "pageTasks.1.teachingPoints.0",
        }),
      ]),
    });
  });

  it("拒绝看似提到散射和观察者、但没有蓝色支路离开主束的伪拓扑", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[1]!.visualDesign = {
      theme: "观察者看到侧向散射",
      layout:
        "观察者位于主光路侧方；散射示意中另一条红色直射光到达人眼。",
      graphicMotif: "直射主光路最终到达地面。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "SKY_SCATTERING_VISUAL_TOPOLOGY_INCOMPLETE",
          path: "pageTasks.1.visualDesign",
        }),
      ]),
    });
  });

  it("跨字段的该支路指向最近的红色支路时不能串接为蓝色支路", () => {
    const architecture = createSkyScatteringArchitecture(true);
    architecture.pageTasks[1]!.visualDesign = {
      theme: "蓝色侧向散射支路",
      layout:
        "观察者位于主光路侧方；红色散射支路从主光束分出。",
      graphicMotif:
        "该支路进入人眼；直射主光路最终到达地面。",
    };

    const result = runArchitectureGate({
      candidate: architecture,
      creationBrief: skyScatteringBrief(),
      referencePacks: [createReferencePack()],
      expectedCourseId: COURSE_ID,
    });

    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "SKY_SCATTERING_VISUAL_TOPOLOGY_INCOMPLETE",
          path: "pageTasks.1.visualDesign",
        }),
        expect.objectContaining({
          code: "VISUAL_PATH_RECEIVER_TOPOLOGY_INVALID",
          path: "pageTasks.1.visualDesign",
        }),
      ]),
    });
  });
});

function skyScatteringBrief() {
  return {
    ...createBrief(),
    originalRequest:
      "为初中生解释天空为什么是蓝的、日落为什么是红的。用可观察的光路和波长关系解释瑞利散射，再用选择题检验太阳高度与大气路径的关系。精确关系用 HTML/CSS/SVG 表达。",
    topic: "天空为什么是蓝的，日落为什么是红的",
    audience: "初中生",
  };
}

function createSkyScatteringArchitecture(
  corrected: boolean,
): CourseArchitecture {
  const architecture = createArchitecture();
  architecture.coursePack.topic = "天空为什么是蓝的，日落为什么是红的";
  architecture.coursePack.facts = corrected
    ? [
        {
          id: "fact-light",
          text: "可见光包含不同波长的分量，蓝光波长比红光短。",
          sourceUsages: [],
        },
        {
          id: "fact-scattering",
          text: "空气分子对短波长光的散射更强。",
          sourceUsages: [],
        },
        {
          id: "fact-sky",
          text: "来自天空各方向的侧向散射蓝光离开直射主光束并进入人眼，因此晴朗天空呈蓝色。",
          sourceUsages: [],
        },
        {
          id: "fact-sunset",
          text: "太阳接近地平线时，直射光在大气中的路径更长，短波长分量被散射得更多，到达人眼的直射光中红橙光占比上升。",
          sourceUsages: [],
        },
      ]
    : [
        {
          id: "fact-light",
          text: "可见光由不同波长的光组成。",
          sourceUsages: [],
        },
        {
          id: "fact-scattering",
          text: "瑞利散射是光遇到大气中微小粒子时发生的散射。",
          sourceUsages: [],
        },
        {
          id: "fact-sky",
          text: "正午路径短，更多蓝光被散射进入人眼，天空呈蓝色。",
          sourceUsages: [],
        },
        {
          id: "fact-sunset",
          text: "日落时短波长光大部分被散射掉，只剩红光进入人眼。",
          sourceUsages: [],
        },
      ];
  architecture.coursePack.terms = corrected
    ? [
        {
          term: "大气路径长度",
          definition: "光在大气中传播过的几何路径长度。",
          sourceUsages: [],
        },
      ]
    : [
        {
          term: "瑞利散射",
          definition: "散射强度与波长的四次方成反比。",
          sourceUsages: [],
        },
        {
          term: "光程",
          definition: "光线穿过介质的实际路径长度。",
          sourceUsages: [],
        },
      ];

  const styleId = corrected ? "minimal" : "nature";
  architecture.blueprint.courseRules.visualStyle = styleId;
  architecture.blueprint.courseRules.styleTemplateId = styleId;
  architecture.pageTasks.forEach((page) => {
    page.styleTemplateId = styleId;
  });

  const concept = architecture.pageTasks[1]!;
  concept.purpose = "说清侧向散射蓝光为什么能被观察者看到";
  concept.teachingPoints = [
    "短波长光散射更强",
    "侧向散射蓝光进入人眼",
  ];
  concept.acceptance.requiredConcepts = ["瑞利散射", "侧向散射"];
  concept.visualDesign = corrected
    ? {
        theme: "侧向散射蓝光进入观察者",
        layout:
          "暖白入射主光束从太阳穿过空气分子；观察者位于主光路侧方并偏离主直射轴线。",
        graphicMotif:
          "一条蓝色散射支路从空气分子离开主路并连接到观察者眼睛；直射主光路最终到达地面，红光只作相对弱散射参照。",
      }
    : {
        theme: "正午散射光路",
        layout:
          "左侧太阳、中间大气层、右侧观察者组成横向主光路。",
        graphicMotif: "散射光线从主光路向四周发散。",
      };

  const quiz = architecture.pageTasks[2]!;
  quiz.purpose = "检验太阳高度与大气路径长度的关系";
  quiz.teachingPoints = ["太阳高度与大气路径长度的关系"];
  quiz.acceptance.requiredConcepts = ["太阳高度", "大气路径长度"];
  quiz.visualDesign = corrected
    ? {
        theme: "正午与日落的大气路径对比",
        layout:
          "在同一坐标场内，正午高太阳与日落低太阳各画一条穿过相同大气边界并到达同一观察者的完整路径。",
        graphicMotif:
          "两条连续高对比光路共享终点，依靠几何长度而不是标签证明日落路径更长。",
      }
    : {
        theme: "日落时的长光路",
        layout: "一条日落斜向光路穿过大气并到达观察者。",
        graphicMotif: "蓝光被散射出主光路，只有红光抵达观察者。",
      };

  return architecture;
}
