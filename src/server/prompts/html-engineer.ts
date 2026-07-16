import { styleTemplateToCssText } from "@/shared/templates/style";

import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import { getSpecialistPromptDefinition } from "./specialist-library";

const htmlEngineerPromptDefinition =
  getSpecialistPromptDefinition("html-engineer");
const systemDefinition = htmlEngineerPromptDefinition.system;
const userDefinition = htmlEngineerPromptDefinition.user;

/** 加载并渲染只负责单页表现层的版本化 Prompt。 */
export async function buildHtmlEngineerPrompts(input: {
  pageContentDsl: unknown;
  functionalTemplate: unknown;
  styleTemplate: Parameters<typeof styleTemplateToCssText>[0];
  visualBrief: unknown;
  pageGuidance: unknown;
  assets?: unknown;
}) {
  const [systemTemplate, userTemplate] = await Promise.all([
    loadPromptTemplate(systemDefinition),
    loadPromptTemplate(userDefinition),
  ]);

  return {
    version: `${systemTemplate.version}/${userTemplate.version}`,
    systemPrompt: renderPromptTemplate(systemTemplate, {}),
    userPrompt: renderPromptTemplate(userTemplate, {
      pageContentDslJson: JSON.stringify(input.pageContentDsl),
      functionalTemplateJson: JSON.stringify(input.functionalTemplate),
      styleTemplateJson: JSON.stringify(input.styleTemplate),
      styleCssText: styleTemplateToCssText(input.styleTemplate),
      visualBriefJson: JSON.stringify(input.visualBrief),
      pageGuidanceJson: JSON.stringify(input.pageGuidance),
      assetsJson: JSON.stringify(input.assets ?? []),
    }),
  };
}
