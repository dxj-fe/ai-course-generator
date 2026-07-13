import type { z } from "zod";

import { logToolCallEvent } from "./tool-call-event";
import type {
  Skill,
  SkillContext,
  ToolCallEventSink,
} from "./types";

type RegisteredSkill = {
  name: string;
  description: string;
  inputSchema: z.ZodType<unknown>;
  outputSchema: z.ZodType<unknown>;
  execute(input: unknown, context: SkillContext): Promise<unknown>;
};

export class SkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();

  constructor(
    private readonly eventSink: ToolCallEventSink = logToolCallEvent,
  ) {}

  register<TInput, TOutput>(skill: Skill<TInput, TOutput>) {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill 已注册：${skill.name}`);
    }

    this.skills.set(skill.name, {
      name: skill.name,
      description: skill.description,
      inputSchema: skill.inputSchema as z.ZodType<unknown>,
      outputSchema: skill.outputSchema as z.ZodType<unknown>,
      execute: async (input, context) =>
        skill.execute(input as TInput, context),
    });

    return this;
  }

  get(name: string) {
    return this.skills.get(name);
  }

  list() {
    return [...this.skills.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }

  async execute<TOutput = unknown>(
    name: string,
    input: unknown,
    context: SkillContext,
  ): Promise<TOutput> {
    const startedAt = Date.now();
    const skill = this.skills.get(name);

    try {
      if (!skill) {
        throw new Error(`Skill 不存在：${name}`);
      }

      const parsedInput = skill.inputSchema.safeParse(input);

      if (!parsedInput.success) {
        throw new Error(
          `Skill ${name} 输入校验失败：${formatZodIssues(parsedInput.error)}`,
        );
      }

      const output = await skill.execute(parsedInput.data, context);
      const parsedOutput = skill.outputSchema.safeParse(output);

      if (!parsedOutput.success) {
        throw new Error(
          `Skill ${name} 输出校验失败：${formatZodIssues(parsedOutput.error)}`,
        );
      }

      this.eventSink({
        event: "tool-call",
        traceId: context.traceId,
        toolName: name,
        input: parsedInput.data,
        output: parsedOutput.data,
        durationMs: Date.now() - startedAt,
        success: true,
      });

      return parsedOutput.data as TOutput;
    } catch (error) {
      this.eventSink({
        event: "tool-call",
        traceId: context.traceId,
        toolName: name,
        input,
        durationMs: Date.now() - startedAt,
        success: false,
        error: getErrorMessage(error),
      });
      throw error;
    }
  }
}

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => {
      const field = issue.path.length ? issue.path.join(".") : "root";

      return `${field}: ${issue.message}`;
    })
    .join("; ");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知 Skill 执行错误";
}
