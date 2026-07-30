import { describe, expect, it } from "vitest";

import {
  pageContentDsl,
  visualBrief,
} from "../../../fixtures/course-design";
import { buildHtmlEngineerPrompts } from "../../../../src/server/agent/plugins/prompts/course/model-steps/html-engineer";
import { getFunctionalTemplate } from "../../../../src/shared/templates/functional";
import { getStyleTemplate } from "../../../../src/shared/templates/style";

describe("HTML Engineer prompts", () => {
  it("renders only the resolved DSL, templates and visual contracts", async () => {
    const functionalTemplate = getFunctionalTemplate(
      pageContentDsl.functionalTemplateId,
    );
    const styleTemplate = getStyleTemplate(visualBrief.styleTemplateId);
    const pageGuidance = visualBrief.pageGuidance.find(
      ({ pageId }) => pageId === pageContentDsl.pageId,
    );
    expect(functionalTemplate && styleTemplate && pageGuidance).toBeTruthy();

    const prompts = await buildHtmlEngineerPrompts({
      pageContentDsl,
      functionalTemplate,
      styleTemplate: styleTemplate!,
      visualBrief,
      pageGuidance,
      pageDesignGuidance: [
        {
          logicalPath:
            "agent/skills/course-page-design/SKILL.md",
          digest: "a".repeat(64),
          content: "围绕一个主要认知动作建立视觉焦点。",
        },
      ],
    });

    expect(prompts.version).toBe("2.8.0/2.2.0");
    expect(prompts.systemPrompt).toContain("禁止任何 `<script>`");
    expect(prompts.systemPrompt).toContain("不得交换槽位");
    expect(prompts.systemPrompt).toContain("精确 altText");
    expect(prompts.systemPrompt).toContain("只包裹一个此类直接消费节点");
    expect(prompts.systemPrompt).toContain(
      "唯一 class、唯一 id、精确 `[data-asset-slot-id",
    );
    expect(prompts.systemPrompt).toContain("不使用其他命名实体");
    expect(prompts.systemPrompt).toContain("`none` 页面不要为了标记");
    expect(prompts.systemPrompt).toContain(
      "`feedback.retry` 只属于答错后的条件状态",
    );
    expect(prompts.systemPrompt).toContain(
      "choice prompt 若只比对应 question block 的 body 多一个纯题号前缀",
    );
    expect(prompts.systemPrompt).toContain("x1&lt;x2");
    expect(prompts.systemPrompt).toContain("PageDesignGuidance");
    expect(prompts.systemPrompt).toContain(
      "不得使用 `overflow:auto` / `overflow:scroll`",
    );
    expect(prompts.systemPrompt).toContain(
      "`html`、`body` 和唯一 `main` 必须使用 `width:100%`",
    );
    expect(prompts.systemPrompt).toContain("不能依赖播放器整体缩放");
    expect(prompts.systemPrompt).toContain(
      "禁止先渲染一份静态题卡",
    );
    expect(prompts.systemPrompt).toContain(
      "input 页面必须逐字呈现页面 title",
    );
    expect(prompts.systemPrompt).not.toContain(
      "三个及以上内容块",
    );
    expect(prompts.userPrompt).toContain(pageContentDsl.pageId);
    expect(prompts.userPrompt).toContain("--course-color-background");
    expect(prompts.userPrompt).not.toContain("为 8 岁儿童设计一门");
    expect(prompts.userPrompt).toContain(
      "同一页面上一次确定性 HTML 校验反馈",
    );
    expect(prompts.userPrompt).toContain(
      'data-runtime-submit="true"',
    );
    expect(prompts.userPrompt).toContain("data-question-id");
    expect(prompts.userPrompt).toContain(
      "围绕一个主要认知动作建立视觉焦点",
    );
    expect(prompts.userPrompt).toContain("null");
  });

  it("renders deterministic validation feedback only as retry data", async () => {
    const functionalTemplate = getFunctionalTemplate(
      pageContentDsl.functionalTemplateId,
    );
    const styleTemplate = getStyleTemplate(visualBrief.styleTemplateId);
    const pageGuidance = visualBrief.pageGuidance.find(
      ({ pageId }) => pageId === pageContentDsl.pageId,
    );
    expect(functionalTemplate && styleTemplate && pageGuidance).toBeTruthy();

    const prompts = await buildHtmlEngineerPrompts({
      pageContentDsl,
      functionalTemplate,
      styleTemplate: styleTemplate!,
      visualBrief,
      pageGuidance,
      validationFeedback: {
        code: "AGENT_EXECUTION_ERROR",
        issues: ["页面正文缺少 DSL 文本：课程总结与后续展望"],
      },
    });

    expect(prompts.userPrompt).toContain(
      '"issues":["页面正文缺少 DSL 文本：课程总结与后续展望"]',
    );
  });

  it.each(["sci-fi", "kids-playful", "minimal"])(
    "injects the %s style contract for the same DSL",
    async (styleId) => {
      const functionalTemplate = getFunctionalTemplate(
        pageContentDsl.functionalTemplateId,
      );
      const styleTemplate = getStyleTemplate(styleId);
      const pageGuidance = visualBrief.pageGuidance.find(
        ({ pageId }) => pageId === pageContentDsl.pageId,
      );
      expect(functionalTemplate && styleTemplate && pageGuidance).toBeTruthy();

      const prompts = await buildHtmlEngineerPrompts({
        pageContentDsl,
        functionalTemplate,
        styleTemplate: styleTemplate!,
        visualBrief: { ...visualBrief, styleTemplateId: styleId },
        pageGuidance,
      });

      expect(prompts.userPrompt).toContain(`\"id\":\"${styleId}\"`);
      expect(prompts.userPrompt).toContain(styleTemplate!.colorTokens.primary);
    },
  );
});
