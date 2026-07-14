请将下面已经确定的单页课程数据转换为完整、自包含的静态 HTML 文档。

PageContentDSL：
{{pageContentDslJson}}

唯一允许使用的 FunctionalTemplate：
{{functionalTemplateJson}}

唯一允许使用的 StyleTemplate：
{{styleTemplateJson}}

必须原样放入 `:root` 的 Style CSS Variables：
{{styleCssText}}

全课程 VisualBrief：
{{visualBriefJson}}

当前页面 VisualGuidance：
{{pageGuidanceJson}}

当前页面已校验素材结果（ready 使用唯一 URI；fallback 按描述降级）：
{{assetsJson}}

只返回以 `<!doctype html>` 开始的完整 HTML，不要返回 Markdown、解释或原始用户 Prompt。
