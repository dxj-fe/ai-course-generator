import type { AgentDefinition } from "@/server/agent/types/agent";

export function defineAgent<const Definition extends AgentDefinition>(
  definition: Definition,
): Definition {
  assertNonEmpty(definition.description, "description");
  assertPositiveInteger(definition.runtime.maxSteps, "maxSteps");
  assertPositiveInteger(
    definition.runtime.maxToolCalls,
    "maxToolCalls",
  );
  assertPositiveInteger(definition.runtime.timeoutMs, "timeoutMs");
  assertPositiveInteger(
    definition.runtime.maxOutputTokens,
    "maxOutputTokens",
  );

  return Object.freeze({
    ...definition,
    tools: Object.freeze([...definition.tools]),
    contexts: Object.freeze([...definition.contexts]),
    skills: Object.freeze([...definition.skills]),
    runtime: Object.freeze({ ...definition.runtime }),
  }) as Definition;
}

function assertPositiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Agent ${field} 必须是正整数。`);
  }
}

function assertNonEmpty(value: string, field: string) {
  if (!value.trim()) {
    throw new Error(`Agent ${field} 不能为空。`);
  }
}
