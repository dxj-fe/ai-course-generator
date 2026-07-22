import { tool } from "ai";

import type { ReferencePack } from "@/shared/course-schema";

import {
  createRetrieveReferenceSkill,
  retrieveSkillDocsSkill,
  retrieveTemplateCardsSkill,
} from "./retrieval-skills";
import { SkillRegistry } from "./skill-registry";

/**
 * 把 Day 33 的类型化检索 Skill 暴露为 AI SDK tools。Reference Packs 通过
 * 服务端闭包注入，模型只能提交查询文本，不能替换任务资料范围。
 */
export function createAgentRetrievalTools(
  traceId: string,
  referencePacks: readonly ReferencePack[] = [],
) {
  const retrieveReferenceSkill = createRetrieveReferenceSkill(referencePacks);
  const registry = new SkillRegistry()
    .register(retrieveSkillDocsSkill)
    .register(retrieveTemplateCardsSkill)
    .register(retrieveReferenceSkill);

  return {
    retrieveSkillDocsSkill: tool({
      description: retrieveSkillDocsSkill.description,
      inputSchema: retrieveSkillDocsSkill.inputSchema,
      execute: (input, { abortSignal }) =>
        registry.execute(retrieveSkillDocsSkill.name, input, {
          abortSignal,
          traceId,
        }),
    }),
    retrieveTemplateCardsSkill: tool({
      description: retrieveTemplateCardsSkill.description,
      inputSchema: retrieveTemplateCardsSkill.inputSchema,
      execute: (input, { abortSignal }) =>
        registry.execute(retrieveTemplateCardsSkill.name, input, {
          abortSignal,
          traceId,
        }),
    }),
    retrieveReferenceSkill: tool({
      description: retrieveReferenceSkill.description,
      inputSchema: retrieveReferenceSkill.inputSchema,
      execute: (input, { abortSignal }) =>
        registry.execute(retrieveReferenceSkill.name, input, {
          abortSignal,
          traceId,
        }),
    }),
  };
}
