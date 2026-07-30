import { generateText } from "ai";

import { getLanguageModel } from "@/server/infra/ai/model-provider";

import { createCourseTemplateTools } from "./template-tools";

export type SelectPageTemplateInput = {
  abortSignal?: AbortSignal;
  pagePurpose: string;
  traceId: string;
};

export async function selectPageTemplate({
  abortSignal,
  pagePurpose,
  traceId,
}: SelectPageTemplateInput) {
  const tools = createCourseTemplateTools(traceId);
  const result = await generateText({
    abortSignal,
    model: getLanguageModel("cheap"),
    instructions: [
      "你是 课芽 的模板选择助手。",
      "必须根据用户描述选择并调用一个最合适的工具。",
      "教学目的、页面结构和互动方式使用功能模板搜索；视觉风格和审美要求使用样式模板搜索；只有完整 CourseIntent 对象才使用校验工具。",
      "工具参数只提取用户已提供的信息，不要编造完整课程内容。",
    ].join("\n"),
    prompt: `请选择适合下面页面需求的工具：${JSON.stringify(pagePurpose)}`,
    tools,
    toolChoice: "required",
    temperature: 0.1,
    maxOutputTokens: 500,
    timeout: 30_000,
  });

  return {
    text: result.text,
    toolCalls: result.toolCalls.map(({ toolCallId, toolName, input }) => ({
      toolCallId,
      toolName,
      input,
    })),
    toolResults: result.toolResults.map(
      ({ toolCallId, toolName, output }) => ({
        toolCallId,
        toolName,
        output,
      }),
    ),
  };
}
