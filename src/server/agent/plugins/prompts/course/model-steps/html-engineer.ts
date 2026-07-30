import { styleTemplateToCssText } from "@/shared/templates/style";

import { renderModelStepPrompts } from "../model-step-prompts";

/** 加载并渲染只负责单页表现层的版本化 Prompt。 */
export async function buildHtmlEngineerPrompts(input: {
  pageContentDsl: unknown;
  functionalTemplate: unknown;
  styleTemplate: Parameters<typeof styleTemplateToCssText>[0];
  visualBrief: unknown;
  pageGuidance: unknown;
  assets?: unknown;
  pageDesignGuidance?: unknown;
  validationFeedback?: unknown;
}) {
  return renderModelStepPrompts("html-engineer", {
    pageContentDslJson: JSON.stringify(input.pageContentDsl),
    functionalTemplateJson: JSON.stringify(input.functionalTemplate),
    styleTemplateJson: JSON.stringify(input.styleTemplate),
    styleCssText: styleTemplateToCssText(input.styleTemplate),
    visualBriefJson: JSON.stringify(input.visualBrief),
    pageGuidanceJson: JSON.stringify(input.pageGuidance),
    assetsJson: JSON.stringify(input.assets ?? []),
    pageDesignGuidanceJson: JSON.stringify(
      input.pageDesignGuidance ?? [],
    ),
    validationFeedbackJson: JSON.stringify(
      input.validationFeedback ?? null,
    ),
  });
}
