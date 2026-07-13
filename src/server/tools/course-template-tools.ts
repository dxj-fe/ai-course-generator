import { tool } from "ai";

import { SkillRegistry } from "./skill-registry";
import {
  searchFunctionalTemplateSkill,
  searchStyleTemplateSkill,
  validateCourseIntentSkill,
  type TemplateSearchOutput,
  type ValidateCourseIntentOutput,
} from "./template-skills";

const skillRegistry = new SkillRegistry()
  .register(searchFunctionalTemplateSkill)
  .register(searchStyleTemplateSkill)
  .register(validateCourseIntentSkill);

export function createCourseTemplateTools(traceId: string) {
  return {
    searchFunctionalTemplate: tool({
      description: searchFunctionalTemplateSkill.description,
      inputSchema: searchFunctionalTemplateSkill.inputSchema,
      execute: (input, { abortSignal }) =>
        skillRegistry.execute<TemplateSearchOutput>(
          searchFunctionalTemplateSkill.name,
          input,
          { abortSignal, traceId },
        ),
    }),
    searchStyleTemplate: tool({
      description: searchStyleTemplateSkill.description,
      inputSchema: searchStyleTemplateSkill.inputSchema,
      execute: (input, { abortSignal }) =>
        skillRegistry.execute<TemplateSearchOutput>(
          searchStyleTemplateSkill.name,
          input,
          { abortSignal, traceId },
        ),
    }),
    validateCourseIntent: tool({
      description: validateCourseIntentSkill.description,
      inputSchema: validateCourseIntentSkill.inputSchema,
      execute: (input, { abortSignal }) =>
        skillRegistry.execute<ValidateCourseIntentOutput>(
          validateCourseIntentSkill.name,
          input,
          { abortSignal, traceId },
        ),
    }),
  };
}
