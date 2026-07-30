import { tool } from "ai";

import { ExecutableToolRegistry } from "@/server/agent/runtime/executable-tool-registry";
import {
  searchFunctionalTemplateTool,
  searchStyleTemplateTool,
  validateCourseIntentTool,
  type TemplateSearchOutput,
  type ValidateCourseIntentOutput,
} from "./template-definitions";

const toolRegistry = new ExecutableToolRegistry()
  .register(searchFunctionalTemplateTool)
  .register(searchStyleTemplateTool)
  .register(validateCourseIntentTool);

export function createCourseTemplateTools(traceId: string) {
  return {
    searchFunctionalTemplate: tool({
      description: searchFunctionalTemplateTool.description,
      inputSchema: searchFunctionalTemplateTool.inputSchema,
      execute: (input, { abortSignal }) =>
        toolRegistry.execute<TemplateSearchOutput>(
          searchFunctionalTemplateTool.name,
          input,
          { abortSignal, traceId },
        ),
    }),
    searchStyleTemplate: tool({
      description: searchStyleTemplateTool.description,
      inputSchema: searchStyleTemplateTool.inputSchema,
      execute: (input, { abortSignal }) =>
        toolRegistry.execute<TemplateSearchOutput>(
          searchStyleTemplateTool.name,
          input,
          { abortSignal, traceId },
        ),
    }),
    validateCourseIntent: tool({
      description: validateCourseIntentTool.description,
      inputSchema: validateCourseIntentTool.inputSchema,
      execute: (input, { abortSignal }) =>
        toolRegistry.execute<ValidateCourseIntentOutput>(
          validateCourseIntentTool.name,
          input,
          { abortSignal, traceId },
        ),
    }),
  };
}
