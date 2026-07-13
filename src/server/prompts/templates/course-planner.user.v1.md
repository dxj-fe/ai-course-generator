请根据下面的结构化输入生成课程规划。

CourseIntent：
{{courseIntentJson}}

允许使用的功能模板（id 与 pageType 必须匹配）：
{{functionalTemplatesJson}}

整门课程唯一使用的样式模板：
{{styleTemplateJson}}

只返回课程内容草稿 JSON object。根字段必须是 overview、learningObjectives、pages；每个页面必须且只能包含 pageType、title、learningObjective、contentSummary、interactionType、assetNeeds；每个 assetNeeds item 只能包含 purpose 和 required。
