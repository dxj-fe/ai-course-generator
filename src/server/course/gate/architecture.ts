import { projectCourseArchitecture } from "@/server/course/projection/architecture";
import {
  CourseArchitectureSchema,
  type CourseArchitecture,
  type CourseCreationBrief,
  type ReferencePack,
  type ReferenceUsage,
  validateReferenceUsages,
} from "@/shared/course-schema";
import {
  getFunctionalTemplate,
  listFunctionalTemplates,
} from "@/shared/templates/functional";
import { getStyleTemplate } from "@/shared/templates/style";

export type ArchitectureGateIssue = {
  code: string;
  path: string;
  message: string;
};

export type ArchitectureGateResult =
  | { ok: true; architecture: CourseArchitecture }
  | { ok: false; issues: ArchitectureGateIssue[] };

/**
 * 只检查能由代码确定的合同。课程是否真正切中用户目标，仍由 Director 做语义验收。
 */
export function runArchitectureGate(input: {
  candidate: unknown;
  creationBrief: CourseCreationBrief;
  referencePacks: readonly ReferencePack[];
  expectedCourseId: string;
}): ArchitectureGateResult {
  const parsed = CourseArchitectureSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "ARCHITECTURE_SCHEMA_INVALID",
        path: issue.path.join(".") || "root",
        message: issue.message,
      })),
    };
  }

  const architecture = parsed.data;
  const issues: ArchitectureGateIssue[] = [];
  if (architecture.courseId !== input.expectedCourseId) {
    issues.push({
      code: "ARCHITECTURE_COURSE_MISMATCH",
      path: "courseId",
      message: `courseId 必须是 ${input.expectedCourseId}`,
    });
  }

  if (
    typeof input.creationBrief.sectionCount === "number" &&
    architecture.pageTasks.length !== input.creationBrief.sectionCount
  ) {
    issues.push({
      code: "ARCHITECTURE_PAGE_COUNT_MISMATCH",
      path: "pageTasks",
      message: `用户确认了 ${input.creationBrief.sectionCount} 页，当前提交了 ${architecture.pageTasks.length} 页`,
    });
  }

  const explicitPageResponsibilityCount =
    countExplicitPageResponsibilities(
      input.creationBrief.originalRequest,
    );
  if (
    typeof input.creationBrief.sectionCount === "number" &&
    explicitPageResponsibilityCount ===
      input.creationBrief.sectionCount
  ) {
    architecture.pageTasks.forEach((page, index) => {
      if (page.pageType !== "cover") return;
      issues.push({
        code: "EXPLICIT_PAGE_RESPONSIBILITIES_REPLACED_BY_COVER",
        path: `pageTasks.${index}`,
        message:
          `用户明确列出了 ${explicitPageResponsibilityCount} 个逐页职责，且确认课程为 ${input.creationBrief.sectionCount} 页；` +
          "这些职责必须各占一页，不能额外用 cover 消耗页数并合并后续职责。请移除独立封面，按原顺序逐页规划。",
      });
    });
  }

  const globalStyle = getStyleTemplate(
    architecture.blueprint.courseRules.styleTemplateId,
  );
  if (!globalStyle) {
    issues.push({
      code: "STYLE_TEMPLATE_NOT_FOUND",
      path: "blueprint.courseRules.styleTemplateId",
      message: `找不到样式模板 ${architecture.blueprint.courseRules.styleTemplateId}`,
    });
  } else {
    const requestedStyle = architecture.blueprint.courseRules.visualStyle;
    if (globalStyle.visualStyle !== requestedStyle) {
      issues.push({
        code: "STYLE_TEMPLATE_MISMATCH",
        path: "blueprint.courseRules.styleTemplateId",
        message: `样式模板 ${globalStyle.id} 不属于视觉方向 ${requestedStyle}`,
      });
    }
    if (
      globalStyle.profile.family === "organic" &&
      requiresPreciseDiagramMaterial(input.creationBrief.originalRequest)
    ) {
      issues.push({
        code: "STYLE_MATERIAL_LANGUAGE_MISMATCH",
        path: "blueprint.courseRules.styleTemplateId",
        message:
          `当前课程要用精确光路、几何或代码原生图形证明知识关系；${globalStyle.name} 的有机材料语言不适合。` +
          "请改用支持精确科学关系图的样式候选，例如 minimal。",
      });
    }
  }

  architecture.pageTasks.forEach((page, index) => {
    const functionalTemplate = getFunctionalTemplate(
      page.functionalTemplateId,
    );
    const compatibleTemplateIds = listFunctionalTemplates()
      .filter(({ pageType }) => pageType === page.pageType)
      .map(({ id }) => id);
    if (!functionalTemplate) {
      issues.push({
        code: "FUNCTIONAL_TEMPLATE_NOT_FOUND",
        path: `pageTasks.${index}.functionalTemplateId`,
        message: `找不到功能模板 ${page.functionalTemplateId}；${page.pageType} 可用模板：${compatibleTemplateIds.join("、")}`,
      });
    } else if (functionalTemplate.pageType !== page.pageType) {
      issues.push({
        code: "FUNCTIONAL_TEMPLATE_MISMATCH",
        path: `pageTasks.${index}.functionalTemplateId`,
        message: `模板 ${functionalTemplate.id} 只能用于 ${functionalTemplate.pageType}，不能用于 ${page.pageType}；请改用：${compatibleTemplateIds.join("、")}`,
      });
    } else {
      const interactionSlot = functionalTemplate.slots.find(
        ({ name }) => name === "interaction",
      );
      const plannedInteractionEntries =
        plannedInteractionEntryCount(page);
      if (
        interactionSlot &&
        plannedInteractionEntries > interactionSlot.maxItems
      ) {
        issues.push({
          code: "FUNCTIONAL_TEMPLATE_INTERACTION_CAPACITY_MISMATCH",
          path: `pageTasks.${index}.functionalTemplateId`,
          message:
            `模板 ${functionalTemplate.id} 最多承载 ${interactionSlot.maxItems} 个互动项，` +
            `当前 ${page.interactionType} 预计需要 ${plannedInteractionEntries} 个；` +
            "请选择与信息关系和互动容量相符的模板，或在架构层合并真正同属一个操作的教学点",
        });
      }
    }

    if (
      page.styleTemplateId !==
      architecture.blueprint.courseRules.styleTemplateId
    ) {
      issues.push({
        code: "PAGE_STYLE_MISMATCH",
        path: `pageTasks.${index}.styleTemplateId`,
        message: "所有页面必须引用当前 Architecture 的同一个样式模板",
      });
    }

    if (
      architecture.blueprint.courseRules.styleTemplateId === "broadside" &&
      /代码原生(?:科学)?图形/u.test(
        input.creationBrief.originalRequest,
      ) &&
      page.assetNeeds.length > 0
    ) {
      issues.push({
        code: "BROADSIDE_CODE_NATIVE_ASSET_CONFLICT",
        path: `pageTasks.${index}.assetNeeds`,
        message:
          "用户明确要求 Broadside 使用代码原生图形，本页 assetNeeds 必须为空；请用 HTML/CSS/内联 SVG 建立场景、科学关系和视觉焦点",
      });
    }

    if (
      page.pageType === "summary" &&
      !page.acceptance.requiresInteraction &&
      !["none", "navigate", "input"].includes(page.interactionType)
    ) {
      issues.push({
        code: "SUMMARY_INTERACTION_REDUNDANT",
        path: `pageTasks.${index}.interactionType`,
        message:
          "总结页不要求互动时只能使用 none、navigate 或 input；不要用 reveal 重复已经可见的总结正文",
      });
    }

    if (
      ["reveal", "choice", "sort", "input", "explore"].includes(
        page.interactionType,
      ) &&
      !page.acceptance.requiresInteraction
    ) {
      issues.push({
        code: "INTERACTION_ACCEPTANCE_MISMATCH",
        path: `pageTasks.${index}.acceptance.requiresInteraction`,
        message: `${page.interactionType} 是真实学习互动，acceptance.requiresInteraction 必须为 true；若互动不是验收所需，请把 interactionType 改为 none 或 navigate`,
      });
    }

    pushReferenceIssues(
      page.referenceUsages,
      input.referencePacks,
      `pageTasks.${index}.referenceUsages`,
      issues,
    );
  });

  architecture.pageTasks.forEach((page, index) => {
    if (!page.visualDesign) {
      issues.push({
        code: "PAGE_VISUAL_DESIGN_MISSING",
        path: `pageTasks.${index}.visualDesign`,
        message:
          "每个新页面都必须提供由当前知识关系推导出的 theme、layout 和 graphicMotif；不要依赖通用投影兜底",
      });
    }
  });

  (
    ["facts", "examples", "terms"] as const
  ).forEach((collection) => {
    architecture.coursePack[collection].forEach((item, index) => {
      pushReferenceIssues(
        item.sourceUsages,
        input.referencePacks,
        `coursePack.${collection}.${index}.sourceUsages`,
        issues,
      );
    });
  });

  pushSemanticArchitectureIssues(architecture, issues);

  try {
    projectCourseArchitecture(architecture, input.creationBrief);
  } catch (error) {
    issues.push({
      code: "ARCHITECTURE_PROJECTION_INVALID",
      path: "root",
      message:
        error instanceof Error
          ? error.message
          : "CourseArchitecture 无法投影为页面执行合同",
    });
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, architecture };
}

const UNSUPPORTED_EXCLUSIVE_CLAIM =
  /(?:(?:只有|仅有|只剩|仅剩|只保留|仅保留)[^\u3002；;]{0,16}(?:红|橙|蓝|短波|长波|光|分量)|(?:红|橙|蓝|短波|长波|光|分量)[^\u3002；;]{0,16}(?:全部|完全)(?:被)?(?:散射|消失|不见|离开)|(?:剩余|留下|保留)(?:的)?(?:长波|红光|橙光|红橙光)|大部分[^\u3002；;]{0,24}(?:散射掉|消失|被散射掉))/u;
const UNSUPPORTED_MAGNITUDE_CLAIM =
  /(?:大部分|绝大多数|几乎全部|大多|殆尽|所剩无几|远(?:大|强)于|(?:大量|绝大部分)[^\u3002；;]{0,18}(?:被)?散射)/u;
const UNSUPPORTED_PRECISE_RELATION =
  /(?:\d+(?:\.\d+)?\s*(?:倍|%|％)|(?:平方|立方|四次方)\s*(?:成)?反比|反比[^\u3002；;]{0,12}(?:平方|立方|四次方))/u;
const PATH_MECHANISM = /(?:散射|反射|折射|偏转|转向)/u;
const RECEIVER = /(?:观察者|接收者|人眼|眼睛)/u;
const BRANCH_REACHES_RECEIVER =
  /(?:侧向散射蓝光|蓝色侧向散射支路|蓝色散射支路|短波长散射支路|散射蓝光)[^\u3002；;]{0,70}(?:进入|到达|抵达|指向|射入|连接(?:到)?|连到)[^\u3002；;]{0,30}(?:观察者|接收者|人眼|眼睛)/u;
const BRANCH_LEAVES_MAIN_PATH =
  /(?:侧向散射蓝光|蓝色侧向散射支路|蓝色散射支路|短波长散射支路|散射蓝光)[^\u3002；;]{0,70}(?:(?:从|离开|偏离|分出)[^\u3002；;]{0,20}(?:直射)?主(?:光束|光路|路)|(?:直射)?主(?:光束|光路|路)[^\u3002；;]{0,20}(?:分出|离开|偏离))/u;
const REFERENCED_BRANCH_REACHES_RECEIVER =
  /(?:该|这)(?:条)?(?:蓝色|侧向|散射)?支路[^\u3002；;]{0,28}(?:进入|到达|抵达|指向|射入|连接(?:到)?|连到)[^\u3002；;]{0,24}(?:观察者|接收者|人眼|眼睛)/gu;
const REFERENCED_BRANCH_LEAVES_MAIN_PATH =
  /(?:该|这)(?:条)?(?:蓝色|侧向|散射)?支路[^\u3002；;]{0,28}(?:(?:从|离开|偏离|分出)[^\u3002；;]{0,18}(?:直射)?主(?:光束|光路|路)|(?:直射)?主(?:光束|光路|路)[^\u3002；;]{0,18}(?:分出|离开|偏离))/gu;
const DIRECT_PATH_CONTINUES =
  /(?:直射(?:主)?(?:光束|主路|路径|光路)|入射主光束|主光路|主直射光路)[^\u3002；;]{0,60}(?:继续|延伸|穿过|离开画面|通向|最终(?:到达|抵达|落到)?|到达|抵达|落到|射向)[^\u3002；;]{0,24}(?:物理终点|地面|太空|画面外|边界|终点)/u;
const RECEIVER_OFF_DIRECT_AXIS =
  /(?:观察者|接收者|人眼|眼睛)[^\u3002；;]{0,40}(?:(?:主光束|主光路|(?:主)?直射轴线)(?:的)?(?:侧方|之外)|不在[^\u3002；;]{0,12}(?:太阳)?(?:主)?直射(?:方向|轴线))|(?:(?:位于)?(?:主光束|主光路|(?:主)?直射轴线)(?:的)?(?:侧方|之外)|偏离(?:太阳)?(?:主)?直射(?:方向|轴线))[^\u3002；;]{0,40}(?:观察者|接收者|人眼|眼睛)/u;
const WAVELENGTH_ENCODED_AS_PATH_LENGTH =
  /(?:波长[^\u3002；;]{0,20}(?:用|由)[^\u3002；;]{0,12}(?:线段|光路|路径)(?:的)?(?:总)?长度|(?:线段|光路|路径)(?:的)?(?:总)?长度[^\u3002；;]{0,20}(?:代表|编码)[^\u3002；;]{0,12}波长)/u;
const SUN_HEIGHT_PATH_POSITIVE_ASSERTION =
  /(?:(?:太阳高度|太阳高度角|高度角)[^\u3002；;]{0,24}(?:光程|大气路径|路径长度)[^\u3002；;]{0,20}(?:正相关|同向|成正比)|(?:光程|大气路径|路径长度)[^\u3002；;]{0,24}(?:太阳高度|太阳高度角|高度角)[^\u3002；;]{0,20}(?:正相关|同向|成正比)|(?:太阳高度|太阳高度角|高度角)(?:升高|增大|越高)[^\u3002；;]{0,30}(?:光程|大气路径|路径长度)[^\u3002；;]{0,14}(?:变长|增加|越长|更长)|(?:光程|大气路径|路径长度)[^\u3002；;]{0,20}随(?:太阳高度|太阳高度角|高度角)(?:升高|增大)[^\u3002；;]{0,14}(?:变长|增加)|(?:太阳高度|太阳高度角|高度角)(?:降低|减小|越低)[^\u3002；;]{0,30}(?:光程|大气路径|路径长度)[^\u3002；;]{0,14}(?:变短|减少|越短|更短))/u;
const SUN_PATH_RELATION_NON_ASSERTIVE =
  /(?:并非|不是|不呈|不成|不成立|是否|吗[？?]?$|[？?]$|判断[^\u3002；;]{0,20}(?:正相关|负相关)|(?:正相关|同向)[^\u3002；;]{0,8}(?:还是|或)[^\u3002；;]{0,8}(?:负相关|反向))/u;
const CORRECT_SUN_HEIGHT_PATH_DIRECTION =
  /(?:(?:太阳高度|太阳高度角|高度角|太阳)(?:降低|越低|较低|低)[^\u3002；;]{0,30}(?:光程|大气路径|路径长度|路径线段|路径)[^\u3002；;]{0,14}(?:变长|越长|更长|较长|长)|(?:太阳高度|太阳高度角|高度角|太阳)(?:升高|越高|较高|高)[^\u3002；;]{0,30}(?:光程|大气路径|路径长度|路径线段|路径)[^\u3002；;]{0,14}(?:变短|越短|更短|较短|短)|(?:日落|低太阳|低位太阳)[^\u3002；;]{0,24}(?:光程|大气路径|路径长度|路径线段|路径)[^\u3002；;]{0,14}(?:更长|较长|长)|(?:正午|高太阳|高位太阳)[^\u3002；;]{0,24}(?:光程|大气路径|路径长度|路径线段|路径)[^\u3002；;]{0,14}(?:更短|较短|短))/u;
const EXPLICIT_REVERSED_SUN_PATH_STATES =
  /(?:(?:正午|高太阳|高位太阳)[^\u3002；;]{0,24}(?:光路|路径|光程)[^\u3002；;]{0,12}(?:更长|较长|长)[^\u3002；;]{0,50}(?:日落|低太阳|低位太阳)[^\u3002；;]{0,24}(?:光路|路径|光程)[^\u3002；;]{0,12}(?:更短|较短|短)|(?:日落|低太阳|低位太阳)[^\u3002；;]{0,24}(?:光路|路径|光程)[^\u3002；;]{0,12}(?:更短|较短|短)[^\u3002；;]{0,50}(?:正午|高太阳|高位太阳)[^\u3002；;]{0,24}(?:光路|路径|光程)[^\u3002；;]{0,12}(?:更长|较长|长))/u;
const SAME_RECEIVER =
  /(?:同一(?:(?:个|位)|(?:个)?位置的)?(?:观察者|接收者|人眼|眼睛)|(?:观察者|接收者|人眼|眼睛)[^\u3002；;]{0,10}(?:相同|不变)|共用[^\u3002；;]{0,12}(?:观察者|接收者|人眼|眼睛))/u;
const MULTIPLE_PATHS_REACH_RECEIVER =
  /(?:(?:两条|各(?:自)?(?:画|有)?一条)[^\u3002；;]{0,90}(?:连接到|到达|抵达|通向|到)[^\u3002；;]{0,24}(?:同一(?:(?:个|位)|(?:个)?位置的)?)?(?:观察者|接收者|人眼|眼睛)|(?:两条|各(?:自)?(?:画|有)?一条)[^\u3002；;]{0,50}(?:光路|路径)[^\u3002；;]{0,50}(?:同一(?:(?:个|位)|(?:个)?位置的)?)(?:观察者|接收者|人眼|眼睛)|(?:两个|两处)[^\u3002；;]{0,36}(?:太阳|光源)(?:位置)?[^\u3002；;]{0,36}(?:分别|各自)[^\u3002；;]{0,30}(?:完整)?(?:光路|路径)[^\u3002；;]{0,30}(?:到达|抵达|通向|连接到|到)[^\u3002；;]{0,18}(?:同一(?:(?:个|位)|(?:个)?位置的)?)?(?:观察者|接收者|人眼|眼睛))/u;
const RECEIVER_AS_PATH_ORIGIN =
  /(?:(?:观察者|接收者|人眼|眼睛)[^\u3002；;]{0,8}(?:作为|是|为|共用|共享)?[^\u3002；;]{0,6}(?:光路|路径)?起点|(?:以|从)[^\u3002；;]{0,6}(?:观察者|接收者|人眼|眼睛)[^\u3002；;]{0,6}(?:为起点|出发)|(?:从|由)(?:观察者|接收者|人眼|眼睛)[^\u3002；;]{0,14}(?:射出|发出|离开|指向|到达|通向)|(?:散射支路|光路|路径)[^\u3002；;]{0,8}(?:始于|起自|源于)[^\u3002；;]{0,8}(?:观察者|接收者|人眼|眼睛))/u;
const REVERSED_HIGH_SUN_LONG_PATH =
  /(?:正午|高太阳|高位太阳)(?:(?!(?:日落|低太阳|低位太阳))[^\u3002；;，,]){0,28}(?:光路|路径|光程)(?:(?!(?:日落|低太阳|低位太阳))[^\u3002；;，,]){0,14}(?:更长|较长|变长|长)/u;
const REVERSED_LOW_SUN_SHORT_PATH =
  /(?:日落|低太阳|低位太阳)(?:(?!(?:正午|高太阳|高位太阳))[^\u3002；;，,]){0,28}(?:光路|路径|光程)(?:(?!(?:正午|高太阳|高位太阳))[^\u3002；;，,]){0,14}(?:更短|较短|变短|短)/u;
const BLUE_SCATTERING_BRANCH =
  /(?:侧向散射蓝光|蓝色侧向散射支路|蓝色散射支路|短波长散射支路|散射蓝光)/u;
const EXPLICIT_BRANCH_ANTECEDENT =
  /(?:侧向散射蓝光|蓝色侧向散射支路|蓝色散射支路|短波长散射支路|散射蓝光|(?:(?:红|橙|黄|绿|紫|白)(?:色|光)?|长波(?:长)?)(?:(?:侧向|散射|直射)){0,2}支路)/gu;

function requiresPreciseDiagramMaterial(request: string) {
  return (
    /(?:精确|精密)[^\u3002；;]{0,20}(?:关系|光路|几何|图形)/u.test(
      request,
    ) ||
    /(?:光路|几何)[^\u3002；;]{0,40}(?:HTML|CSS|SVG)|(?:HTML|CSS|SVG)[^\u3002；;]{0,40}(?:光路|几何)/iu.test(
      request,
    )
  );
}

function pushSemanticArchitectureIssues(
  architecture: CourseArchitecture,
  issues: ArchitectureGateIssue[],
) {
  architecture.coursePack.facts.forEach((fact, index) => {
    if (
      fact.sourceUsages.length === 0 &&
      (UNSUPPORTED_EXCLUSIVE_CLAIM.test(fact.text) ||
        UNSUPPORTED_MAGNITUDE_CLAIM.test(fact.text) ||
        UNSUPPORTED_PRECISE_RELATION.test(fact.text))
    ) {
      issues.push({
        code: "UNSUPPORTED_PRECISE_OR_EXCLUSIVE_CLAIM",
        path: `coursePack.facts.${index}.text`,
        message:
          "无来源事实不得使用精确倍数/幂次、“只有、全部、只剩”等排他结论，也不得用“大部分、大量、几乎全部”冒充可验证的量。请改成有观察对象和适用范围的相对关系。",
      });
    }
  });

  architecture.coursePack.terms.forEach((term, index) => {
    if (
      term.sourceUsages.length === 0 &&
      UNSUPPORTED_PRECISE_RELATION.test(term.definition)
    ) {
      issues.push({
        code: "UNSUPPORTED_PRECISE_OR_EXCLUSIVE_CLAIM",
        path: `coursePack.terms.${index}.definition`,
        message:
          "无来源术语定义不得引入精确幂次关系；保留本课真正需要的相对关系即可。",
      });
    }
    if (
      /光程/u.test(`${term.term}。${term.definition}`) &&
      !isAccurateOpticalPathDefinition(term.definition)
    ) {
      issues.push({
        code: "OPTICAL_PATH_DEFINITION_INACCURATE",
        path: `coursePack.terms.${index}.definition`,
        message:
          `“${term.term}”仍属于光程概念，不能定义成单纯的实际路径长度。若本课只比较几何长短，请改称“光在大气中的路径长度”；若保留“光程”，必须说明它还与介质折射率有关。`,
      });
    }
  });

  const hasAccurateOpticalPathTerm = architecture.coursePack.terms.some(
    (term) =>
      /光程/u.test(`${term.term}。${term.definition}`) &&
      isAccurateOpticalPathDefinition(term.definition),
  );
  const architectureStringLeaves = collectStringLeaves(architecture);
  const opticalPathMentions = architectureStringLeaves.filter(
    ({ path, value }) =>
      /光程/u.test(value) && !path.startsWith("coursePack.terms."),
  );
  if (!hasAccurateOpticalPathTerm) {
    opticalPathMentions.forEach(({ path }) => {
      issues.push({
        code: "OPTICAL_PATH_TERM_UNQUALIFIED",
        path,
        message:
          "架构使用了“光程”，但 CoursePack 没有包含折射率的准确光程定义。若本课只用几何线长作可观察比较，请把该字段统一改成“大气路径长度”；若保留“光程”，必须给出含折射率的定义，并说明折射率近似不变时才可用几何路径比较。",
      });
    });
  } else if (
    opticalPathMentions.length > 0 &&
    architectureStringLeaves.some(
      ({ path, value }) =>
        path.includes(".visualDesign.") &&
        /(?:几何|线段|(?:光路|路径)[^\u3002；;]{0,10}(?:长|短))/u.test(
          value,
        ),
    ) &&
    !hasConstantRefractiveIndexApproximation(architecture)
  ) {
    issues.push({
      code: "OPTICAL_PATH_GEOMETRIC_APPROXIMATION_MISSING",
      path: "coursePack.terms",
      message:
        "页面用几何线长比较光程时，CoursePack 必须明确说明在同一大气条件下把折射率视为近似不变，几何路径才可作为光程的可观察近似。",
    });
  }

  const skyScatteringCourse =
    /(?:天空|蓝天)/u.test(architecture.coursePack.topic) &&
    architecture.coursePack.facts.some(({ text }) => /散射/u.test(text));
  if (skyScatteringCourse) {
    const factText = architecture.coursePack.facts
      .map(({ text }) => text)
      .join("。");
    if (!/空气分子/u.test(factText)) {
      issues.push({
        code: "SCATTERING_MEDIUM_UNSPECIFIED",
        path: "coursePack.facts",
        message:
          "解释蓝天的瑞利散射时必须明确主要介质是空气分子，不要只写含混的“微小粒子”。",
      });
    }
    const hasObservableSkyDirection =
      /(?:侧向|离开[^\u3002；;]{0,12}(?:直射)?主(?:光束|光路)|偏离(?:主)?直射(?:轴线)?)/u.test(
        factText,
      ) &&
      /(?:进入|射入|到达|抵达|连接(?:到)?|连到)[^\u3002；;]{0,24}(?:人眼|观察者|眼睛)/u.test(
        factText,
      );
    if (!hasObservableSkyDirection) {
      issues.push({
        code: "SCATTERED_LIGHT_OBSERVATION_DIRECTION_UNCLEAR",
        path: "coursePack.facts",
        message:
          "蓝天的事实链必须明确包含“离开直射主光束的侧向散射蓝光进入人眼”。不能省略观察方向，也不能让正午路径长短成为蓝天的主因。",
      });
    }
  }

  architecture.coursePack.facts.forEach((fact, index) => {
    const equatesGeometryWithOpticalPath =
      /(?:(?:大气厚度|介质的总厚度|路径长度)[^\u3002；;]{0,12}(?:就是|等于|即为|[（(])?光程[）)]?|光程[^\u3002；;]{0,12}(?:就是|等于|即为)[^\u3002；;]{0,8}(?:几何(?:路径)?(?:长度|距离)?|大气(?:中的)?路径长度|实际路径长度|路径长度))/u.test(
        fact.text,
      );
    if (
      equatesGeometryWithOpticalPath &&
      (!/(?:折射率|近似)/u.test(fact.text) ||
        deniesRefractiveIndexRelationship(fact.text))
    ) {
      issues.push({
        code: "OPTICAL_PATH_RELATION_OVERSIMPLIFIED",
        path: `coursePack.facts.${index}.text`,
        message:
          "不能把大气厚度或几何路径长度直接括注为“光程”。若保留光程，请说明它还与折射率有关，并说明本页在折射率近似不变时用大气路径长度作可观察比较。",
      });
    }
    if (statesReversedSunHeightPathRelation(fact.text)) {
      issues.push({
        code: "SUN_HEIGHT_PATH_RELATION_REVERSED",
        path: `coursePack.facts.${index}.text`,
        message:
          "太阳高度与大气路径长度不是正相关：太阳越低，光穿过大气的几何路径越长；太阳越高，路径越短。请按这个反向关系改写。",
      });
    }
  });

  architecture.blueprint.objectives.forEach((objective, index) => {
    [
      {
        path: `blueprint.objectives.${index}.outcome`,
        value: objective.outcome,
      },
      {
        path: `blueprint.objectives.${index}.evidence`,
        value: objective.evidence,
      },
    ].forEach(({ path, value }) => {
      if (!statesReversedSunHeightPathRelation(value)) return;
      issues.push({
        code: "SUN_HEIGHT_PATH_RELATION_REVERSED",
        path,
        message:
          "目标或证据把太阳高度与大气路径长度写成了同向变化。正确关系是太阳越低路径越长、太阳越高路径越短。",
      });
    });
  });

  architecture.pageTasks.forEach((page, index) => {
    const visual = page.visualDesign
      ? `${page.visualDesign.theme}。${page.visualDesign.layout}。${page.visualDesign.graphicMotif}`
      : "";
    const semantic = [
      page.title,
      page.purpose,
      ...page.teachingPoints,
      page.learnerAction,
      page.assessment ?? "",
      ...page.acceptance.requiredConcepts,
      page.acceptance.expectedLearnerOutcome,
      ...page.acceptance.pageSpecific,
    ].join("。");

    const assertedFields = [
      { path: `pageTasks.${index}.title`, value: page.title },
      { path: `pageTasks.${index}.purpose`, value: page.purpose },
      ...page.teachingPoints.map((value, pointIndex) => ({
        path: `pageTasks.${index}.teachingPoints.${pointIndex}`,
        value,
      })),
      {
        path: `pageTasks.${index}.acceptance.expectedLearnerOutcome`,
        value: page.acceptance.expectedLearnerOutcome,
      },
    ];
    assertedFields.forEach(({ path, value }) => {
      if (statesReversedSunHeightPathRelation(value)) {
        issues.push({
          code: "SUN_HEIGHT_PATH_RELATION_REVERSED",
          path,
          message:
            "本字段把太阳高度与大气路径长度写成了同向变化。正确关系是太阳越低路径越长、太阳越高路径越短。",
        });
      }
      if (
        skyScatteringCourse &&
        (UNSUPPORTED_EXCLUSIVE_CLAIM.test(value) ||
          UNSUPPORTED_MAGNITUDE_CLAIM.test(value) ||
          (page.referenceUsages.length === 0 &&
            UNSUPPORTED_PRECISE_RELATION.test(value)))
      ) {
        issues.push({
          code: "PAGE_CLAIM_UNSUPPORTED",
          path,
          message:
            "页面职责与验收不得用“大多、殆尽、只有、只剩”等词把相对散射关系写成伪量化或类别消失。请明确观察对象，并改成“散射得更多、直射光中红橙光占比上升”等相对结果。",
        });
      }
    });

    if (
      page.visualDesign &&
      /(?:光路|路径|传播)/u.test(`${semantic}。${visual}`) &&
      RECEIVER_AS_PATH_ORIGIN.test(visual)
    ) {
      issues.push({
        code: "VISUAL_RECEIVER_AS_PATH_ORIGIN",
        path: `pageTasks.${index}.visualDesign`,
        message:
          "光路必须从光源沿传播方向到达人眼/观察者，接收者应是路径终点，不能写成或画成路径起点。请改正路径方向与箭头语义。",
      });
    }

    if (
      page.visualDesign &&
      (statesReversedSunHeightPathRelation(visual) ||
        EXPLICIT_REVERSED_SUN_PATH_STATES.test(visual))
    ) {
      issues.push({
        code: "SUN_HEIGHT_PATH_RELATION_REVERSED",
        path: `pageTasks.${index}.visualDesign`,
        message:
          "visualDesign 描述了相反或互相矛盾的路径方向。必须保持“高太阳/正午路径短，低太阳/日落路径长”，并让实际几何与文字一致。",
      });
    }

    const isSkyScatteringPage =
      skyScatteringCourse &&
      /(?:瑞利散射|天空[^\u3002；;]{0,12}蓝|蓝天)/u.test(semantic);
    if (
      page.visualDesign &&
      isSkyScatteringPage &&
      (!scatteringBranchReachesReceiver(visual) ||
        !scatteringBranchLeavesMainPath(visual) ||
        !DIRECT_PATH_CONTINUES.test(visual) ||
        !RECEIVER_OFF_DIRECT_AXIS.test(visual))
    ) {
      issues.push({
        code: "SKY_SCATTERING_VISUAL_TOPOLOGY_INCOMPLETE",
        path: `pageTasks.${index}.visualDesign`,
        message:
          "蓝天散射页必须在 visualDesign 同时写清三件事：观察者偏离直射轴线；一条蓝色侧向散射支路离开主光束并进入人眼；直射主光束继续到地面、画面外或其他物理终点。不得把观察者放在横向直射主路末端。",
      });
    }

    if (
      page.visualDesign &&
      /(?:波长|长波|短波)/u.test(semantic) &&
      /(?:光程|大气路径|路径长度)/u.test(
        `${architecture.coursePack.topic}。${architecture.coursePack.facts.map(({ text }) => text).join("。")}。${semantic}`,
      ) &&
      WAVELENGTH_ENCODED_AS_PATH_LENGTH.test(visual)
    ) {
      issues.push({
        code: "WAVELENGTH_PATH_LENGTH_ENCODING_COLLISION",
        path: `pageTasks.${index}.visualDesign.graphicMotif`,
        message:
          "同一课同时讲波长与传播路径时，不能用整条线段/光路的长度表示波长，否则会与大气路径长度冲突。请用波峰间距、波形疏密或独立波长标尺表示波长，用光路几何长度表示大气路径。",
      });
    }

    if (
      page.visualDesign &&
      PATH_MECHANISM.test(visual) &&
      RECEIVER.test(visual) &&
      /(?:进入|到达|抵达|指向|射入)/u.test(semantic) &&
      !scatteringBranchReachesReceiver(visual)
    ) {
      issues.push({
        code: "VISUAL_PATH_RECEIVER_TOPOLOGY_INVALID",
        path: `pageTasks.${index}.visualDesign`,
        message:
          "文本结论说散射/反射/转向后的支路进入观察者，但 visualDesign 没有明确让该支路到达人眼/接收者。请把观察者放在正确支路末端，并让直射主路继续到它的物理终点。",
      });
    }

    const comparisonResponsibility = [
      page.title,
      page.purpose,
      page.learnerAction,
      page.assessment ?? "",
      page.acceptance.expectedLearnerOutcome,
      ...page.acceptance.requiredConcepts,
      ...page.acceptance.pageSpecific,
    ].join("。");
    const comparesSunHeightAndPath =
      /(?:太阳高度[^\u3002；;]{0,18}(?:与|和|对)[^\u3002；;]{0,18}(?:光程|大气路径|路径长度)|(?:光程|大气路径|路径长度)[^\u3002；;]{0,18}(?:与|和|随|关系)[^\u3002；;]{0,18}太阳高度)/u.test(
        comparisonResponsibility,
      );
    if (page.visualDesign && comparesSunHeightAndPath) {
      const hasHighState = /(?:正午|太阳高度(?:较)?高|高位太阳|高太阳)/u.test(
        visual,
      );
      const hasLowState = /(?:日落|太阳高度(?:较)?低|低位太阳|低太阳)/u.test(
        visual,
      );
      const hasSameReceiver = SAME_RECEIVER.test(visual);
      const pathsReachReceiver = MULTIPLE_PATHS_REACH_RECEIVER.test(visual);
      const hasCorrectDirection = CORRECT_SUN_HEIGHT_PATH_DIRECTION.test(
        visual,
      );
      if (
        !hasHighState ||
        !hasLowState ||
        !hasSameReceiver ||
        !pathsReachReceiver ||
        !hasCorrectDirection
      ) {
        issues.push({
          code: "VISUAL_PATH_COMPARISON_INCOMPLETE",
          path: `pageTasks.${index}.visualDesign`,
          message:
            "太阳高度与大气路径的比较必须在同一页同时画出高太阳/正午和低太阳/日落两条从光源到同一观察者的完整路径，并明确依靠几何证明“低太阳路径更长、高太阳路径更短”。不能只画一种状态或只用“长/短”标签宣布结论。",
        });
      }
    }

    if (
      page.visualDesign &&
      skyScatteringCourse &&
      (UNSUPPORTED_EXCLUSIVE_CLAIM.test(visual) ||
        UNSUPPORTED_MAGNITUDE_CLAIM.test(visual))
    ) {
      issues.push({
        code: "VISUAL_EXCLUSIVE_CLAIM_UNSUPPORTED",
        path: `pageTasks.${index}.visualDesign`,
        message:
          "visualDesign 不得用“大多、殆尽、只有、只剩”等伪量化或排他表述把相对关系画成类别消失。请改成“短波长分量被散射得更多，到达观察者的直射光中红橙光占比上升”等可观察关系。",
      });
    }
  });

}

function countExplicitPageResponsibilities(request: string) {
  const section = request.match(
    /课程(?:结构|大纲|安排)\s*[：:]([\s\S]*?)(?=视觉(?:方向|风格)|要求|$)/u,
  )?.[1];
  if (!section) return 0;

  const numbers = [...section.matchAll(/(?:^|[；;\n])\s*(\d{1,2})\s*[.、．)]/gu)]
    .map((match) => Number(match[1]));
  if (
    numbers.length === 0 ||
    numbers.some((number, index) => number !== index + 1)
  ) {
    return 0;
  }
  return numbers.length;
}

function statesReversedSunHeightPathRelation(text: string) {
  const sentences = text.match(/[^。；;\n！？!?]+(?:[。；;！？!?]+|$)/gu) ?? [];
  return sentences
    .some(
      (sentence) =>
        (SUN_HEIGHT_PATH_POSITIVE_ASSERTION.test(sentence) ||
          REVERSED_HIGH_SUN_LONG_PATH.test(sentence) ||
          REVERSED_LOW_SUN_SHORT_PATH.test(sentence)) &&
        !SUN_PATH_RELATION_NON_ASSERTIVE.test(sentence),
    );
}

function scatteringBranchReachesReceiver(text: string) {
  return (
    BRANCH_REACHES_RECEIVER.test(text) ||
    referencedBranchRelationHasBlueAntecedent(
      text,
      REFERENCED_BRANCH_REACHES_RECEIVER,
    )
  );
}

function scatteringBranchLeavesMainPath(text: string) {
  return (
    BRANCH_LEAVES_MAIN_PATH.test(text) ||
    referencedBranchRelationHasBlueAntecedent(
      text,
      REFERENCED_BRANCH_LEAVES_MAIN_PATH,
    )
  );
}

function referencedBranchRelationHasBlueAntecedent(
  text: string,
  relationPattern: RegExp,
) {
  return [...text.matchAll(relationPattern)].some((relation) => {
    const precedingText = text.slice(0, relation.index);
    const antecedents = [
      ...precedingText.matchAll(EXPLICIT_BRANCH_ANTECEDENT),
    ];
    const nearestAntecedent = antecedents.at(-1)?.[0];
    return (
      typeof nearestAntecedent === "string" &&
      BLUE_SCATTERING_BRANCH.test(nearestAntecedent)
    );
  });
}

function deniesRefractiveIndexRelationship(text: string) {
  return /(?:与|和)?折射率(?:无关|没有关系)|(?:不|无需)(?:取决于|涉及|包含|考虑)[^\u3002；;]{0,8}折射率|(?:忽略|省略)[^\u3002；;]{0,8}折射率|不受[^\u3002；;]{0,8}折射率[^\u3002；;]{0,8}影响/u.test(
    text,
  );
}

function isAccurateOpticalPathDefinition(definition: string) {
  const includesRefractiveIndex =
    /折射率|(?:^|[^A-Za-z])n(?:[^A-Za-z]|$)/iu.test(definition);
  const includesGeometricPath =
    /(?:几何)?(?:路径|路程|距离|长度)|\bds\b|积分|∫/iu.test(
      definition,
    );
  return (
    !deniesRefractiveIndexRelationship(definition) &&
    includesRefractiveIndex &&
    includesGeometricPath
  );
}

function hasConstantRefractiveIndexApproximation(
  architecture: CourseArchitecture,
) {
  const calibrationText = [
    ...architecture.coursePack.terms.map(({ definition }) => definition),
    ...architecture.coursePack.facts.map(({ text }) => text),
    ...architecture.coursePack.constraints,
  ].join("。");
  const explicitlyRejectsApproximation =
    /不(?:假设|认为|视为|近似)[^\u3002；;]{0,10}折射率[^\u3002；;]{0,10}(?:不变|相同|常数)|折射率[^\u3002；;]{0,10}(?:不相同|并非[^\u3002；;]{0,4}不变|不是[^\u3002；;]{0,4}常数)/u.test(
      calibrationText,
    );
  return (
    !explicitlyRejectsApproximation &&
    /(?:折射率[^\u3002；;]{0,16}(?:近似|视为|假定|假设)[^\u3002；;]{0,10}(?:不变|相同|常数)|(?:近似|视为|假定|假设)[^\u3002；;]{0,10}折射率[^\u3002；;]{0,10}(?:不变|相同|常数))/u.test(
      calibrationText,
    )
  );
}

function collectStringLeaves(
  value: unknown,
  path = "",
): Array<{ path: string; value: string }> {
  if (typeof value === "string") {
    return [{ path: path || "root", value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectStringLeaves(item, path ? `${path}.${index}` : String(index)),
    );
  }
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, item]) =>
    collectStringLeaves(item, path ? `${path}.${key}` : key),
  );
}

function plannedInteractionEntryCount(
  page: CourseArchitecture["pageTasks"][number],
) {
  switch (page.interactionType) {
    case "none":
      return 0;
    case "reveal":
    case "explore":
    case "sort":
      return page.teachingPoints.length;
    default:
      return 1;
  }
}

function pushReferenceIssues(
  usages: readonly ReferenceUsage[],
  packs: readonly ReferencePack[],
  path: string,
  issues: ArchitectureGateIssue[],
) {
  validateReferenceUsages(usages, packs).forEach((message) => {
    issues.push({
      code: "REFERENCE_USAGE_INVALID",
      path,
      message,
    });
  });
}
