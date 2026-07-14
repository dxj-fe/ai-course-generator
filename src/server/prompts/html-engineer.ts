import { styleTemplateToCssText } from "@/shared/templates/style";

import { loadPromptTemplate, renderPromptTemplate } from "./prompt-loader";
import type { PromptTemplateDefinition } from "./types";

const systemDefinition: PromptTemplateDefinition = {
  name: "html-engineer-system",
  version: "1.0.0",
  role: "system",
  inputContract: [
    "只接收 PageContentDSL、FunctionalTemplate、StyleTemplate 和 VisualBrief 页面指导。",
  ],
  outputContract: [
    "只返回以 <!doctype html> 开始的完整、自包含、静态 HTML 文档。",
  ],
  fileName: "html-engineer.system.v1.md",
};

const userDefinition: PromptTemplateDefinition = {
  name: "html-engineer-user",
  version: "1.0.0",
  role: "user",
  inputContract: [
    "pageContentDslJson、functionalTemplateJson、styleTemplateJson、styleCssText、visualBriefJson 和 pageGuidanceJson 必须来自服务端已校验数据。",
  ],
  outputContract: ["只返回完整 HTML 文档，不返回 Markdown 或解释。"],
  fileName: "html-engineer.user.v1.md",
};

/** 加载并渲染只负责单页表现层的版本化 Prompt。 */
export async function buildHtmlEngineerPrompts(input: {
  pageContentDsl: unknown;
  functionalTemplate: unknown;
  styleTemplate: Parameters<typeof styleTemplateToCssText>[0];
  visualBrief: unknown;
  pageGuidance: unknown;
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
    }),
  };
}
